# Développement

## Prérequis

- Node.js 24 (`.nvmrc`). Prisma 7.10 ne supporte pas officiellement Node 26.
- pnpm 10
- Python 3.12
- Docker Desktop

## Installation

```bash
pnpm install
```

```bash
cp .env.example .env
```

Les environnements virtuels Python se créent seuls au premier lancement d'une commande Python.

## Commandes

| Commande                             | Effet                                                         |
| ------------------------------------ | ------------------------------------------------------------- |
| `pnpm build`                         | Compile les paquets et applications TypeScript                |
| `pnpm typecheck`                     | Vérifie les types (TypeScript et mypy)                        |
| `pnpm lint`                          | Analyse le code (ESLint et Ruff)                              |
| `pnpm test`                          | Lance tous les tests (Vitest et pytest)                       |
| `pnpm stack:up`                      | Construit et démarre la stack Docker                          |
| `pnpm stack:smoke`                   | Vérifie la stack démarrée de bout en bout                     |
| `pnpm --filter @arksen/api test:e2e` | Teste l'authentification et l'isolation sur la stack démarrée |
| `pnpm stack:down`                    | Arrête la stack                                               |
| `pnpm stack:logs`                    | Suit les journaux                                             |
| `pnpm db:generate`                   | Génère le client Prisma                                       |
| `pnpm db:migrate`                    | Crée et applique une migration en développement               |
| `pnpm db:deploy`                     | Applique les migrations existantes                            |

## Base de données

Le schéma se trouve dans `packages/database/prisma/schema.prisma`. La stack Docker applique les migrations au démarrage, avec le service `migrate`.

Pour faire évoluer le schéma, démarrez PostgreSQL, puis créez la migration :

```bash
docker compose up --detach --wait postgres
```

```bash
pnpm db:migrate
```

Après une migration qui crée une table, relancez la stack : le service `migrate` accorde alors aux rôles `arksen_app` et `arksen_system` leurs droits sur la nouvelle table.

## Première connexion

L'API crée le premier Super Administrateur à son démarrage, à partir de `SUPER_ADMIN_EMAIL` et `SUPER_ADMIN_PASSWORD`, si aucun n'existe. Hors Docker, avec `pnpm dev`, l'application s'ouvre sur http://localhost:3000.

## Tests de bout en bout

`apps/api/test/e2e` contient des tests qui visent la stack Docker démarrée (`isolation.e2e.test.ts` pour l'authentification, `fleet.e2e.test.ts` pour le parc machines, `meters.e2e.test.ts` pour les compteurs, `consumption.e2e.test.ts` pour le moteur CMJN), à travers le relais du frontend comme un vrai navigateur. Ils vérifient la connexion, les rôles, l'isolation entre entreprises au niveau de l'API et de PostgreSQL, la désactivation des comptes, la suspension des entreprises et la limitation des tentatives.

Ils ne font pas partie de `pnpm test`, car ils écrivent de vraies données. Les entreprises qu'ils créent ont un identifiant commençant par `e2e-`. Ils lisent `SUPER_ADMIN_*`, `DATABASE_APP_URL` et `DATABASE_SYSTEM_URL` dans `.env`.

## Ajouter un module

- **API :** un dossier `apps/api/src/<module>` avec son module, son contrôleur et son service, et des tests `*.test.ts` à côté.
- **Web :** un dossier `apps/web/src/features/<module>`, une route dans `apps/web/src/app`, puis renseigner `href` dans `components/layout/navigation.ts` à la place de `phase`.
- **Contrats partagés :** les types vont dans `packages/shared-types`, les schémas Zod dans `packages/validation`.
- **Permissions :** ajoutez-les dans `packages/shared-types/src/access.ts`, puis déclarez-les sur les routes avec `@RequirePermissions()`. Côté web, `navigation.ts` et `RequirePermission` masquent ce que le rôle ne permet pas.
- **Données d'entreprise :** suivez la règle de la section « Isolation multi-tenant » de [l'architecture](architecture.md) : colonne `tenant_id`, politique RLS dans la migration, accès par `withTenant()`.
