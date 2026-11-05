# Configuration

Toute la configuration passe par des variables d'environnement. `.env.example` sert de modèle, et `.env` n'est jamais versionné.

## Variables de `.env`

### Général

| Variable          | Exemple                 | Rôle                                                                         |
| ----------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `DEPLOYMENT_MODE` | `cloud`                 | `cloud` ou `on-premise`                                                      |
| `NODE_ENV`        | `production`            | Environnement Node.js                                                        |
| `PUBLIC_WEB_URL`  | `http://localhost:3000` | Adresse ouverte par les utilisateurs : seule origine acceptée à la connexion |

### Base de données

| Variable             | Exemple  | Rôle                                                               |
| -------------------- | -------- | ------------------------------------------------------------------ |
| `POSTGRES_USER`      | `arksen` | Propriétaire de la base, utilisé uniquement pour les migrations    |
| `POSTGRES_PASSWORD`  | (secret) | Mot de passe du propriétaire                                       |
| `POSTGRES_DB`        | `arksen` | Nom de la base                                                     |
| `APP_DB_PASSWORD`    | (secret) | Mot de passe du rôle `arksen_app`, soumis au Row-Level Security    |
| `SYSTEM_DB_PASSWORD` | (secret) | Mot de passe du rôle `arksen_system`, réservé à l'authentification |
| `POSTGRES_HOST_PORT` | `15432`  | Port publié, pour éviter un PostgreSQL local sur 5432 ou 5433      |

Les rôles `arksen_app` et `arksen_system` sont créés et mis à jour par le service `migrate`, à chaque démarrage. Changer leur mot de passe dans `.env`, puis redémarrer la stack, suffit à le faire tourner.

### Redis

| Variable          | Exemple  | Rôle                                             |
| ----------------- | -------- | ------------------------------------------------ |
| `REDIS_PASSWORD`  | (secret) | Mot de passe Redis                               |
| `REDIS_HOST_PORT` | `16379`  | Port publié, pour éviter un Redis local sur 6379 |

### Authentification

| Variable                     | Exemple  | Rôle                                                                                                                          |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`         | (secret) | Signature des sessions, 32 caractères minimum. Le changer déconnecte tout le monde                                            |
| `CREDENTIALS_ENCRYPTION_KEY` | (secret) | Clé AES-256 des secrets SNMP, 64 caractères hexadécimaux. À sauvegarder avec la base : sans elle, les secrets sont illisibles |
| `SUPER_ADMIN_EMAIL`          | (vide)   | Premier Super Administrateur, créé au démarrage si aucun n'existe                                                             |
| `SUPER_ADMIN_PASSWORD`       | (vide)   | Son mot de passe, 12 caractères minimum                                                                                       |
| `SUPER_ADMIN_NAME`           | (vide)   | Son nom, « Administrateur Arksen » par défaut                                                                                 |

Les trois variables `SUPER_ADMIN_*` ne servent qu'à la première installation. Elles sont ignorées dès qu'un Super Administrateur existe, et peuvent alors être retirées.

### Ports publiés

| Variable              | Exemple | Rôle                             |
| --------------------- | ------- | -------------------------------- |
| `API_HOST_PORT`       | `4000`  | Port publié de l'API             |
| `WEB_HOST_PORT`       | `3000`  | Port publié du web               |
| `ANALYTICS_HOST_PORT` | `8000`  | Port publié du service d'analyse |

Les mots de passe sont insérés tels quels dans des URL de connexion. Limitez-les aux lettres et aux chiffres, ou encodez les caractères spéciaux. Pour générer un secret :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

En développement, tous les ports sont publiés sur `127.0.0.1` uniquement. En production, seul Nginx publie des ports (80 et 443) : voir [deployment.md](deployment.md).

### Conservation des données

Durées en jours, appliquées chaque jour par l'API (voir [security.md](security.md)). Vides, elles prennent la valeur par défaut.

| Variable                       | Défaut | Minimum | Donnée purgée                                          |
| ------------------------------ | ------ | ------- | ------------------------------------------------------ |
| `RETENTION_AUDIT_DAYS`         | `1095` | `365`   | Journal d'audit                                        |
| `RETENTION_AGENT_EVENTS_DAYS`  | `180`  | `30`    | Événements reçus des agents de collecte                |
| `RETENTION_SYNC_LOGS_DAYS`     | `180`  | `30`    | Journal des synchronisations des agents                |
| `RETENTION_SUPPLY_LEVELS_DAYS` | `730`  | `90`    | Historique des niveaux de toner (le dernier est gardé) |
| `RETENTION_ALERTS_DAYS`        | `365`  | `30`    | Alertes clôturées                                      |

### Production

Variables propres au fichier `.env.production` (modèle : `.env.production.example`).

| Variable                | Exemple               | Rôle                                                                  |
| ----------------------- | --------------------- | --------------------------------------------------------------------- |
| `SERVER_NAME`           | `print.exemple.com`   | Nom DNS du serveur : certificat TLS et Nginx                          |
| `SERVER_IP`             | `192.168.1.20`        | On-Premise : adresse IP ajoutée au certificat (facultatif)            |
| `ACME_EMAIL`            | `it@exemple.com`      | Cloud : contact Let's Encrypt                                         |
| `HTTP_PORT`             | `80`                  | Port HTTP publié (redirection vers HTTPS et validation Let's Encrypt) |
| `HTTPS_PORT`            | `443`                 | Port HTTPS publié                                                     |
| `BACKUP_DIR`            | `/srv/arksen/backups` | Dossier de l'hôte qui reçoit les sauvegardes                          |
| `BACKUP_INTERVAL_HOURS` | `24`                  | Intervalle entre deux sauvegardes                                     |
| `BACKUP_RETENTION_DAYS` | `14`                  | Âge au-delà duquel une sauvegarde est supprimée                       |

## Variables par service

Dans Docker, le fichier Compose construit ces variables. Hors Docker, elles viennent de `.env`.

| Service   | Variable                     | Obligatoire | Rôle                                          |
| --------- | ---------------------------- | ----------- | --------------------------------------------- |
| API       | `DEPLOYMENT_MODE`            | Oui         | Mode de déploiement                           |
| API       | `DATABASE_APP_URL`           | Oui         | Connexion du rôle `arksen_app`                |
| API       | `DATABASE_SYSTEM_URL`        | Oui         | Connexion du rôle `arksen_system`             |
| API       | `REDIS_URL`                  | Oui         | Connexion Redis                               |
| API       | `ANALYTICS_URL`              | Oui         | Adresse du service d'analyse                  |
| API       | `PUBLIC_WEB_URL`             | Oui         | Origine autorisée pour l'authentification     |
| API       | `BETTER_AUTH_SECRET`         | Oui         | Secret des sessions                           |
| API       | `CREDENTIALS_ENCRYPTION_KEY` | Oui         | Chiffrement des secrets SNMP                  |
| API       | `SUPER_ADMIN_*`              | Non         | Premier Super Administrateur                  |
| API       | `API_PORT`                   | Non         | Port d'écoute, 4000 par défaut                |
| API       | `RETENTION_*`                | Non         | Durées de conservation des données            |
| Workers   | `REDIS_URL`                  | Oui         | Connexion Redis                               |
| Analyse   | `ANALYTICS_CMYK_ICC_PROFILE` | Non         | Profil ICC de sortie pour l'analyse PDF       |
| Web       | `API_INTERNAL_URL`           | Non         | Adresse de l'API, lue à l'exécution           |
| Migration | `DATABASE_URL`               | Oui         | Connexion du propriétaire de la base          |
| Migration | `APP_DB_PASSWORD`            | Oui         | Mot de passe appliqué au rôle `arksen_app`    |
| Migration | `SYSTEM_DB_PASSWORD`         | Oui         | Mot de passe appliqué au rôle `arksen_system` |

L'API et les workers refusent de démarrer si une variable obligatoire manque ou est invalide.

`ANALYTICS_CMYK_ICC_PROFILE` est le chemin, dans le conteneur d'analyse, d'un profil ICC CMJN (`.icc` ou `.icm`) : il faut monter le fichier dans le conteneur. Sans lui, l'analyse PDF applique la séparation de référence décrite dans [architecture.md](architecture.md), section « Analyse PDF ». Un profil illisible fait échouer les analyses avec un message explicite.
