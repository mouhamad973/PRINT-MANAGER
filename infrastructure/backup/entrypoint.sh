#!/bin/sh
# Point d'entrée du service « backup » : boucle de sauvegarde, sauvegarde unique ou restauration.
set -eu
case "${1:-loop}" in
    restore) shift; exec /usr/local/bin/arksen-restore "$@" ;;
    once) exec /usr/local/bin/arksen-backup once ;;
    *) exec /usr/local/bin/arksen-backup ;;
esac
