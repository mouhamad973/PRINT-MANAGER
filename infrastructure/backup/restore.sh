#!/bin/sh
# Restauration d'une sauvegarde ARKSEN. À lancer api, workers et web arrêtés :
#
#   docker compose ... stop api workers web
#   docker compose ... run --rm backup restore arksen-20261105-020000.dump
#   docker compose ... up -d
#
# Les rôles arksen_app et arksen_system appartiennent au serveur PostgreSQL, pas à la base :
# sur un serveur neuf, lancez d'abord le service « migrate », qui les crée.
set -eu

FILE="${1:?Nom du fichier de sauvegarde attendu (dans /backups)}"
case "$FILE" in
    /*) PATH_TO_DUMP="$FILE" ;;
    *) PATH_TO_DUMP="/backups/$FILE" ;;
esac
[ -s "$PATH_TO_DUMP" ] || { echo "Sauvegarde introuvable : $PATH_TO_DUMP" >&2; exit 1; }

if [ -s "$PATH_TO_DUMP.sha256" ]; then
    (cd "$(dirname "$PATH_TO_DUMP")" && sha256sum -c "$(basename "$PATH_TO_DUMP").sha256")
fi

export PGPASSWORD="$POSTGRES_PASSWORD"
echo "Restauration de $PATH_TO_DUMP dans la base $POSTGRES_DB : son contenu actuel sera remplacé."
pg_restore --host=postgres --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
    --clean --if-exists --single-transaction --exit-on-error "$PATH_TO_DUMP"
echo "Restauration terminée. Relancez la pile : les migrations plus récentes seront appliquées."
