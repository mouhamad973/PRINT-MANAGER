# Sécurité et audit

Ce document résume les protections d'ARKSEN PRINT MANAGER. Le détail technique est dans [architecture.md](architecture.md).

## Accès

- **Authentification** : sessions Better Auth en cookie `HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS. Les tentatives de connexion sont limitées par adresse IP, et chaque échec est journalisé.
- **Permissions** : la matrice des rôles est dans le code (`shared-types/src/access.ts`), jamais en base. L'API vérifie la permission de chaque route ; le frontend se contente de masquer ce qui serait refusé.
- **Isolation des entreprises** : le rôle PostgreSQL `arksen_app` est soumis au Row-Level Security. Une requête ne voit que les lignes de l'entreprise fixée pour sa transaction, même si le code applicatif oubliait un filtre.
- **Secrets SNMP** : chiffrés en AES-256-GCM avec `CREDENTIALS_ENCRYPTION_KEY`, jamais renvoyés par l'API.
- **Agents de collecte** : jeton propre à chaque agent, révocable, protégé sur le poste par DPAPI.

## Transport et en-têtes HTTP

En production, Nginx est le seul point d'entrée :

- TLS 1.2 et 1.3 seulement ; HTTP redirigé vers HTTPS ; HSTS d'un an ;
- `X-Forwarded-For` remplacé par l'adresse réelle du client : impossible de falsifier son adresse dans le journal d'audit ou de contourner la limitation des connexions ;
- corps de requête limité à 60 Mo (fichiers PDF de 50 Mo).

Le frontend ajoute à chaque réponse :

| En-tête                      | Valeur                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `Content-Security-Policy`    | Tout depuis la même origine ; aucun objet, aucun cadre (`frame-ancestors 'none'`) |
| `X-Frame-Options`            | `DENY`                                                                            |
| `X-Content-Type-Options`     | `nosniff`                                                                         |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`                                                 |
| `Permissions-Policy`         | Caméra, micro, géolocalisation et paiement désactivés                             |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                                     |

L'API ajoute les en-têtes de Helmet. Next.js injecte des scripts en ligne : la CSP autorise donc `'unsafe-inline'` pour les scripts, mais aucune source externe.

## Journal d'audit

Toute action sensible est enregistrée dans `audit_logs` : connexions, utilisateurs, entreprises, parc, relevés, stocks, contrats, relevés de facturation, interventions, et chaque export de rapport ou du journal lui-même.

- **En ajout seul.** Un déclencheur PostgreSQL refuse toute modification, pour tous les rôles, propriétaire compris.
- **Purge encadrée.** Une entrée ne peut être supprimée que par la fonction `purge_audit_logs(date)`. Elle refuse une date de moins d'un an, et seul le rôle `arksen_system` peut l'exécuter. Même en contournant l'application, une entrée de moins d'un an ne peut pas être effacée.
- **Consultation.** Un administrateur d'entreprise lit le journal de son entreprise ; le Super Administrateur lit celui de toute la plateforme.
- **Export.** Les deux journaux s'exportent en CSV sur une période (100 000 entrées au plus par export), depuis la page « Journal d'audit » ou « Administration système ». Archivez ces exports avant la fin de la durée de conservation si une obligation légale l'exige.

## Conservation des données

L'API applique chaque jour la politique ci-dessous. Un verrou Redis garantit une seule purge par jour, même avec plusieurs instances. Le Super Administrateur la consulte et peut la lancer à la main depuis « Administration système ». Chaque exécution est inscrite au journal (`system.retention_applied`), avec le nombre de lignes supprimées.

| Donnée                                  | Durée par défaut  | Variable                       |
| --------------------------------------- | ----------------- | ------------------------------ |
| Journal d'audit                         | 3 ans (1 an min.) | `RETENTION_AUDIT_DAYS`         |
| Événements reçus des agents             | 180 jours         | `RETENTION_AGENT_EVENTS_DAYS`  |
| Journal des synchronisations des agents | 180 jours         | `RETENTION_SYNC_LOGS_DAYS`     |
| Historique des niveaux de toner         | 2 ans             | `RETENTION_SUPPLY_LEVELS_DAYS` |
| Alertes clôturées                       | 1 an              | `RETENTION_ALERTS_DAYS`        |

Ne sont **jamais** purgés : les relevés de compteurs, les registres de stock et de papier, les remplacements de toner, les relevés de facturation, les interventions, les impressions enregistrées. Ce sont des données de gestion, pas des traces techniques. Le dernier niveau connu de chaque toner est toujours gardé, quel que soit son âge.

## Sauvegardes

Le service `backup` de la pile de production sauvegarde la base chaque jour, avec une empreinte SHA-256 vérifiée à la restauration. Voir [deployment.md](deployment.md). La clé `CREDENTIALS_ENCRYPTION_KEY` doit être sauvegardée à part : sans elle, les secrets SNMP d'une sauvegarde restaurée sont illisibles.

## Agent Windows

- `build.ps1` publie `SHA256SUMS.txt` avec l'empreinte de l'exécutable et de l'archive.
- Avec un certificat de signature de code (`ARKSEN_SIGN_PFX` ou `ARKSEN_SIGN_THUMBPRINT`), l'exécutable est signé et horodaté ; `install.ps1` affiche le signataire, ou avertit si l'exécutable n'est pas signé.
- Pour un serveur On-Premise à certificat interne, l'agent fait confiance à l'autorité fournie (`-CaFile ca.pem`) en plus de celles de Windows ; il ne désactive jamais la vérification TLS.

## Signaler une faille

Écrire à l'équipe Arksen plutôt que d'ouvrir un ticket public, avec les étapes pour reproduire.
