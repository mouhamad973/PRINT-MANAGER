#!/bin/sh
# Sauvegardes PostgreSQL d'ARKSEN, au format personnalisé de pg_dump (compressé, restaurable
# table par table). Une sauvegarde au démarrage, puis toutes les BACKUP_INTERVAL_HOURS heures ;
# celles de plus de BACKUP_RETENTION_DAYS jours sont supprimées.
#
#   backup.sh          boucle du service « backup »
#   backup.sh once     une seule sauvegarde, puis sortie (docker compose run --rm backup once)
set -eu

DIR=/backups
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
export PGPASSWORD="$POSTGRES_PASSWORD"

backup_once() {
    stamp=$(date -u +%Y%m%d-%H%M%S)
    target="$DIR/arksen-$stamp.dump"
    echo "$(date -u +%FT%TZ) sauvegarde vers $target"
    pg_dump --host=postgres --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
        --format=custom --compress=6 --file="$target.partial"
    mv "$target.partial" "$target"
    sha256sum "$target" | sed "s#$DIR/##" > "$target.sha256"
    find "$DIR" -name 'arksen-*.dump*' -type f -mtime +"$RETENTION_DAYS" -print -delete
    echo "$(date -u +%FT%TZ) sauvegarde terminée ($(du -h "$target" | cut -f1))"
}

mkdir -p "$DIR"
if [ "${1:-loop}" = "once" ]; then
    backup_once
    exit 0
fi

until pg_isready --host=postgres --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" >/dev/null 2>&1; do
    sleep 5
done
while true; do
    backup_once || echo "$(date -u +%FT%TZ) ÉCHEC de la sauvegarde" >&2
    sleep $((INTERVAL_HOURS * 3600))
done
