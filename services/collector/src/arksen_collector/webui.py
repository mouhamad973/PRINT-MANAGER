"""Interface de configuration locale, servie sur la boucle locale (127.0.0.1) seulement.

Elle permet d'enregistrer l'agent (serveur et code), de régler la collecte et la découverte,
et de suivre les synchronisations. Protections : écoute sur 127.0.0.1, en-tête Host vérifié
(contre le rebinding DNS), origine et jeton anti-CSRF vérifiés sur chaque envoi de formulaire.
"""

from __future__ import annotations

import html
import logging
import secrets
import threading
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, quote, urlsplit

from arksen_collector import __version__
from arksen_collector.agent import Agent
from arksen_collector.config import ConfigError, expand_range
from arksen_collector.sync import SyncError

log = logging.getLogger("arksen_collector.ui")

_STYLE = """
:root{--green:#0f5c45;--soft:#e6f0ec;--ink:#14201b;--muted:#5d6b65;--line:#dfe5e2;--bad:#b42318}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,Segoe UI,sans-serif;color:var(--ink);background:#f4f6f5}
header{background:var(--green);color:#fff;padding:16px 24px}header h1{margin:0;font-size:18px}
header p{margin:2px 0 0;opacity:.8;font-size:13px}main{max-width:1040px;margin:0 auto;padding:24px;display:grid;gap:16px}
section{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px}
h2{margin:0 0 12px;font-size:15px}label{display:block;font-weight:600;margin:10px 0 4px}
input[type=text],input[type=url],input[type=number],textarea{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font:inherit}
textarea{min-height:70px}button{background:var(--green);color:#fff;border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer;margin-top:12px}
button.secondary{background:var(--soft);color:var(--green)}.row{display:flex;gap:8px;flex-wrap:wrap}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.kpi{background:var(--soft);border-radius:10px;padding:10px 12px}.kpi b{display:block;font-size:20px}
.muted{color:var(--muted)}.bad{color:var(--bad)}.ok{color:var(--green)}.flash{padding:10px 14px;border-radius:8px;background:var(--soft)}
.flash.bad{background:#fdecea}small{color:var(--muted)}
"""


def _when(timestamp: float | None) -> str:
    if not timestamp:
        return "jamais"
    return datetime.fromtimestamp(timestamp).strftime("%d/%m/%Y %H:%M:%S")


def _e(value: Any) -> str:
    return html.escape("" if value is None else str(value))


class LocalUi:
    def __init__(self, agent: Agent, *, host: str = "127.0.0.1", port: int | None = None) -> None:
        self.agent = agent
        self.host = host
        self.port = port or agent.settings.ui_port
        self.csrf = secrets.token_urlsafe(32)
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}/"

    def start(self) -> None:
        ui = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "ArksenCollector"
            sys_version = ""

            def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
                log.debug("UI %s", format % args)

            def do_GET(self) -> None:  # noqa: N802
                if not ui.host_allowed(self.headers.get("Host")):
                    self.send_error(HTTPStatus.MISDIRECTED_REQUEST)
                    return
                parts = urlsplit(self.path)
                if parts.path != "/":
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                query = parse_qs(parts.query)
                body = ui.render(query.get("message", [""])[0], query.get("error", [""])[0])
                self._reply(HTTPStatus.OK, body)

            def do_POST(self) -> None:  # noqa: N802
                if not ui.host_allowed(self.headers.get("Host")) or not ui.origin_allowed(
                    self.headers.get("Origin")
                ):
                    self.send_error(HTTPStatus.FORBIDDEN)
                    return
                length = min(int(self.headers.get("Content-Length") or 0), 64 * 1024)
                form = {
                    key: values[0]
                    for key, values in parse_qs(self.rfile.read(length).decode("utf-8")).items()
                }
                if not secrets.compare_digest(form.get("csrf", ""), ui.csrf):
                    self.send_error(HTTPStatus.FORBIDDEN)
                    return
                message, error = ui.handle(urlsplit(self.path).path, form)
                target = "/?" + ("error=" + quote(error) if error else "message=" + quote(message))
                self.send_response(HTTPStatus.SEE_OTHER)
                self.send_header("Location", target)
                self.end_headers()

            def _reply(self, status: HTTPStatus, body: str) -> None:
                data = body.encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Frame-Options", "DENY")
                self.send_header(
                    "Content-Security-Policy",
                    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
                )
                self.end_headers()
                self.wfile.write(data)

        self._server = ThreadingHTTPServer((self.host, self.port), Handler)
        self.port = self._server.server_address[1]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        log.info("Interface locale : %s", self.url)

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()

    def host_allowed(self, host: str | None) -> bool:
        return host in {f"127.0.0.1:{self.port}", f"localhost:{self.port}"}

    def origin_allowed(self, origin: str | None) -> bool:
        return origin in {f"http://127.0.0.1:{self.port}", f"http://localhost:{self.port}"}

    # -- Actions ---------------------------------------------------------------------------------

    def handle(self, path: str, form: dict[str, str]) -> tuple[str, str]:
        agent = self.agent
        try:
            if path == "/enroll":
                agent.enroll(
                    form.get("server_url", "").strip(),
                    form.get("code", ""),
                    allow_insecure_http=form.get("allow_insecure_http") == "on",
                )
                agent.refresh_configuration()
                return "Agent enregistré : la collecte démarre.", ""
            if path == "/settings":
                settings = agent.settings_for_update()
                minutes = int(form.get("collect_minutes", "15") or 15)
                settings.collect_interval = minutes * 60
                settings.discovery_ranges = [
                    line.strip() for line in form.get("ranges", "").splitlines() if line.strip()
                ]
                for item in settings.discovery_ranges:
                    expand_range(item)
                settings.discovery_communities = [
                    item.strip()
                    for item in form.get("communities", "public").split(",")
                    if item.strip()
                ] or ["public"]
                settings.ca_file = form.get("ca_file", "").strip()
                agent.config.save(settings)
                agent.reload()
                return "Réglages enregistrés.", ""
            if path == "/sync":
                agent.store.retry_now()
                report = agent.sync_once()
                if report.error:
                    return "", f"Synchronisation interrompue : {report.error}"
                return (
                    f"Synchronisation : {report.sent} envoyé(s), {report.accepted} accepté(s), "
                    f"{report.duplicates} doublon(s), {report.rejected} rejeté(s).",
                    "",
                )
            if path == "/collect":
                agent.refresh_configuration()
                reached = agent.collect_once()
                return f"Collecte terminée : {reached} machine(s) jointe(s).", ""
            if path == "/discover":
                found = agent.discover_once()
                return f"Découverte terminée : {found} imprimante(s) trouvée(s).", ""
        except (ConfigError, SyncError, ValueError) as error:
            return "", str(error)
        return "", "Action inconnue."

    # -- Page ------------------------------------------------------------------------------------

    def render(self, message: str, error: str) -> str:
        agent = self.agent
        agent.reload()
        status = agent.status()
        settings = agent.settings
        csrf = f'<input type="hidden" name="csrf" value="{_e(self.csrf)}">'
        flash = ""
        if error:
            flash = f'<p class="flash bad">{_e(error)}</p>'
        elif message:
            flash = f'<p class="flash">{_e(message)}</p>'

        if status.unauthorized:
            state = '<b class="bad">Refusé par le serveur : enregistrez de nouveau l’agent.</b>'
        elif status.enrolled:
            state = f'<b class="ok">Enregistré</b> : {_e(status.agent_name)}'
        else:
            state = '<b class="bad">Non enregistré</b>'

        sync_state = (
            f'<span class="bad">{_e(status.last_sync_error)}</span>'
            if status.last_sync_error
            else '<span class="ok">À jour</span>'
            if status.pending == 0
            else "En attente d’envoi"
        )

        runs = (
            "".join(
                f"<tr><td>{_e(run['name'])}</td><td>{_e(run['host'])}</td>"
                f"<td>{_when(run['last_success_at'])}</td>"
                f'<td class="{"bad" if run["last_error"] else "ok"}">'
                f"{_e(run['last_error'] or 'Jointe')}</td></tr>"
                for run in agent.store.printer_runs()
            )
            or '<tr><td colspan="4" class="muted">Aucune machine interrogée pour l’instant.</td></tr>'
        )

        history = (
            "".join(
                f"<tr><td>{_when(entry.finished_at)}</td><td>{entry.sent}</td><td>{entry.accepted}</td>"
                f"<td>{entry.duplicates}</td><td>{entry.rejected}</td>"
                f'<td class="bad">{_e(entry.error or "")}</td></tr>'
                for entry in agent.store.sync_history(15)
            )
            or '<tr><td colspan="6" class="muted">Aucune synchronisation.</td></tr>'
        )

        rejected = "".join(
            f"<tr><td>{_e(item['type'])}</td><td>{_e(item['occurred_at'])}</td>"
            f'<td class="bad">{_e(item["last_error"])}</td></tr>'
            for item in agent.store.rejected(10)
        )
        rejected_section = (
            f"<section><h2>Événements rejetés par le serveur</h2><table><tr><th>Type</th>"
            f"<th>Date</th><th>Raison</th></tr>{rejected}</table></section>"
            if rejected
            else ""
        )

        return f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ARKSEN Collector</title><style>{_STYLE}</style></head><body>
<header><h1>ARKSEN Collector</h1><p>Agent de collecte SNMP · version {_e(__version__)}
 · données dans {_e(agent.config.home)}</p></header>
<main>{flash}
<section><h2>État</h2><p>{state}</p>
<div class="grid">
<div class="kpi"><small>Machines à interroger</small><b>{status.printers}</b></div>
<div class="kpi"><small>Événements en attente</small><b>{status.pending}</b></div>
<div class="kpi"><small>Acquittés</small><b>{status.accepted + status.duplicates}</b></div>
<div class="kpi"><small>Rejetés</small><b>{status.rejected}</b></div>
</div>
<p>Synchronisation : {sync_state} · dernière : {_when(status.last_sync_at)}
 · plus ancien événement en attente : {_when(status.oldest_pending_at)}<br>
Dernière collecte : {_when(status.last_collect_at)} · configuration reçue : {_when(status.configuration_at)}
 · dernière découverte : {_when(status.last_discovery_at)}</p>
<div class="row">
<form method="post" action="/collect">{csrf}<button>Collecter maintenant</button></form>
<form method="post" action="/sync">{csrf}<button class="secondary">Synchroniser maintenant</button></form>
<form method="post" action="/discover">{csrf}<button class="secondary">Lancer une découverte</button></form>
</div></section>

<section><h2>Enregistrement auprès du serveur</h2>
<p class="muted">Créez l’agent dans ARKSEN PRINT MANAGER (Parc › Agents de collecte) : le code
d’enregistrement, valable 24 heures, n’est utilisable qu’une fois. L’identifiant de l’entreprise
et celui de l’agent sont attribués par le serveur.</p>
<form method="post" action="/enroll">{csrf}
<label for="server_url">Adresse du serveur</label>
<input type="url" id="server_url" name="server_url" required value="{_e(settings.server_url)}" placeholder="https://print.exemple.com">
<label for="code">Code d’enregistrement</label>
<input type="text" id="code" name="code" required autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX">
<label><input type="checkbox" name="allow_insecure_http" {"checked" if settings.allow_insecure_http else ""}>
 Autoriser HTTP sans chiffrement (réseau de test uniquement)</label>
<button>Enregistrer l’agent</button></form>
<p class="muted">Entreprise : {_e(status.tenant_id or "—")} · agent : {_e(status.agent_id or "—")}</p></section>

<section><h2>Collecte et découverte</h2>
<form method="post" action="/settings">{csrf}
<label for="collect_minutes">Fréquence de collecte (minutes)</label>
<input type="number" id="collect_minutes" name="collect_minutes" min="1" max="1440" value="{settings.collect_interval // 60}">
<label for="ranges">Plages à explorer pour la découverte (une par ligne)</label>
<textarea id="ranges" name="ranges" placeholder="192.168.1.0/24&#10;10.0.0.10-10.0.0.60">{_e(chr(10).join(settings.discovery_ranges))}</textarea>
<label for="communities">Communautés SNMP essayées pendant la découverte (séparées par des virgules)</label>
<input type="text" id="communities" name="communities" value="{_e(", ".join(settings.discovery_communities))}">
<label for="ca_file">Certificat d’autorité du serveur (facultatif, serveur On-Premise)</label>
<input type="text" id="ca_file" name="ca_file" value="{_e(settings.ca_file)}" placeholder="C:\\Arksen\\ca.pem">
<button>Enregistrer les réglages</button></form>
<p class="muted">Les machines interrogées, leurs adresses et leurs identifiants SNMP se
configurent dans ARKSEN PRINT MANAGER (fiche de chaque machine) : l’agent les reçoit du serveur
et les garde en cache, protégés, pour continuer sans Internet.</p></section>

<section><h2>Machines</h2><table><tr><th>Machine</th><th>Adresse</th><th>Dernier succès</th>
<th>Dernière tentative</th></tr>{runs}</table></section>
<section><h2>Journal des synchronisations</h2><table><tr><th>Date</th><th>Envoyés</th>
<th>Acceptés</th><th>Doublons</th><th>Rejetés</th><th>Erreur</th></tr>{history}</table></section>
{rejected_section}
</main></body></html>"""
