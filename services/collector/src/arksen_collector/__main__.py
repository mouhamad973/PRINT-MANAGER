"""Ligne de commande de l'agent ARKSEN Collector."""

from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
import threading
import webbrowser
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from arksen_collector import __version__
from arksen_collector.agent import Agent
from arksen_collector.config import ConfigError, ConfigStore
from arksen_collector.sync import SyncError


def _agent(args: argparse.Namespace) -> Agent:
    return Agent(ConfigStore(Path(args.home) if args.home else None))


def _cmd_enroll(args: argparse.Namespace) -> int:
    agent = _agent(args)
    agent.enroll(
        args.server,
        args.code,
        allow_insecure_http=args.allow_insecure_http,
        ca_file=args.ca_file,
    )
    agent.refresh_configuration()
    print(f"Agent enregistré : {agent.settings.agent_name} ({agent.settings.agent_id}).")
    print(f"Machines à interroger : {len(agent.targets())}.")
    return 0


def _cmd_run(args: argparse.Namespace) -> int:
    from arksen_collector.webui import LocalUi

    agent = _agent(args)
    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    ui = None if args.no_ui else LocalUi(agent)
    if ui:
        ui.start()
        print(f"Interface locale : {ui.url}")
    try:
        agent.run(stop)
    finally:
        if ui:
            ui.stop()
    return 0


def _cmd_collect(args: argparse.Namespace) -> int:
    agent = _agent(args)
    if not agent.refresh_configuration():
        print("Serveur injoignable : collecte avec la dernière configuration connue.")
    print(f"Machines jointes : {agent.collect_once()} sur {len(agent.targets())}.")
    if not args.no_sync:
        _print_report(agent)
    return 0


def _cmd_sync(args: argparse.Namespace) -> int:
    agent = _agent(args)
    agent.store.retry_now()
    return _print_report(agent)


def _print_report(agent: Agent) -> int:
    report = agent.sync_once()
    print(
        f"Synchronisation : {report.sent} envoyé(s), {report.accepted} accepté(s), "
        f"{report.duplicates} doublon(s), {report.rejected} rejeté(s)."
    )
    if report.error:
        print(f"Interrompue : {report.error} Les événements restent en attente.", file=sys.stderr)
        return 1
    return 0


def _cmd_discover(args: argparse.Namespace) -> int:
    agent = _agent(args)
    if args.range:
        agent.settings.discovery_ranges = args.range
    print(f"Imprimantes trouvées : {agent.discover_once()}.")
    return 0


def _cmd_status(args: argparse.Namespace) -> int:
    print(json.dumps(asdict(_agent(args).status()), indent=2, ensure_ascii=False))
    return 0


def _cmd_ui(args: argparse.Namespace) -> int:
    from arksen_collector.webui import LocalUi

    ui = LocalUi(_agent(args))
    ui.start()
    print(f"Interface locale : {ui.url} (Ctrl+C pour quitter)")
    if not args.no_browser:
        webbrowser.open(ui.url)
    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    while not stop.wait(1):
        pass
    ui.stop()
    return 0


def _cmd_service(args: argparse.Namespace) -> int:
    if sys.platform != "win32":
        print("Le service n'existe que sous Windows : utilisez « run » ailleurs.", file=sys.stderr)
        return 2
    from arksen_collector.winservice import handle_command_line

    # Installé en démarrage automatique : l'agent reprend seul après un redémarrage du poste.
    handle_command_line(
        ["--startup", "auto", args.action]
        if args.action in {"install", "update"}
        else [args.action]
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="arksen-collector",
        description="Agent ARKSEN Collector : collecte SNMP, stockage local et synchronisation.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument(
        "--home", help="dossier de données (par défaut ProgramData\\Arksen\\Collector)"
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="journal détaillé")
    commands = parser.add_subparsers(dest="command", required=True, metavar="commande")

    enroll = commands.add_parser("enroll", help="enregistre l'agent auprès du serveur")
    enroll.add_argument("--server", required=True, help="adresse du serveur, https://…")
    enroll.add_argument(
        "--code", required=True, help="code d'enregistrement délivré par le serveur"
    )
    enroll.add_argument(
        "--allow-insecure-http", action="store_true", help="autorise HTTP (réseau de test)"
    )
    enroll.add_argument("--ca-file", help="certificat de l'autorité du serveur On-Premise (ca.pem)")
    enroll.set_defaults(handler=_cmd_enroll)

    run = commands.add_parser("run", help="collecte et synchronise en continu (premier plan)")
    run.add_argument("--no-ui", action="store_true", help="sans interface locale")
    run.set_defaults(handler=_cmd_run)

    collect = commands.add_parser("collect", help="collecte une fois, puis synchronise")
    collect.add_argument("--no-sync", action="store_true", help="sans synchroniser")
    collect.set_defaults(handler=_cmd_collect)

    sync = commands.add_parser("sync", help="envoie tout de suite les événements en attente")
    sync.set_defaults(handler=_cmd_sync)

    discover = commands.add_parser("discover", help="cherche les imprimantes du réseau")
    discover.add_argument("--range", action="append", help="plage à explorer (répétable)")
    discover.set_defaults(handler=_cmd_discover)

    status = commands.add_parser("status", help="état de l'agent et de sa synchronisation")
    status.set_defaults(handler=_cmd_status)

    ui = commands.add_parser("ui", help="ouvre l'interface de configuration locale")
    ui.add_argument("--no-browser", action="store_true")
    ui.set_defaults(handler=_cmd_ui)

    service = commands.add_parser("service", help="gère le service Windows")
    service.add_argument(
        "action", choices=["install", "update", "remove", "start", "stop", "restart"]
    )
    service.set_defaults(handler=_cmd_service)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if not arguments and getattr(sys, "frozen", False) and sys.platform == "win32":
        # Exécutable lancé par le gestionnaire de services Windows.
        from arksen_collector.winservice import run_as_service

        run_as_service()
        return
    args = build_parser().parse_args(arguments)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    # Une ligne par requête HTTP noierait le journal : seulement en mode détaillé.
    logging.getLogger("httpx").setLevel(logging.DEBUG if args.verbose else logging.WARNING)
    try:
        code = args.handler(args)
    except (ConfigError, SyncError) as error:
        print(f"Erreur : {error}", file=sys.stderr)
        code = 1
    sys.exit(code)


if __name__ == "__main__":
    main()
