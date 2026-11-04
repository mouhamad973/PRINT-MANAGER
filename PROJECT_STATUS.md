# État du projet ARKSEN PRINT MANAGER

Dernière mise à jour : 4 novembre 2026.

## Avancement

| Phase | Contenu                                      | État                               |
| ----- | -------------------------------------------- | ---------------------------------- |
| 1     | Architecture et configuration du projet      | Terminée et validée                |
| 2     | Authentification et gestion des utilisateurs | Terminée et validée                |
| 3     | Dashboard et gestion du parc machines        | Terminée, en attente de validation |
| 4     | Compteurs et historique                      | À faire                            |
| 5     | Moteur de calcul de consommation CMJN        | À faire                            |
| 6     | Analyse PDF                                  | À faire                            |
| 7     | Collecteur SNMP et agent Windows             | À faire                            |
| 8     | Gestion des consommables et stocks           | À faire                            |
| 9     | Coûts, maintenance et contrats               | À faire                            |
| 10    | Rapports et déploiement commercial           | À faire                            |

## Phase 1 : Architecture et configuration

### Livré

- **Monorepo :** pnpm 10 et Turborepo, avec `apps/web`, `apps/api`, `services/analytics`, `services/workers`, `services/collector`, `packages/shared-types`, `packages/validation` et `packages/database`.
- **API NestJS 12 :**
  - `GET /health` vérifie réellement PostgreSQL, Redis, le service d'analyse et les workers ;
  - `GET /api/v1/system/info` expose le nom, la version et le mode de déploiement ;
  - Swagger est servi sur `/docs`, et le document OpenAPI sur `/docs/openapi.json` ;
  - la configuration est validée par Zod au démarrage.
- **Base de données :** Prisma 7.10 avec PostgreSQL 18, et une migration initiale minimale (`system_settings`). Le modèle métier arrive en Phase 2.
- **Redis et BullMQ :** les workers traitent une tâche planifiée de heartbeat dans la file `system`, ce qui prouve toute la chaîne.
- **Service d'analyse :** FastAPI avec `GET /health`. Le moteur CMJN et l'analyse PDF arrivent en Phases 5 et 6.
- **Agent Windows :** paquet Python de base. Il refuse explicitement de s'exécuter tant que la collecte n'existe pas (Phase 7).
- **Frontend Next.js 16 :**
  - structure de l'interface : sidebar, header, thèmes clair et sombre, navigation mobile ;
  - page « État de la plateforme », connectée à l'API et rafraîchie toutes les 15 secondes ;
  - page « Design system », qui démontre les composants, React Hook Form avec Zod, et Recharts.
- **Docker :** un Dockerfile par service, et une stack Compose avec healthchecks et migration automatique. `docker compose up` démarre l'ensemble.
- **Configuration :** `.env.example` documenté, et `DEPLOYMENT_MODE` pour choisir `cloud` ou `on-premise`.
- **Documentation :** `README.md` et `docs/` (architecture, configuration, développement, design system).

### Critères d'acceptation

| Critère                                            | Résultat                                |
| -------------------------------------------------- | --------------------------------------- |
| `pnpm install` sans erreur                         | Validé                                  |
| `build`, `typecheck`, `lint` et `test` passent     | Validé : 30 tâches sur 30               |
| Les tests automatisés passent                      | Validé : 38 tests (35 Vitest, 3 pytest) |
| `docker compose up` : tous les services sont sains | Validé                                  |
| `/health` vérifie réellement la base et Redis      | Validé, y compris en panne              |
| Swagger accessible                                 | Validé                                  |
| Interface en thème clair et sombre, et sur mobile  | Validé                                  |

Détail des tests :

| Paquet                 | Tests |
| ---------------------- | ----- |
| `@arksen/api`          | 10    |
| `@arksen/web`          | 10    |
| `@arksen/validation`   | 8     |
| `@arksen/shared-types` | 3     |
| `@arksen/database`     | 2     |
| `@arksen/workers`      | 2     |
| `@arksen/collector`    | 2     |
| `@arksen/analytics`    | 1     |

Vérification de bout en bout (`pnpm stack:smoke`) : 8 contrôles sur 8 réussis sur la stack Docker.

Comportement en panne, vérifié sur la stack réelle :

| Situation            | Réponse de `/health`                             |
| -------------------- | ------------------------------------------------ |
| Workers arrêtés      | HTTP 200, `degraded`, « aucun heartbeat récent » |
| PostgreSQL arrêté    | HTTP 503, `error`                                |
| PostgreSQL redémarré | HTTP 200, sans redémarrer l'API                  |

### Écarts par rapport au plan

- **Node.js 24 au lieu de 26 :** Prisma 7.10 ne supporte que les versions 20, 22 et 24. Les images Docker et `.nvmrc` utilisent Node 24. La machine de développement a Node 26, sur lequel tout fonctionne malgré l'avertissement de Prisma.
- **Ports publiés 15432 et 16379 :** des installations locales de PostgreSQL occupent déjà les ports 5432 et 5433, et Redis le 6379.
- **Nginx reporté en Phase 10,** avec les configurations Compose Cloud et On-Premise. En Phase 1, les ports ne sont publiés que sur `127.0.0.1`.

### Points restants

- **ESLint 9** est signalée obsolète par npm. Le passage à ESLint 10 reste à faire.
- **Starlette** signale la dépréciation de `httpx` pour son client de test. Cela ne concerne que les tests.
- **Licences AGPL :** PyMuPDF et Ghostscript, prévus en Phase 6, sont sous AGPL ou sous licence commerciale Artifex. À faire vérifier par un juriste avant toute commercialisation.
- **Aucun commit :** le dépôt git est initialisé, mais rien n'a encore été commité.

## Phase 3 : Dashboard et gestion du parc machines

### Livré

- **Tableau de bord** (`/dashboard`, page d'arrivée après connexion) : machines du parc, répartition par statut, par site et par fabricant, part des machines prêtes pour la collecte, et liste des machines à surveiller. Filtres par site et par type couleur. Uniquement des comptages réels : les indicateurs des phases suivantes sont annoncés avec leur phase, jamais simulés.
- **Clients et sites** : les entreprises clientes existaient depuis la Phase 2. Les sites sont créés, modifiés et supprimés s'ils sont vides, avec le nombre de machines de chacun.
- **Machines** : ajout et modification (nom, numéro de série unique par entreprise, site, modèle, emplacement, numéro d'inventaire, date d'installation, notes), liste filtrable par site, statut, type couleur et recherche (nom, série, adresse IP). La recherche de l'en-tête est active.
- **Fiches techniques** : fabricant, modèle, couleur ou noir et blanc, technologie, format maximal, recto verso, vitesses, volumes mensuels maximal et recommandé. Un **catalogue Arksen** partagé par toutes les entreprises est géré par la plateforme ; chaque entreprise peut créer ses propres fiches.
- **Statuts des équipements** : en service, en maintenance, hors service, retirée du parc. Chaque changement est tracé dans le journal d'audit. La **connectivité** (en ligne, hors ligne) est un champ distinct, « non mesurée » jusqu'à l'agent de collecte de la Phase 7.
- **Configuration réseau** : adresse IP (v4 ou v6), nom d'hôte, adresse MAC, SNMP v1, v2c ou v3 (utilisateur, niveau de sécurité, protocoles d'authentification et de chiffrement). Les secrets SNMP sont **chiffrés en AES-256-GCM**, en écriture seule, et ne sont jamais renvoyés au navigateur ni écrits dans le journal.
- **Permissions** : sept nouvelles permissions. Tous les rôles consultent le parc ; administrateurs et responsables d'impression le gèrent ; les techniciens gèrent les machines, leur statut et leur réseau.
- **Plateforme** : le Super Administrateur choisit l'entreprise à consulter dans les pages du parc, et gère le catalogue Arksen.

Décisions détaillées dans [docs/architecture.md](docs/architecture.md), section « Parc machines ».

### Critères d'acceptation

| Critère                                        | Résultat                                                   |
| ---------------------------------------------- | ---------------------------------------------------------- |
| Tableau de bord général                        | Validé, avec des données réelles uniquement                |
| Gestion des clients et des sites               | Validé                                                     |
| Ajout et modification des machines             | Validé                                                     |
| Fiches techniques                              | Validé : catalogue Arksen et fiches propres à l'entreprise |
| Statuts des équipements                        | Validé, tracés dans le journal d'audit                     |
| Configuration réseau des imprimantes           | Validé, secrets SNMP chiffrés et jamais renvoyés           |
| Isolation des données par entreprise           | Validé au niveau de l'API et de PostgreSQL                 |
| `build`, `typecheck`, `lint` et `test` passent | Validé : 30 tâches sur 30, sans cache                      |

Détail des tests :

| Paquet                 | Tests | Dont nouveaux en Phase 3 |
| ---------------------- | ----- | ------------------------ |
| `@arksen/api`          | 40    | 12                       |
| `@arksen/validation`   | 36    | 13                       |
| `@arksen/web`          | 28    | 4                        |
| `@arksen/shared-types` | 11    | 2                        |
| `@arksen/database`     | 2     |                          |
| `@arksen/workers`      | 2     |                          |
| `@arksen/collector`    | 2     |                          |
| `@arksen/analytics`    | 1     |                          |

Soit 122 tests unitaires et d'intégration, et **41 tests de bout en bout** sur la stack Docker réelle (19 nouveaux, dans `apps/api/test/e2e/fleet.e2e.test.ts`), tous réussis. Ils vérifient notamment :

- l'accès refusé aux sites, machines et tableau de bord d'une autre entreprise (404), et le refus d'utiliser son site ou sa fiche privée (400) ;
- qu'une entreprise lit le catalogue Arksen sans pouvoir le modifier, ni par l'API ni directement en SQL ;
- que la base refuse, même au rôle système, une machine rattachée au site ou à la fiche privée d'une autre entreprise ;
- que la communauté SNMP est stockée chiffrée et n'apparaît dans aucune réponse ni dans le journal ;
- qu'un simple utilisateur consulte le parc sans pouvoir le modifier ;
- les comptages du tableau de bord et ses filtres.

Vérification de la stack (`pnpm stack:smoke`) : 11 contrôles sur 11.

Vérification visuelle : tableau de bord, machines, fiche d'une machine, dialogue de création, sites et fiches techniques, en clair, en sombre et sur mobile, sans erreur dans la console. Elle a été faite avec l'administrateur de l'entreprise de test `demo-interface`, sur des données de démonstration signalées comme telles (« (démo) », séries `DEMO-…`). Les écrans propres à la plateforme (choix de l'entreprise, gestion du catalogue Arksen) sont couverts par les tests de bout en bout, mais n'ont pas été vus à l'écran.

### Écarts par rapport au plan

- **Ordre des phases :** le plan suivi est le vôtre (Phase 3 : tableau de bord et parc). Le `Prompt.txt` répartissait ces sujets sur ses Phases 3 et 4.
- **Fiches techniques en deux niveaux** (catalogue Arksen et fiches d'entreprise), pour ne pas ressaisir les mêmes modèles chez chaque client.
- **Pas de suppression de machine :** une machine est « retirée du parc », pour garder l'historique des phases suivantes.
- **Page d'arrivée :** après connexion, l'utilisateur arrive sur le tableau de bord, et non plus sur l'état de la plateforme.

### Points restants

- **Clé de chiffrement SNMP :** `CREDENTIALS_ENCRYPTION_KEY` doit être sauvegardée avec la base. Sa rotation (rechiffrement des secrets) est à outiller avant la mise en production.
- **Catalogue Arksen vide :** aucune caractéristique de modèle réel n'a été inventée. Le catalogue est à remplir avec des fiches constructeur vérifiées.
- **Connectivité et indicateurs de consommation :** à venir avec les Phases 4 à 9, comme annoncé sur le tableau de bord.
- **Données de test :** l'entreprise `demo-interface` porte des données de démonstration (3 sites, 3 fiches, 8 machines) ; les tests de bout en bout laissent des entreprises `e2e-…`. Le catalogue partagé, lui, est nettoyé après chaque exécution.
- **Points des phases précédentes toujours ouverts :** voir les sections Phase 1 et Phase 2.

## Phase 2 : Authentification et gestion des utilisateurs

### Livré

- **Connexion et déconnexion :** Better Auth, monté dans l'API et servi au navigateur par le relais `/backend`. La session est un cookie `HttpOnly` de première partie, valable 12 heures. L'inscription libre est désactivée.
- **Rôles et permissions :** les six rôles du cahier des charges, et une matrice de permissions définie dans `packages/shared-types/src/access.ts`. Deux gardes globaux protègent toutes les routes : authentification, puis périmètre et permissions.
- **Entreprises clientes :** création, modification, suspension et réactivation par le Super Administrateur. Suspendre une entreprise ferme les sessions de ses utilisateurs et bloque leurs connexions.
- **Utilisateurs :** création avec mot de passe temporaire, modification du nom, du rôle et du statut, réinitialisation du mot de passe. Désactiver un compte ferme ses sessions. Un administrateur ne peut ni attribuer le rôle Super Administrateur, ni modifier son propre rôle ou statut.
- **Isolation des données, en trois couches :**
  - l'entreprise vient toujours de la session, jamais du corps de la requête ; une autre entreprise répond 404 ;
  - chaque requête filtre sur l'entreprise ;
  - PostgreSQL applique le Row-Level Security. L'API se connecte avec deux rôles dédiés : `arksen_app`, soumis au RLS, et `arksen_system`, réservé à l'authentification et au journal d'audit.
- **Profil :** modification du nom et changement du mot de passe, qui ferme les autres sessions.
- **Journal d'audit :** connexions réussies, échouées ou refusées, changements de mot de passe, et toute modification d'entreprise ou d'utilisateur. La table est en ajout seul, garanti par un déclencheur PostgreSQL.
- **Sécurisation des API :** en-têtes de sécurité (helmet), validation Zod de toutes les entrées, origine contrôlée sur l'authentification, 5 tentatives de connexion par minute et par adresse IP, et messages d'erreur qui ne révèlent pas l'existence d'un compte.
- **Interface :** page de connexion, menu utilisateur, pages Entreprises, Utilisateurs, Profil et Journal d'audit. La navigation n'affiche que ce que le rôle permet.

Les décisions sont détaillées dans [docs/architecture.md](docs/architecture.md), sections « Authentification », « Contrôle d'accès », « Isolation multi-tenant » et « Journal d'audit ».

### Critères d'acceptation

| Critère                                                              | Résultat                                   |
| -------------------------------------------------------------------- | ------------------------------------------ |
| Connexion et déconnexion                                             | Validé, tests de bout en bout              |
| Rôles et permissions appliqués par l'API                             | Validé : 401, 403 ou 404 selon le cas      |
| Gestion des entreprises clientes                                     | Validé                                     |
| Une entreprise ne voit jamais les données d'une autre                | Validé au niveau de l'API et de PostgreSQL |
| Un `tenantId` fourni par le client est ignoré                        | Validé                                     |
| Compte désactivé ou entreprise suspendue : accès coupé immédiatement | Validé                                     |
| Profil utilisateur                                                   | Validé                                     |
| Journal d'audit des actions sensibles, non modifiable                | Validé                                     |
| `build`, `typecheck`, `lint` et `test` passent                       | Validé : 30 tâches sur 30, sans cache      |

Détail des tests :

| Paquet                 | Tests | Dont nouveaux en Phase 2 |
| ---------------------- | ----- | ------------------------ |
| `@arksen/api`          | 28    | 18                       |
| `@arksen/web`          | 24    | 14                       |
| `@arksen/validation`   | 23    | 15                       |
| `@arksen/shared-types` | 9     | 6                        |
| `@arksen/database`     | 2     |                          |
| `@arksen/workers`      | 2     |                          |
| `@arksen/collector`    | 2     |                          |
| `@arksen/analytics`    | 1     |                          |

Soit 91 tests unitaires et d'intégration, auxquels s'ajoutent **22 tests de bout en bout** sur la stack Docker réelle (`pnpm --filter @arksen/api test:e2e`), tous réussis. Ils vérifient notamment :

- l'accès refusé à une autre entreprise, en lecture comme en écriture, et l'interdiction des routes de plateforme ;
- au niveau SQL, avec le rôle `arksen_app` : aucune ligne sans contexte, uniquement celles de l'entreprise avec contexte, écriture vers une autre entreprise rejetée, aucun accès aux sessions ni aux mots de passe ;
- que toute table portant `tenant_id` a le RLS activé ;
- que le journal d'audit refuse toute modification ;
- la désactivation d'un compte, puis la suspension et la réactivation d'une entreprise ;
- la limitation des tentatives de connexion (HTTP 429).

Vérification de la stack (`pnpm stack:smoke`) : 11 contrôles sur 11, dont la redirection des pages protégées vers la connexion et le refus d'accès anonyme à l'API.

Vérification dans le navigateur : redirection vers `/login` avec retour à la page demandée, message d'erreur sur des identifiants faux, thèmes clair et sombre, affichage mobile. **Les pages connectées n'ont pas été vérifiées visuellement**, car la lecture du mot de passe de développement du Super Administrateur a été refusée par l'outil. Leur comportement est couvert par les tests de composants et de bout en bout.

### Écarts par rapport au plan

- **Rôles PostgreSQL dédiés :** l'isolation par entreprise est garantie par la base elle-même, et pas seulement par le code. Cela ajoute `APP_DB_PASSWORD` et `SYSTEM_DB_PASSWORD` à la configuration.
- **Matrice des permissions dans le code**, et non en base, faute de besoin métier pour la modifier à l'exécution.

### Points restants

- **Proxy frontal :** la limitation des connexions lit l'adresse IP dans `X-Forwarded-For`. Sans proxy frontal, un poste du réseau local peut la falsifier. Nginx, en Phase 10, devra écraser cet en-tête.
- **Limitation en mémoire :** les compteurs de tentatives sont propres à chaque instance de l'API. Avec plusieurs instances, il faudra les stocker dans Redis.
- **Mot de passe temporaire :** son changement n'est pas encore imposé à la première connexion.
- **Mot de passe oublié :** pas de réinitialisation par e-mail, faute de service d'envoi. Un administrateur réinitialise le mot de passe.
- **Double authentification :** non prévue par le plan, à envisager pour les Super Administrateurs.
- **Conservation du journal d'audit :** politique de purge à définir en Phase 10.
- **Données de test :** les tests de bout en bout laissent dans la base de développement des entreprises dont l'identifiant commence par `e2e-`.
- **Points de la Phase 1 toujours ouverts :** ESLint 10, licences AGPL de la Phase 6, aucun commit.

## Journal des modifications

### 4 novembre 2026 : Phase 3

- **Base de données :** migration `20261104000000_fleet` : tables `sites`, `printer_models`, `printers` et `printer_connections`, politiques RLS (dont lecture du catalogue partagé), clés étrangères composites et déclencheur `printers_model_scope`.
- **API :** modules `sites`, `printer-models` (catalogue de plateforme et fiches d'entreprise), `printers` (machines et configuration réseau) et `dashboard`. Chiffrement `common/secret-box.ts`. Nouvelle variable `CREDENTIALS_ENCRYPTION_KEY`.
- **Contrats :** `packages/shared-types/src/fleet.ts` et `packages/validation/src/fleet.ts` ; sept permissions dans `access.ts`.
- **Web :** fonctionnalité `features/fleet` (tableau de bord, sites, machines, fiche machine, fiches techniques, formulaire réseau, choix de l'entreprise pour la plateforme), composants `Textarea`, `ConfirmDialog` et `EmptyState`, recherche de l'en-tête active, matrice des rôles transposée.
- **Tests :** `fleet.e2e.test.ts`, tests du chiffrement, des secrets SNMP, des schémas et du formulaire réseau.
- **Documentation :** `README.md`, `docs/architecture.md`, `docs/configuration.md` et `docs/development.md`.

### 4 novembre 2026 : refonte visuelle de l'interface

Demandée avant la Phase 3, d'après trois maquettes choisies par le client. Le détail est dans [docs/design-system.md](docs/design-system.md).

- **Direction :** panneaux blancs flottants sur un canevas gris-vert, accent vert sapin, carte vedette en dégradé, boutons pilule. En thème sombre, une ardoise froide en couches.
- **Police :** Geist remplace Archivo.
- **Shell :** sidebar à sections avec bloc organisation et barre d'élément actif, en-tête flottant avec le compte de l'utilisateur.
- **Composants :** nouveaux `StatCard`, `PanelHeader`, `IconButton` et `StatusDot` ; tous les composants existants sont restylés. Les alias de variables shadcn/ui sont en place, pour ajouter ses composants sans adaptation.
- **Pages :** l'état de la plateforme devient un tableau de bord d'indicateurs ; la page de connexion a un panneau de marque ; le profil a une carte de résumé. Une icône d'onglet est ajoutée.
- **Aucune fonctionnalité modifiée :** 24 tests web réussis, sans changement des tests.
- **Vérification visuelle :** toutes les pages en clair, en sombre et sur mobile, avec un compte de test de l'entreprise `demo-interface`. Ses identifiants sont dans `.env` (`UI_TEST_*`), qui n'est pas versionné.

### 3 novembre 2026 : Phase 2

- **Base de données :** modèles `Tenant`, `User`, `Session`, `Account`, `Verification` et `AuditLog`. Migration `20261103000000_auth_tenants`, avec les politiques RLS et le déclencheur du journal d'audit. Script `packages/database/scripts/provision.mjs`, qui crée les rôles et applique leurs droits. Fonction `withTenant()`.
- **API :** modules `auth`, `audit`, `tenants`, `users` et `me`, gardes globaux, validation Zod (`common/zod.ts`) et en-têtes de sécurité. Tests de bout en bout dans `apps/api/test/e2e`.
- **Contrats :** `packages/shared-types/src/access.ts` (rôles, permissions, types) et `packages/validation/src/access.ts` (schémas des formulaires et de l'API).
- **Web :** `src/proxy.ts`, page de connexion, fonctionnalités `session`, `tenants`, `users`, `profile` et `audit`, et nouveaux composants d'interface (dialogue, liste déroulante, pagination, champ de recherche, badge de statut).
- **Infrastructure :** variables d'authentification et rôles PostgreSQL dans Compose et dans `.env.example`.
- **Corrections :** délais des tests API relevés, et workers Vitest du web limités à deux. Les deux suites échouaient par intermittence pendant un `next build` en parallèle. Le smoke test vérifie désormais la redirection vers la connexion.
- **Documentation :** `README.md`, `docs/architecture.md`, `docs/configuration.md` et `docs/development.md`.

### 3 novembre 2026 : Phase 1

Création du socle complet, décrit ci-dessus. Les fichiers créés sont listés dans `README.md`, section « Structure ».
