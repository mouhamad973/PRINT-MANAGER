# État du projet ARKSEN PRINT MANAGER

Dernière mise à jour : 4 novembre 2026.

## Avancement

| Phase | Contenu                                      | État                               |
| ----- | -------------------------------------------- | ---------------------------------- |
| 1     | Architecture et configuration du projet      | Terminée et validée                |
| 2     | Authentification et gestion des utilisateurs | Terminée et validée                |
| 3     | Dashboard et gestion du parc machines        | Terminée et validée                |
| 4     | Compteurs et historique                      | Terminée et validée                |
| 5     | Moteur de calcul de consommation CMJN        | Terminée, en attente de validation |
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

## Phase 5 : Moteur de calcul de consommation CMJN

### Livré

- **Moteur en Python** (`services/analytics`), indépendant et sans état : il reçoit toutes ses données et ne conserve rien. Chaque canal, cyan, magenta, jaune et noir, est calculé indépendamment. Le noir porte sur toutes les pages, les couleurs sur les pages couleur.
- **Calcul selon l'aplat :** consommation de référence = masse ÷ rendement constructeur ; consommation théorique = référence × (aplat ÷ couverture de référence) × pages × facteur de format × facteur de support. Couverture de référence ISO/IEC 19752 et 19798 (5 %) par défaut ; facteur de format égal à la surface rapportée à l'A4.
- **Consommation théorique, estimée et réelle,** toujours distinguées. La réelle est mesurée par pesée, ou estimée d'après les cartouches vidées, que le moteur convertit en grammes avec la masse du toner.
- **Écarts et taux de surconsommation :** chaque consommation réelle est comparée au théorique de la même période (pages tirées des compteurs), en grammes et en pourcentage.
- **Coût toner par page :** prix d'achat de chaque cartouche, propre à l'entreprise et dans sa devise (nouvelle devise de l'entreprise, XOF par défaut). Coût par canal, par machine, par page et pour 1 000 pages ; les coûts sont marqués partiels quand un prix manque.
- **Calibration par machine, progressive :** coefficient manuel, sinon coefficient appris des consommations réelles de la machine, lissé vers celui de son modèle (mesures des autres machines du même modèle), lui-même lissé vers 1. Le niveau de confiance suit le nombre de mesures.
- **Interface :**
  - page **Consommation toner** : parc, canaux, machines, coûts ;
  - simulateur **Aplat CMJN** : un travail décrit par son aplat, sur une machine ou un modèle ;
  - panneau **Consommation toner** de la fiche machine : calibration, paramètres de calcul, consommations réelles et écarts ;
  - **toners et prix** de chaque fiche technique ;
  - panneau toner du tableau de bord.

Décisions et formules détaillées dans [docs/architecture.md](docs/architecture.md), section « Moteur de consommation CMJN ».

### Critères d'acceptation

| Critère                                        | Résultat                                                        |
| ---------------------------------------------- | --------------------------------------------------------------- |
| Calcul indépendant C, M, J, K                  | Validé : chaque canal sur ses propres pages et son propre aplat |
| Calcul selon l'aplat                           | Validé, formule du cahier des charges                           |
| Consommation théorique                         | Validé                                                          |
| Consommation réelle ou estimée                 | Validé : pesée (mesurée) ou cartouches vidées (estimée)         |
| Écarts et taux de surconsommation              | Validé                                                          |
| Coût toner par page                            | Validé, dans la devise de l'entreprise                          |
| Calibration par machine                        | Validé : manuelle, par machine, par modèle, progressive         |
| Tests mathématiques                            | Validé : 41 tests Python, résultats calculés à la main          |
| `build`, `typecheck`, `lint` et `test` passent | Validé : 30 tâches sur 30, sans cache                           |

Détail des tests :

| Paquet                 | Tests | Dont nouveaux en Phase 5 |
| ---------------------- | ----- | ------------------------ |
| `@arksen/api`          | 60    |                          |
| `@arksen/validation`   | 49    | 8                        |
| `@arksen/analytics`    | 42    | 41                       |
| `@arksen/web`          | 34    |                          |
| `@arksen/shared-types` | 12    |                          |
| `@arksen/database`     | 2     |                          |
| `@arksen/workers`      | 2     |                          |
| `@arksen/collector`    | 2     |                          |

Soit 203 tests unitaires et d'intégration, et **68 tests de bout en bout** sur la stack Docker réelle (12 nouveaux, dans `apps/api/test/e2e/consumption.e2e.test.ts`), tous réussis du premier coup. Ils traversent toute la chaîne (API, compteurs, moteur Python, base) avec des valeurs calculées à la main :

- 1 500 pages dont 500 couleur, aplats 10, 5, 2,5 et 5 % : 20, 10, 5 et 30 g, pour un coût de 16 ;
- une pesée de 36 g pour 30 g théoriques : écart de +6 g, soit 20 % de surconsommation, et un coefficient de 96 / 90 ;
- la conversion d'une demi-cartouche en 150 g, la simulation d'un travail, le refus d'un toner couleur sur un modèle noir et blanc ;
- l'isolation : toners privés, consommation d'une autre entreprise, et prix d'un toner privé d'une autre entreprise refusé en base, même pour le rôle système.

Vérification de la stack (`pnpm stack:smoke`) : 11 contrôles sur 11.

Vérification visuelle : page Consommation toner, simulateur Aplat CMJN, fiche machine et tableau de bord, en clair, en sombre et sur mobile, sans erreur dans la console. Données de démonstration : toners fictifs (références `DEMO-…`) et prix pour les trois fiches de démonstration, profils de calcul et consommations réelles sur deux machines.

### Écarts par rapport au plan

- **Aplat moyen supposé :** en attendant l'analyse des fichiers (Phase 6), l'aplat de chaque canal est un paramètre de la machine (5 % par défaut). Le simulateur accepte un aplat saisi.
- **Devise par entreprise :** ajoutée au formulaire d'entreprise, pour que les coûts aient une unité.
- **Route `/aplat` :** le dossier `coverage` était exclu par `.dockerignore`, `.gitignore` et `.prettierignore` (motif des rapports de couverture de tests). La route a été renommée avant d'être versionnée.

### Points restants

- **Facteurs de support :** aucune valeur par type de papier n'est inventée ; le facteur se règle par machine. Des valeurs mesurées pourront alimenter un référentiel.
- **Catalogue Arksen :** toujours vide. Ses toners se renseignent depuis les fiches du catalogue.
- **Requêtes concurrentes dans une transaction :** le pilote PostgreSQL signale (avertissement de dépréciation) des `Promise.all` dans les transactions de 11 services, écrits depuis la Phase 2. Sans effet aujourd'hui, ils devront devenir séquentiels avant le passage à `pg` 9.
- **Moteur sans authentification :** il n'est joignable que par l'API sur le réseau interne. Son port publié en développement sera retiré en Phase 10.
- **Données de test :** données de démonstration dans `demo-interface`, entreprises `e2e-…` laissées par les tests.
- **Points des phases précédentes toujours ouverts :** voir les sections précédentes.

## Phase 4 : Compteurs et historique

### Livré

- **Compteurs couleur et noir et blanc :** un relevé enregistre les deux compteurs d'une machine à un instant donné. Le compteur couleur est exigé d'une machine couleur et refusé d'une machine noir et blanc ; le total est vérifié par la base.
- **Saisie et import :** saisie depuis la fiche d'une machine, avec le relevé précédent en repère et une alerte si un compteur baisse. Import CSV depuis la page Compteurs (en-têtes en français ou en anglais, séparateurs `;`, `,` ou tabulation, dates françaises ou ISO), avec un modèle à télécharger et le détail des lignes refusées. L'import est **idempotent** : le rejouer ne crée aucun doublon.
- **Historique des relevés :** chaque relevé affiche son origine, son auteur, le nombre de pages depuis le précédent et ses anomalies. Un relevé erroné peut être supprimé, ce qui est tracé. Une remise à zéro du compteur se déclare, pour ne pas fausser les volumes.
- **Volumes journaliers et mensuels :** calculés entre deux relevés et répartis à parts égales dans le temps, pour une machine (12 derniers mois) ou pour le parc (filtres par site et par type couleur). Chaque volume indique la part de la période couverte par des relevés : un jour sans relevé est inconnu, jamais compté à zéro.
- **Comparaison des périodes :** période précédente de même durée, ou même période l'an dernier ; variation globale, par canal et par machine. Périodes prédéfinies : 30 jours, 3 mois, 12 mois, mois en cours, mois précédent, année en cours.
- **Détection des anomalies :** compteur en baisse, pic de volume, débit au-delà du maximum constructeur, machine en service sans impression, relevé manquant. Les règles et leurs seuils sont dans un module sans base de données, testé isolément.
- **Tableau de bord :** pages imprimées des 30 derniers jours, comparées aux 30 précédents, et anomalies de compteurs.

Décisions détaillées dans [docs/architecture.md](docs/architecture.md), section « Compteurs ».

### Critères d'acceptation

| Critère                                        | Résultat                                                 |
| ---------------------------------------------- | -------------------------------------------------------- |
| Compteurs couleur et noir et blanc             | Validé, cohérence vérifiée par l'API et par la base      |
| Historique des relevés                         | Validé, avec le volume et les anomalies de chaque relevé |
| Volumes journaliers et mensuels                | Validé, couverture des relevés indiquée                  |
| Comparaison des périodes                       | Validé : période précédente ou année précédente          |
| Détection des anomalies de compteurs           | Validé : cinq règles                                     |
| Isolation des données par entreprise           | Validé au niveau de l'API et de PostgreSQL               |
| `build`, `typecheck`, `lint` et `test` passent | Validé : 30 tâches sur 30, sans cache                    |

Détail des tests :

| Paquet                 | Tests | Dont nouveaux en Phase 4 |
| ---------------------- | ----- | ------------------------ |
| `@arksen/api`          | 60    | 20                       |
| `@arksen/validation`   | 41    | 5                        |
| `@arksen/web`          | 34    | 6                        |
| `@arksen/shared-types` | 12    | 1                        |
| `@arksen/database`     | 2     |                          |
| `@arksen/workers`      | 2     |                          |
| `@arksen/collector`    | 2     |                          |
| `@arksen/analytics`    | 1     |                          |

Soit 154 tests unitaires et d'intégration, et **56 tests de bout en bout** sur la stack Docker réelle (15 nouveaux, dans `apps/api/test/e2e/meters.e2e.test.ts`), tous réussis. Ils vérifient notamment :

- le calcul du volume de chaque relevé, et la répartition jour par jour sur une période (valeurs attendues calculées à la main) ;
- les règles couleur et noir et blanc, le refus d'un relevé futur ou en double ;
- l'import, puis son rejeu sans doublon, et l'impossibilité d'atteindre la machine d'une autre entreprise par son numéro de série ;
- la comparaison avec la période précédente, et la détection d'une baisse de compteur et d'un dépassement du volume constructeur ;
- l'isolation des relevés par entreprise, et la contrainte de cohérence en base, même pour le rôle système.

Le moteur d'analyse a 17 tests unitaires dédiés (répartition, débordement de période, jours inconnus, regroupement mensuel, cumul du parc, chaque règle d'anomalie).

Vérification de la stack (`pnpm stack:smoke`) : 11 contrôles sur 11.

Vérification visuelle : page Compteurs, panneau Compteurs de la fiche machine, dialogue d'import et tableau de bord, en clair, en sombre et sur mobile, sans erreur dans la console. Données de démonstration : 189 relevés hebdomadaires générés pour l'entreprise de test `demo-interface`, avec un pic et une baisse de compteur introduits volontairement.

### Écarts par rapport au plan

- **Pas encore de collecte automatique :** les relevés sont saisis ou importés. L'agent de collecte (Phase 7) les enverra par la même table, avec la même idempotence (contrainte unique et identifiant externe).
- **Module « Impressions » reporté en Phase 6 :** il concerne les travaux d'impression et leurs pages, qui arrivent avec l'analyse des fichiers. Il était marqué Phase 4 dans la navigation par erreur.
- **Jours UTC :** les volumes sont regroupés par jour UTC, qui coïncide avec l'heure du Sénégal. Un fuseau par entreprise sera à prévoir pour d'autres pays.

### Points restants

- **Compteurs en pages :** une page A3 compte selon la convention de la machine (souvent pour deux). La conversion des formats viendra avec le moteur de consommation (Phase 5).
- **Seuils d'anomalie fixes :** ils sont réglés pour tout le parc. Les rendre paramétrables par entreprise ou par modèle reste à faire.
- **Performance :** les volumes et anomalies sont calculés à la lecture. C'est adapté à des relevés quotidiens ou hebdomadaires ; avec des relevés horaires de l'agent sur un grand parc, il faudra des agrégats précalculés.
- **Données de test :** l'entreprise `demo-interface` porte des relevés de démonstration ; les tests de bout en bout laissent des entreprises `e2e-…`.
- **Points des phases précédentes toujours ouverts :** voir les sections précédentes.

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

### 5 novembre 2026 : Phase 5

- **Moteur :** `services/analytics/src/arksen_analytics/cmyk.py` (formules) et `cmyk_api.py` (`POST /v1/cmyk/estimate`), avec 41 tests mathématiques.
- **Base de données :** migration `20261105000000_consumption` : `toner_models`, `toner_prices`, `calibration_profiles`, `consumption_measurements`, devise des entreprises, contraintes de domaine, déclencheurs de périmètre et RLS.
- **API :** module `consumption` (toners et prix, profils, consommations réelles, consommation d'une machine et du parc, simulation) et client du moteur `engine.client.ts`.
- **Contrats :** `packages/shared-types/src/consumption.ts`, `packages/validation/src/consumption.ts`, permissions `consumption:read` et `consumption:manage`, devise dans les schémas d'entreprise.
- **Web :** fonctionnalité `features/consumption` (page Consommation toner, simulateur Aplat CMJN, panneau de la fiche machine, dialogues des paramètres, des mesures et des toners), panneau toner du tableau de bord, devise dans le formulaire d'entreprise, historique des relevés paginé par 10, cartes d'indicateur compactes pour les montants.
- **Tests :** `consumption.e2e.test.ts`, tests des schémas.
- **Documentation :** `docs/architecture.md` (section « Moteur de consommation CMJN » et matrice des droits) et `docs/development.md`.

### 4 novembre 2026 : Phase 4

- **Base de données :** migration `20261104120000_meters` : table `meter_readings`, contraintes de cohérence des compteurs, unicité par machine et par instant, identifiant externe pour l'idempotence, RLS.
- **API :** module `meters` (historique annoté, saisie, suppression, import idempotent, volumes d'une machine et du parc, comparaison, anomalies) et moteur `meters/meter-analysis.ts`.
- **Contrats :** `packages/shared-types/src/meters.ts`, `packages/validation/src/meters.ts`, permissions `meters:read` et `meters:manage`.
- **Web :** fonctionnalité `features/meters` (page Compteurs, panneau de la fiche machine, saisie, import CSV et son analyseur), volumes et anomalies sur le tableau de bord ; graphiques sans animation d'entrée.
- **Tests :** `meters.e2e.test.ts`, tests du moteur d'analyse, des périodes de comparaison, des schémas et de l'analyseur CSV.
- **Documentation :** `docs/architecture.md` (section « Compteurs » et matrice des droits) et `docs/development.md`.

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
