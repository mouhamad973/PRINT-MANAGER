# ARKSEN PRINT MANAGER

Plateforme de gestion et de supervision des parcs d'impression numérique, avec un moteur de calcul de consommation toner basé sur l'aplat CMJN. Une même base de code se déploie en Cloud multi-clients ou en On-Premise, avec un agent Windows chez le client.

L'avancement du projet est suivi dans [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Démarrage rapide

Prérequis : Docker Desktop.

```bash
cp .env.example .env
```

Dans `.env`, remplacez les mots de passe et `BETTER_AUTH_SECRET`, y compris dans les URL de connexion en bas du fichier. Renseignez aussi `SUPER_ADMIN_EMAIL` et `SUPER_ADMIN_PASSWORD` : ce premier compte est créé au démarrage. Démarrez ensuite la stack :

```bash
docker compose up --build --detach --wait
```

| Adresse                      | Service                         |
| ---------------------------- | ------------------------------- |
| http://localhost:3000        | Application web, avec connexion |
| http://localhost:4000/docs   | API : documentation Swagger     |
| http://localhost:4000/health | API : état réel des dépendances |
| http://localhost:8000/health | Service d'analyse               |

Connectez-vous avec le compte Super Administrateur, puis créez les entreprises clientes et leurs utilisateurs. Il n'existe pas d'inscription libre.

Pour constituer le parc d'une entreprise, dans l'ordre :

1. créez ses **sites** ;
2. vérifiez que le **catalogue Arksen** (Fiches techniques) contient les modèles utilisés, ou créez une fiche propre à l'entreprise ;
3. ajoutez les **machines**, puis renseignez leur configuration réseau et SNMP depuis leur fiche.

Le tableau de bord se remplit à mesure. La connectivité des machines reste « non mesurée » jusqu'à l'agent de collecte (Phase 7).

Pour vérifier la stack de bout en bout, avec Node.js et pnpm installés :

```bash
pnpm stack:smoke
```

Pour vérifier l'authentification et l'isolation entre entreprises sur la stack démarrée :

```bash
pnpm --filter @arksen/api test:e2e
```

## Développement

Prérequis : Node.js 24, pnpm 10 et Python 3.12.

```bash
pnpm install
```

```bash
pnpm build
```

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm test
```

Le guide complet se trouve dans [docs/development.md](docs/development.md).

## Structure

| Dossier                 | Rôle                                 |
| ----------------------- | ------------------------------------ |
| `apps/web`              | Application Next.js                  |
| `apps/api`              | API REST NestJS                      |
| `services/analytics`    | Analyse PDF et calcul CMJN (FastAPI) |
| `services/workers`      | Tâches asynchrones BullMQ            |
| `services/collector`    | Agent Windows ARKSEN Collector       |
| `packages/shared-types` | Types et constantes partagés         |
| `packages/validation`   | Schémas Zod partagés                 |
| `packages/database`     | Schéma Prisma, migrations et client  |
| `infrastructure`        | Dockerfiles et fichiers Compose      |
| `docs`                  | Documentation technique              |

## Documentation

- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Développement](docs/development.md)
- [Design system](docs/design-system.md)
