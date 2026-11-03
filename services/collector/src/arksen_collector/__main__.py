"""Point d'entrée de l'agent. La collecte SNMP et la synchronisation arrivent en Phase 7."""

import argparse
from collections.abc import Sequence

from arksen_collector import __version__


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="arksen-collector")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.parse_args(argv)
    parser.error("la collecte n'est pas encore implémentée (Phase 7)")


if __name__ == "__main__":
    main()
