# Sauvegarde et restauration : client PostgreSQL de la même version majeure que le serveur.
FROM postgres:18-alpine
COPY --chmod=755 infrastructure/backup/backup.sh /usr/local/bin/arksen-backup
COPY --chmod=755 infrastructure/backup/restore.sh /usr/local/bin/arksen-restore
COPY --chmod=755 infrastructure/backup/entrypoint.sh /usr/local/bin/arksen-backup-entrypoint
VOLUME /backups
ENTRYPOINT ["/usr/local/bin/arksen-backup-entrypoint"]
CMD ["loop"]
