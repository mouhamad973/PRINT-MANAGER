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

| Variable               | Exemple  | Rôle                                                                               |
| ---------------------- | -------- | ---------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`   | (secret) | Signature des sessions, 32 caractères minimum. Le changer déconnecte tout le monde |
| `SUPER_ADMIN_EMAIL`    | (vide)   | Premier Super Administrateur, créé au démarrage si aucun n'existe                  |
| `SUPER_ADMIN_PASSWORD` | (vide)   | Son mot de passe, 12 caractères minimum                                            |
| `SUPER_ADMIN_NAME`     | (vide)   | Son nom, « Administrateur Arksen » par défaut                                      |

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

Tous les ports sont publiés sur `127.0.0.1` uniquement. L'exposition réseau, Nginx et HTTPS sont traités en Phase 10.

## Variables par service

Dans Docker, le fichier Compose construit ces variables. Hors Docker, elles viennent de `.env`.

| Service   | Variable              | Obligatoire | Rôle                                          |
| --------- | --------------------- | ----------- | --------------------------------------------- |
| API       | `DEPLOYMENT_MODE`     | Oui         | Mode de déploiement                           |
| API       | `DATABASE_APP_URL`    | Oui         | Connexion du rôle `arksen_app`                |
| API       | `DATABASE_SYSTEM_URL` | Oui         | Connexion du rôle `arksen_system`             |
| API       | `REDIS_URL`           | Oui         | Connexion Redis                               |
| API       | `ANALYTICS_URL`       | Oui         | Adresse du service d'analyse                  |
| API       | `PUBLIC_WEB_URL`      | Oui         | Origine autorisée pour l'authentification     |
| API       | `BETTER_AUTH_SECRET`  | Oui         | Secret des sessions                           |
| API       | `SUPER_ADMIN_*`       | Non         | Premier Super Administrateur                  |
| API       | `API_PORT`            | Non         | Port d'écoute, 4000 par défaut                |
| Workers   | `REDIS_URL`           | Oui         | Connexion Redis                               |
| Web       | `API_INTERNAL_URL`    | Non         | Adresse de l'API, lue à l'exécution           |
| Migration | `DATABASE_URL`        | Oui         | Connexion du propriétaire de la base          |
| Migration | `APP_DB_PASSWORD`     | Oui         | Mot de passe appliqué au rôle `arksen_app`    |
| Migration | `SYSTEM_DB_PASSWORD`  | Oui         | Mot de passe appliqué au rôle `arksen_system` |

L'API et les workers refusent de démarrer si une variable obligatoire manque ou est invalide.
