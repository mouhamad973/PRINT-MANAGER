# État du projet ARKSEN PRINT MANAGER

Dernière mise à jour : 6 novembre 2026 (installation hors ligne ajoutée après la Phase 10).

## Avancement

| Phase | Contenu                                      | État                |
| ----- | -------------------------------------------- | ------------------- |
| 1     | Architecture et configuration du projet      | Terminée et validée |
| 2     | Authentification et gestion des utilisateurs | Terminée et validée |
| 3     | Dashboard et gestion du parc machines        | Terminée et validée |
| 4     | Compteurs et historique                      | Terminée et validée |
| 5     | Moteur de calcul de consommation CMJN        | Terminée et validée |
| 6     | Analyse PDF                                  | Terminée et validée |
| 7     | Collecteur SNMP et agent Windows             | Terminée et validée |
| 8     | Gestion des consommables et stocks           | Terminée et validée |
| 9     | Coûts, maintenance et contrats               | Terminée et validée |
| 10    | Rapports et déploiement commercial           | Terminée et validée |

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
- **Nginx reporté en Phase 10,** avec les configurations Compose Cloud et On-Premise. En Phase 1, les ports ne sont publiés que sur `127.0.0.1`. Livré en Phase 10.

### Points restants

- **ESLint 9** est signalée obsolète par npm. Le passage à ESLint 10 reste à faire.
- **Starlette** signale la dépréciation de `httpx` pour son client de test. Cela ne concerne que les tests.
- **Licences AGPL :** résolu en Phase 6. PyMuPDF et Ghostscript ont été écartés au profit de PDFium (`pypdfium2`, BSD et Apache 2.0) et de LittleCMS (MIT).
- **Aucun commit :** résolu, chaque phase est commitée et poussée.

## Complément : installation hors ligne

### Livré

- **Paquet hors ligne :** `scripts/offline-bundle.mjs` (`pnpm offline:bundle`) construit les images de production et les marque de la version du paquet (`<version>-<commit>`). Il les exporte compressées avec PostgreSQL et Redis, puis y ajoute les fichiers Compose, les installateurs, la notice et l'agent de collecte, avec `SHA256SUMS.txt`. Taille mesurée : 1,12 Go.
- **Surcouche `compose.offline.yaml` :** remplace chaque construction par l'image versionnée du paquet (`build: !reset`, `pull_policy: never`). Le serveur ne télécharge rien.
- **Installateurs `install.ps1` (Windows) et `install.sh` (Linux)**, dans `infrastructure/offline/` :
  - vérifient Docker, Compose 2.24 ou plus récent et chaque empreinte ;
  - copient les fichiers dans `C:\ARKSEN` ou `/opt/arksen` ;
  - à la première installation, posent les questions et génèrent les secrets ; `.env.production` est réservé aux administrateurs ;
  - chargent les images ;
  - sauvegardent la base avant une mise à jour ;
  - démarrent ARKSEN et attendent que tout soit sain ;
  - effacent ensuite l'e-mail et le mot de passe du Super Administrateur de `.env.production` ;
  - récupèrent `arksen-ca.pem` et créent le raccourci `arksen` / `arksen.cmd`.
- **Documentation :** `docs/offline.md`, copiée dans le paquet sous le nom `LISEZMOI.md`. Liens ajoutés dans `deployment.md` et le README.

### Vérifié

- **Méthode :** paquet construit puis testé sur ce poste, dans des projets Docker séparés (ports 9080 et 9443). Les images du paquet avaient été retirées de Docker, pour qu'elles ne puissent venir que du `docker load`.
- **`install.ps1` :**
  - installation complète, tous les services sains ;
  - connexion du Super Administrateur avec un mot de passe contenant `$`, `#`, des espaces et des guillemets ; un mauvais mot de passe est refusé (401) ;
  - mot de passe absent du fichier et de l'environnement du conteneur ;
  - le raccourci `arksen.cmd` fonctionne ;
  - un second lancement (mise à jour) sauvegarde la base puis redémarre, en gardant la configuration.
- **`install.sh`** (Git Bash) : installation complète, connexion vérifiée, raccourci `arksen` fonctionnel. Un fichier du paquet modifié est détecté, et l'installation s'arrête.
- **Installation existante (`arksen-prod`) :** non touchée.

### Points restants

- `install.sh` n'a été exécuté que sous Git Bash : il reste à le valider sur un vrai serveur Debian ou Ubuntu.
- Docker n'est pas inclus dans le paquet : ses fichiers d'installation hors ligne sont à apporter à part (licence Docker Desktop à vérifier pour les grandes entreprises).

## Phase 10 : Rapports et déploiement commercial

### Livré

- **Rapports PDF, Excel et CSV** (page **Rapports**) : les neuf rapports du cahier des charges (§ 14) :
  - production ;
  - consommation CMJN, par machine et par client ;
  - coûts d'impression ;
  - rendement toner ;
  - stocks ;
  - maintenance ;
  - rentabilité.

  Pour chaque rapport, on choisit une période et un site. Un même modèle de document donne trois rendus :
  - **PDF** paginé, avec indicateurs ;
  - **Excel** : formats numériques réels, filtres, feuille « Méthode » ;
  - **CSV** pour un tableur français : point-virgule, BOM, protection contre l'injection de formules.

  Chaque rapport exige ses propres droits, et chaque export est inscrit au journal d'audit.

- **Statistiques avancées :** tendances sur 3, 6 ou 12 mois (pages noir et couleur, coût de revient, chiffre d'affaires), machines les plus actives et rentabilité par client, chaque contrat face au coût de ses propres machines.
- **Sécurité et audit :**
  - **Journal d'audit :** export CSV sur une période, pour une entreprise ou toute la plateforme.
  - **Conservation des données :** purge quotidienne, réglable, sous verrou Redis, du journal d'audit, des événements et synchronisations des agents, de l'historique des niveaux et des alertes clôturées. Les données de gestion ne sont jamais purgées.
  - **Garde-fou en base :** une entrée de moins d'un an ne peut pas être supprimée, même en contournant l'application ; seul le rôle système peut appeler la purge.
  - **En-têtes HTTP :** CSP et en-têtes de sécurité sur le frontend.
  - **Adresse réelle des clients :** fiabilisée derrière le proxy (voir les corrections).
- **Administration système** (page réservée au Super Administrateur) :
  - version, mode de déploiement et état de la plateforme ;
  - politique de conservation, dernière purge et purge à la demande ;
  - archivage du journal.
- **Déploiement Cloud et On-Premise :**
  - **Pile de production** (`compose.prod.yaml`, avec `compose.cloud.yaml` ou `compose.onprem.yaml`) : seul Nginx est exposé.
  - **Nginx :** TLS 1.2 et 1.3, redirection HTTPS, HSTS, `X-Forwarded-For` remplacé, 60 Mo, délais de 130 s.
  - **Certificats :** Let's Encrypt renouvelé automatiquement (Cloud) ou autorité locale ARKSEN créée au premier démarrage (On-Premise).
  - **Sauvegardes :** quotidiennes avec empreinte et rotation, restauration vérifiée.
  - **Modèle de configuration :** `.env.production.example`.
- **Agent Windows :**
  - `SHA256SUMS.txt` à chaque construction ;
  - signature Authenticode facultative (`.pfx` ou certificat du magasin) ;
  - option `-CaFile` / `--ca-file` pour un serveur On-Premise ;
  - scripts PowerShell en UTF-8 avec BOM, pour des accents corrects sous Windows PowerShell 5.1.
- **Documentation :** `docs/deployment.md` (installation, mise à jour, sauvegarde et restauration, exploitation), `docs/security.md`, mises à jour de `configuration.md`, `architecture.md`, `collector.md` et du README.

### Critères d'acceptation

| Critère                        | Résultat                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| Rapports PDF et Excel (et CSV) | Validé : 9 rapports × 3 formats, droits vérifiés, exports audités                            |
| Statistiques avancées          | Validé : tendances mensuelles, machines les plus actives, rentabilité par client             |
| Sécurité et audit              | Validé : export du journal, conservation, garde-fous en base, en-têtes HTTP, IP réelle       |
| Déploiement On-Premise         | Validé sur une vraie pile : HTTPS par autorité locale, agent enregistré en HTTPS             |
| Déploiement Cloud              | Configuration validée (`docker compose config`) ; Let's Encrypt non testable sans DNS public |
| Packaging de l'agent Windows   | Validé : paquet construit avec empreintes ; signature prête, non testée faute de certificat  |
| Tests finaux                   | Validé : 30 tâches sur 30 sans cache, 128 tests de bout en bout, contrôle de la pile 11/11   |

Détail des tests :

| Paquet                 | Tests | Dont nouveaux en Phase 10 |
| ---------------------- | ----- | ------------------------- |
| `@arksen/api`          | 91    | 8                         |
| `@arksen/validation`   | 79    | 7                         |
| `@arksen/analytics`    | 68    |                           |
| `@arksen/collector`    | 45    | 2                         |
| `@arksen/web`          | 36    | 2                         |
| `@arksen/shared-types` | 12    |                           |
| `@arksen/database`     | 2     |                           |
| `@arksen/workers`      | 2     |                           |

Soit 335 tests unitaires et d'intégration, et **128 tests de bout en bout** sur la stack Docker réelle (13 nouveaux, dans `apps/api/test/e2e/reports.e2e.test.ts`) :

- **Exports :** chaque rapport dans chaque format, avec ses signatures (`%PDF-`, `PK`, BOM UTF-8). Le CSV de production contient les 12 000 pages relevées.
- **Droits :**
  - un utilisateur obtient la production, mais 403 sur les coûts, les stocks, la rentabilité et la consommation ;
  - une autre entreprise obtient 404 ;
  - période inversée, future ou format inconnu : 400.
- **Statistiques :** 6 mois par défaut, 3 sur demande, 24 refusés ; réservées aux rôles qui voient les coûts.
- **Journal d'audit :**
  - l'export par entreprise ne contient pas les autres entreprises ;
  - l'export de la plateforme est réservé au Super Administrateur ;
  - en base, modification et suppression sont refusées, même drapeau de purge levé ;
  - la purge à moins d'un an est refusée, et le rôle applicatif ne peut pas l'appeler.
- **Conservation :** la politique est visible du seul Super Administrateur, et la purge à la demande ne touche aucune donnée récente. Elle est journalisée.

Deux premiers échecs, dus aux tests : un administrateur d'une autre entreprise reçoit 404 (convention existante : l'existence de l'entreprise n'est pas révélée), et non 403.

**Pile de production On-Premise**, construite et démarrée (ports 8080 et 8443) :

- **Services :** les neuf sont sains, et seul Nginx publie des ports.
- **HTTPS :**
  - certificat signé par l'autorité locale, accepté avec `ca.pem` et refusé sans ;
  - TLS 1.1 refusé ;
  - HTTP redirigé vers `PUBLIC_WEB_URL` ;
  - HSTS, CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy` et `Permissions-Policy` présents.
- **Adresse IP :** une adresse usurpée dans `X-Forwarded-For` est ignorée, et l'adresse réelle est journalisée.
- **Agent :** enregistré puis synchronisé en HTTPS à travers Nginx avec `--ca-file`. Sans l'autorité, il refuse la connexion.
- **Sauvegarde et restauration :**
  - la sauvegarde est automatique au démarrage, avec empreinte ;
  - une restauration sur une base modifiée revient exactement à l'état sauvegardé ;
  - après restauration, la connexion, le RLS, le journal en ajout seul et les droits de purge sont intacts.

Corrections apportées pendant la vérification :

- **Adresse IP des clients derrière le proxy (défaut de production) :** Better Auth ne voit pas le pair TCP. Avec sa liste de proxys privés de confiance, il rejetait toute adresse privée. Derrière Nginx, un poste du réseau local (On-Premise) avait donc une adresse vide dans le journal, et tous les postes partageaient un seul compteur de tentatives de connexion. L'adresse est désormais résolue par Express puis transmise à Better Auth dans un en-tête interne toujours écrasé (3 tests).
- **Marge des statistiques :** elle comparait le chiffre d'affaires des contrats au coût de tout le parc, d'où −417 %. Elle compare maintenant chaque contrat au coût de ses machines : +22 % sur les données de démonstration.
- **Accents des scripts de l'agent :** Windows PowerShell 5.1 lisait les scripts UTF-8 sans BOM en ANSI.
- **Tableau des clients sur mobile :** le chiffre d'affaires passe sous le nom du client.

Vérification visuelle (compte `demo-interface`, données notées « démo ») :

- page Rapports en clair sur ordinateur, en sombre sur mobile, sans défilement horizontal ;
- vrais téléchargements Excel et CSV depuis l'interface (HTTP 200) ;
- console sans erreur ni violation de la CSP.

La page Administration système n'a été vue que sous l'angle du refus d'accès (compte administrateur client). Son contenu est couvert par les tests de bout en bout. Le panneau du navigateur était masqué : une partie des captures a échoué, et le contenu a été vérifié par le texte de la page.

### Écarts par rapport au plan

- **Certificat Cloud :** obtenu par certbot en validation HTTP. Il n'a pas pu être testé ici, faute de nom DNS public. Un certificat provisoire sert en attendant, puis Nginx reprend le certificat Let's Encrypt dans l'heure.
- **Signature de l'agent :** le mécanisme est prêt, mais aucun certificat de signature de code n'est disponible. Le paquet de test est construit non signé, avec un avertissement.
- **Dernière purge :** mémorisée dans Redis, avec chaque exécution dans le journal d'audit. Elle est perdue si Redis est vidé, ce qui ne change pas la politique appliquée.
- **CSP :** `'unsafe-inline'` pour les scripts, car Next.js injecte des scripts en ligne. Une CSP à nonce demanderait un rendu dynamique de toutes les pages.

### Points restants

- **Certificat de signature de code** à acquérir avant de diffuser l'agent.
- **Test Cloud réel :** sur un serveur public, obtention et renouvellement Let's Encrypt.
- **Sauvegardes hors site :** le dossier `BACKUP_DIR` est à recopier hors du serveur ; la pile ne le fait pas.
- **Points des phases précédentes toujours ouverts :**
  - facture légale et export comptable ;
  - stock de pièces détachées ;
  - requêtes concurrentes dans une transaction (Phase 5) ;
  - ESLint 10.
- **Données de test :** entreprises `e2e-rapports-…` laissées par les tests.

## Phase 9 : Coûts, maintenance et contrats

### Livré

- **Coûts d'impression** (page **Coûts d'impression**) : pour chaque machine et pour une période, on additionne :
  - le toner estimé par le moteur CMJN ;
  - le papier (pages × (1 − recto verso / 2) × prix de la feuille) ;
  - les interventions terminées ;
  - les coûts fixes mensuels au prorata.
    Le papier, le recto verso et les coûts fixes se règlent par machine. Les lacunes sont signalées, jamais comptées pour zéro.
- **Coût copie :** la page noir et blanc (toner noir et coûts communs) et la page couleur (avec les toners cyan, magenta et jaune répartis sur les pages couleur), par machine et pour le parc.
- **Gestion du papier** (page **Papier**) :
  - types de papier : format, grammage, rame, prix ;
  - stocks par site en rames, sur le même registre immuable que les toners ;
  - seuils, alertes de papier bas ou épuisé, couverture d'après les pages des machines.
- **Contrats clients** (page **Contrats**) : contrats au coût copie (forfait, pages incluses, prix des pages au-delà) et machines couvertes, une machine par contrat. Les relevés de facturation :
  - reprennent les pages relevées sur les compteurs ;
  - calculent le montant, le coût de revient et la marge ;
  - sont numérotés à l'émission (`REL-2026-0001`), puis figés, annulables mais jamais modifiables ni supprimables.
- **Interventions techniques** (page **Interventions**) :
  - tout rôle peut signaler une panne ;
  - les techniciens planifient, affectent, conduisent et closent, avec compte rendu, compteur, temps, main-d'œuvre et pièces ;
  - les coûts entrent dans le coût d'impression.
- **Maintenance préventive** (page **Maintenance**) : plans tous les N pages et/ou N jours, avec un avancement vers l'échéance et une échéance estimée au rythme d'impression.
  - Alertes de maintenance à prévoir (90 %) ou dépassée, réévaluées chaque heure.
  - Planification en un clic. Une révision terminée remet le plan à zéro.
- **Impressions** (page **Impressions**) : un fichier analysé s'enregistre comme imprimé (machine, exemplaires, prix de vente). Son coût de revient (toner et papier) est figé, et le registre donne la marge.

Méthodes et décisions : [docs/architecture.md](docs/architecture.md), section « Coûts, contrats et maintenance ».

### Critères d'acceptation

| Critère                                        | Résultat                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| Coûts d'impression                             | Validé : toner, papier, interventions, coûts fixes, par machine et pour le parc |
| Gestion du papier                              | Validé : types, stocks par site, registre immuable, seuils, alertes             |
| Coût copie                                     | Validé : page noir et blanc et page couleur                                     |
| Contrats clients                               | Validé : contrats au coût copie, machines couvertes, relevés numérotés et figés |
| Interventions techniques                       | Validé : signalement, planification, affectation, clôture avec coûts            |
| Maintenance préventive                         | Validé : plans en pages ou en jours, échéance, alertes, remise à zéro           |
| `build`, `typecheck`, `lint` et `test` passent | Validé : 30 tâches sur 30, sans cache                                           |

Détail des tests :

| Paquet                 | Tests | Dont nouveaux en Phase 9 |
| ---------------------- | ----- | ------------------------ |
| `@arksen/api`          | 83    | 13                       |
| `@arksen/validation`   | 72    | 7                        |
| `@arksen/analytics`    | 68    |                          |
| `@arksen/collector`    | 43    |                          |
| `@arksen/web`          | 34    |                          |
| `@arksen/shared-types` | 12    |                          |
| `@arksen/database`     | 2     |                          |
| `@arksen/workers`      | 2     |                          |

Soit 316 tests unitaires et d'intégration, et **115 tests de bout en bout** sur la stack Docker réelle (12 nouveaux, dans `apps/api/test/e2e/operations.e2e.test.ts`, tous réussis du premier coup), avec des valeurs calculées à la main.

- **Coûts :** 12 000 pages dont 2 000 couleur, toner 96 (72 noir, 24 couleur), papier 45 000 (9 000 feuilles à 5 en recto verso à 50 %), intervention 5 000. Total 50 096, coût copie noir et blanc 50 072 / 12 000.
- **Relevé :** forfait 10 000, 5 000 pages noir et blanc en plus à 5 et 1 000 pages couleur en plus à 30. Total 65 000, marge 14 904. Numérotés `REL-AAAA-0001` puis `0002`, figés en base même pour le rôle système, puis annulés.
- **Intervention :** signalée par un utilisateur, qui ne peut ni la planifier ni la conduire ; clôture refusée sans compte rendu ; compteur 24 000 relevé à la clôture.
- **Maintenance :** plan de 14 000 pages à 13 000 pages (93 %), soit à prévoir avec son alerte, puis remise à zéro par l'intervention préventive.
- **Papier :** stock en rames, alerte de seuil, sortie refusée (« Stock insuffisant : 4 rame(s) »).
- **Impression enregistrée :** toner 1,20, papier 37,50, marge 961,30.
- **Isolation :** entre entreprises, au niveau de l'API et de la base (RLS).

Vérification de la stack (`pnpm stack:smoke`) : 11 contrôles sur 11.

Vérification visuelle : pages Coûts d'impression, Papier, Contrats, Interventions, Maintenance et Impressions, en clair, en sombre et sur mobile, sans erreur dans la console. Données de démonstration dans `demo-interface`, notées « démo » : deux papiers, des réglages de coût, un contrat avec un relevé émis et un brouillon, trois interventions, trois plans de maintenance et une impression enregistrée.

Corrections apportées :

- couleurs de la répartition des coûts mieux distinguées ;
- colonne des pages sans retour à la ligne, sans mention couleur pour une machine noir et blanc ;
- date des interventions placée sous le titre sur mobile.

### Écarts par rapport au plan

- **Relevés de facturation plutôt que factures :** un relevé chiffre ce qu'il faut facturer et en donne la marge. La facture légale (TVA, mentions obligatoires, export comptable) dépend du pays et du logiciel comptable du client ; elle reste à cadrer.
- **Pages facturées :** ce sont les pages relevées, réparties à parts égales entre deux relevés. La part de la période couverte par des relevés est affichée pour chaque machine.
- **Module « Impressions » :** c'est le registre des fichiers analysés puis imprimés. Les travaux envoyés directement aux machines, sans analyse, n'y figurent pas : il faudrait un serveur d'impression.

### Points restants

- **Rentabilité par client et rapports :** résolu en Phase 10 (rapports PDF, Excel et CSV, statistiques).
- **Facture légale et export comptable :** à cadrer avec un client (voir les écarts).
- **Pièces détachées :** les interventions enregistrent le coût des pièces, sans stock de pièces.
- **Requêtes concurrentes dans une transaction :** toujours ouvert (voir Phase 5).
- **Données de test :** entreprises `e2e-ops-…` laissées par les tests.

## Phase 8 : Gestion des consommables et stocks

### Livré

- **Toners :** la page **Toners** liste les références des fiches techniques. Pour chacune :
  - les modèles et les machines équipées ;
  - le stock tous sites confondus et les remplacements des 90 derniers jours ;
  - le **rendement constaté**, comparé au rendement constructeur.
- **Remplacements :** enregistrés avec le compteur de la machine, pris ou non dans un stock. Le compteur donne le rendement réel de la cartouche retirée.
  - Un remplacement erroné s'annule, et sa cartouche revient dans son stock.
  - Les remontées de niveau vues par l'agent, sans remplacement enregistré, sont proposées comme **remplacements à confirmer**.
- **Mouvements de stock :** réception (coût unitaire, bon de livraison), sortie, inventaire (écart avec la quantité comptée), transfert entre sites, installation et annulation.
  - Le registre est immuable et tient le solde, par déclencheurs en base.
  - Un stock ne peut jamais devenir négatif, même avec deux sorties simultanées.
- **Seuils minimums :** seuil et délai de réapprovisionnement par article (une référence sur un site). Niveau suffisant, sous le seuil ou en rupture.
- **Alertes de rupture :** page **Alertes**, panneau du tableau de bord.
  - Types : rupture de stock, stock sous le seuil, rupture prévue, toner bientôt épuisé (niveau SNMP de 10 % ou moins), toner épuisé (2 % ou moins).
  - Une seule alerte active par condition. Les alertes se résolvent d'elles-mêmes, et peuvent être prises en compte ou clôturées.
- **Prévisions :**
  - **Rupture de stock :** rythme de consommation par le moteur CMJN (pages relevées, aplat, calibration des machines équipées, sur 90 jours), sinon par l'historique des installations. On en tire la couverture en jours, la date de rupture et la quantité à commander. L'évaluation est horaire, avec un verrou Redis.
  - **Épuisement de chaque cartouche :** d'après la tendance de ses niveaux SNMP depuis le dernier remplacement (fiche machine).
- **Historique des niveaux SNMP :** un point par changement de niveau, ou toutes les six heures.

Méthodes et décisions : [docs/architecture.md](docs/architecture.md), section « Toners, stocks et alertes ».

### Critères d'acceptation

| Critère                                        | Résultat                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Toners                                         | Validé : références, stock, remplacements, rendement constaté                         |
| Remplacements                                  | Validé : compteur, sortie de stock, annulation, détection par les niveaux SNMP        |
| Mouvements de stock                            | Validé : registre immuable et solde tenus en base, stock jamais négatif               |
| Seuils minimums                                | Validé : seuil et délai par article                                                   |
| Alertes de rupture                             | Validé : rupture, seuil, rupture prévue, toner bas ou épuisé ; résolution automatique |
| Prévisions                                     | Validé : moteur CMJN ou historique ; épuisement des cartouches par tendance SNMP      |
| `build`, `typecheck`, `lint` et `test` passent | Validé : 30 tâches sur 30, sans cache                                                 |

Détail des tests :

| Paquet                 | Tests | Dont nouveaux en Phase 8 |
| ---------------------- | ----- | ------------------------ |
| `@arksen/api`          | 70    | 6                        |
| `@arksen/validation`   | 65    | 5                        |
| `@arksen/analytics`    | 68    |                          |
| `@arksen/collector`    | 43    |                          |
| `@arksen/web`          | 34    |                          |
| `@arksen/shared-types` | 12    |                          |
| `@arksen/database`     | 2     |                          |
| `@arksen/workers`      | 2     |                          |

Soit 296 tests unitaires et d'intégration, et **103 tests de bout en bout** sur la stack Docker réelle (12 nouveaux, dans `apps/api/test/e2e/stocks.e2e.test.ts`). Ils couvrent :

- le registre : 5 reçues, 4 sorties, une sortie de 3 refusée (« Stock insuffisant : 1 »), un inventaire à 3 qui devient un mouvement de +2, les soldes 5, 1 et 3 ;
- un transfert entre sites ;
- l'immuabilité en base, même pour le rôle système ;
- deux remplacements : 12 500 pages entre les compteurs 10 000 et 22 500, soit le rendement constaté ;
- la rupture et l'annulation d'un remplacement, qui rend la cartouche ;
- les alertes de niveau envoyées par un agent : bas, épuisé, rafraîchie sans doublon, résolue à la remontée du niveau ;
- les remplacements à confirmer ;
- la prévision du moteur : 250 g sur 90 jours pour une cartouche de 300 g, soit 108 jours de couverture ;
- la prise en compte et la clôture d'une alerte ;
- les droits par rôle et l'isolation (RLS).

Vérification de la stack (`pnpm stack:smoke`) : 11 contrôles sur 11.

Vérification visuelle : pages Stocks, Toners et Alertes, et tableau de bord, en clair, en sombre et sur mobile, sans erreur dans la console. Données de démonstration dans `demo-interface`, notées « Démonstration » : six articles sur deux sites, réceptions, sorties et remplacements.

Corrections apportées :

- les actions du tableau des articles sont réduites à leur icône sous 1 536 px ;
- deux blocs du tableau de bord étaient devenus faux : les « indicateurs à venir » annonçaient encore les phases 7 et 8, et la note de connectivité citait la phase 7. Le bloc « Collecte SNMP » affiche désormais les machines en ligne et hors ligne.

### Écarts par rapport au plan

- **Article de stock par référence et par site :** une cartouche commune à plusieurs modèles a un seul stock par site. Les références viennent des fiches techniques.
- **Remplacements détectés proposés, pas enregistrés :** une remontée de niveau peut venir d'un recalibrage. Un utilisateur confirme, et le stock n'est jamais diminué sans lui.
- **Prévision par le moteur CMJN :** elle exige les quatre toners d'un modèle couleur, comme le calcul de consommation. Sinon, l'historique des installations prend le relais.
- **Seuils SNMP fixes :** 10 % et 2 %, communs à toutes les machines.

### Points restants

- **Commandes fournisseurs :** la quantité conseillée est calculée, mais il n'existe pas encore de bon de commande.
- **Consommation réelle :** un remplacement n'alimente pas encore la calibration de la Phase 5 comme une cartouche vidée ; à relier avec les coûts de la Phase 9.
- **Rétention :** résolu en Phase 10 (historique des niveaux et alertes clôturées purgés selon la politique de conservation).
- **Notifications :** les alertes s'affichent dans l'application ; leur envoi par e-mail reste à faire.
- **Requêtes concurrentes dans une transaction :** toujours ouvert (voir Phase 5).
- **Données de test :** entreprises `e2e-stock-…` laissées par les tests.

## Phase 7 : Collecteur SNMP et agent Windows

### Livré

- **Agent Windows autonome** `services/collector` (Python, PySNMP, SQLite, pywin32) :
  - service `ArksenCollector` en démarrage automatique ;
  - paquet PyInstaller sans Python à installer, avec scripts d'installation et de désinstallation ;
  - ligne de commande : `enroll`, `run`, `collect`, `sync`, `discover`, `status`, `ui`, `service`.
- **Collecte automatique** en SNMP v1, v2c et v3 (authentification et chiffrement), 16 machines à la fois, à la fréquence choisie (15 minutes par défaut). L'agent lit :
  - les compteurs : total Printer-MIB, noir et couleur selon les OID de la fiche technique ;
  - les niveaux des consommables, avec leur canal CMJN ;
  - le statut, l'activité et les alertes : papier, toner, capot, bourrage, maintenance…
  - Une machine injoignable produit un état « injoignable » avec sa raison, jamais un relevé.
- **Découverte des équipements** sur des plages d'adresses (4 096 au plus), communautés au choix, imprimantes seules. Le serveur rattache un équipement à la machine de même numéro de série ; les autres s'associent à une machine ou s'ignorent.
- **Stockage SQLite** (mode WAL) avec une Transactional Outbox. Un relevé et son événement sont écrits dans la même transaction. Chaque événement porte :
  - un UUID, l'identifiant de la machine et celui de l'agent ;
  - un horodatage et une version de schéma ;
  - un statut de synchronisation.
- **Synchronisation HTTPS** par le relais du frontend :
  - lots de 200 événements, un accusé par événement : accepté, doublon ou rejeté avec sa raison ;
  - idempotence et gestion des doublons côté serveur ;
  - journal des synchronisations des deux côtés.
- **Fonctionnement hors ligne :** la configuration reçue est gardée en cache (DPAPI), la collecte continue sans Internet, et un événement non acquitté n'est jamais supprimé.
- **Reprise automatique :** délai exponentiel de 5 s à 1 h, avec ±20 % d'aléa, sans intervention.
- **Enregistrement sécurisé :**
  - code à usage unique de 80 bits, valable 24 heures, à tentatives limitées ;
  - jeton de 256 bits, dont le serveur ne garde que l'empreinte et l'agent garde une copie chiffrée par DPAPI ;
  - révocation immédiate. Le serveur identifie l'agent par son jeton et en déduit son entreprise et son site.
- **Interface de configuration locale** (127.0.0.1:8765) : serveur, identifiants de l'entreprise et de l'agent, plages de découverte, fréquence, état et journal de synchronisation. Elle est protégée contre le rebinding DNS et le CSRF.
- **Application web :**
  - page **Agents de collecte** : agents et leur état, codes d'enregistrement, révocation, équipements découverts, journal des synchronisations, événements rejetés ;
  - panneau **État SNMP** de la fiche machine ;
  - OID des compteurs dans la fiche technique ;
  - connectivité réelle des machines.

Documentation : [docs/collector.md](docs/collector.md) pour l'agent, et [docs/architecture.md](docs/architecture.md), section « Collecte SNMP », pour le serveur.

### Critères d'acceptation

| Critère                                        | Résultat                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Découverte des équipements                     | Validé : plages, communautés, imprimantes seules, rattachement par numéro de série |
| Collecte automatique                           | Validé : compteurs, niveaux, états et alertes, SNMP v1, v2c et v3                  |
| Agent Windows autonome                         | Validé : service Windows, paquet PyInstaller construit et vérifié                  |
| Stockage SQLite                                | Validé : outbox transactionnelle, relevés, journal                                 |
| Synchronisation HTTPS                          | Validé : HTTPS imposé hors boucle locale, accusés par événement                    |
| Fonctionnement hors ligne                      | Validé : configuration en cache, collecte sans réseau, rien n'est perdu            |
| Reprise automatique des synchronisations       | Validé : délai exponentiel, réponse perdue renvoyée et comptée une fois            |
| Idempotence, doublons, isolation               | Validé : tests de l'agent et de bout en bout, RLS                                  |
| `build`, `typecheck`, `lint` et `test` passent | Validé : 30 tâches sur 30, sans cache                                              |

Détail des tests :

| Paquet                 | Tests | Dont nouveaux en Phase 7 |
| ---------------------- | ----- | ------------------------ |
| `@arksen/api`          | 64    | 4                        |
| `@arksen/validation`   | 60    | 7                        |
| `@arksen/analytics`    | 68    |                          |
| `@arksen/collector`    | 43    | 41                       |
| `@arksen/web`          | 34    |                          |
| `@arksen/shared-types` | 12    |                          |
| `@arksen/database`     | 2     |                          |
| `@arksen/workers`      | 2     |                          |

Soit 285 tests unitaires et d'intégration, et **91 tests de bout en bout** sur la stack Docker réelle (14 nouveaux, tous réussis du premier coup, dans `apps/api/test/e2e/collector.e2e.test.ts`). Ils couvrent :

- l'enregistrement et la réutilisation refusée d'un code ;
- la configuration limitée au site de l'agent, avec la communauté déchiffrée ;
- un relevé accepté puis renvoyé comme doublon, sans second relevé ;
- sept rejets individuels dans un même lot : compteurs couleur absents, autre site, autre entreprise, schéma inconnu, type inconnu, date future ;
- l'état SNMP, dont un état plus ancien qui ne remplace pas le dernier, et la connectivité ;
- la découverte rattachée par numéro de série ;
- les droits, l'isolation en base (RLS), la révocation immédiate et le réenregistrement.

Les tests de l'agent interrogent un vrai répondeur SNMP sur la boucle locale (snmpsim) : de vraies requêtes UDP en SNMP v1, v2c et v3 (SHA et AES). Ils vérifient aussi :

- l'outbox : transactions, accusés, reprise, purge prudente, redémarrage ;
- la synchronisation : coupure réseau, erreur serveur, réponse perdue suivie d'un doublon, rejet définitif, révocation puis réenregistrement ;
- un cycle complet avec une période hors ligne ;
- l'interface locale : en-tête Host, CSRF, origine.

Vérification de la stack (`pnpm stack:smoke`) : 11 contrôles sur 11.

Démonstration réelle de bout en bout : l'exécutable packagé (`dist/arksen-collector`) s'est enregistré auprès de la stack locale, a collecté en SNMP sur le simulateur, découvert une imprimante et synchronisé ses événements. Les données de démonstration de `demo-interface` sont clairement marquées :

- l'agent « Agent de démonstration (simulateur SNMP) » ;
- deux machines « Simulateur … (démo) » reliées au simulateur local ;
- les autres machines de démonstration, aux adresses fictives, signalées injoignables, ce qu'elles sont réellement.

Vérification visuelle : page Agents de collecte et fiche machine (panneau État SNMP), en clair, en sombre et sur mobile, sans erreur dans la console. Deux corrections en ont découlé : le journal des synchronisations empilé sous 1 536 px, et les actions des agents réduites à leur icône sur mobile.

### Écarts par rapport au plan

- **Compteurs noir et couleur :** ils ne sont pas normalisés en SNMP. Ils se renseignent par OID sur la fiche technique de chaque modèle ; aucun OID constructeur n'est inventé. Sans eux, une machine couleur ne produit que son état.
- **Machines configurées sur le serveur :** l'interface locale règle la découverte et la fréquence, mais les adresses et les identifiants SNMP restent gérés dans l'application, au même endroit que le parc.
- **Synchronisation par le relais du frontend :** l'agent n'a besoin que de l'adresse web de l'application. La terminaison TLS (Nginx) sera mise en place en Phase 10.
- **Page « Agents de collecte » :** elle s'ajoute aux 20 modules du cahier des charges (agent Windows, § 8).

### Points restants

- **Signature de code :** le paquet n'est pas signé. Une signature Authenticode sera nécessaire avant la commercialisation, pour éviter les alertes SmartScreen.
- **Installateur MSI :** le paquet est un ZIP accompagné de scripts PowerShell ; un installateur MSI pourra le remplacer.
- **Historique des niveaux :** seul le dernier état SNMP est conservé côté serveur. Les alertes et les prévisions de la Phase 8 en garderont l'historique.
- **Événements serveur :** résolu en Phase 10 (`agent_events` et `agent_sync_logs` purgés selon la politique de conservation).
- **Requêtes concurrentes dans une transaction :** toujours ouvert (voir Phase 5).
- **Données de test :** entreprises `e2e-agent-…` laissées par les tests.

## Phase 6 : Analyse PDF

### Livré

- **Import de PDF** depuis la page **Analyse PDF** : dépôt ou choix du fichier (50 Mo et 500 pages au plus), machine prévue et nombre d'exemplaires facultatifs. Le fichier est analysé puis oublié ; seules ses mesures et son empreinte SHA-256 sont conservées.
- **Analyse page par page** en Python (`services/analytics`) avec PDFium : nombre de pages, format (A5, A4, A3, SRA3, Letter, Legal, Tabloid ou personnalisé), dimensions en millimètres, orientation, page couleur ou non.
- **Couverture CMJN** de chaque page et moyenne du document pondérée par la surface : cyan, magenta, jaune, noir et couverture cumulée, plus une couverture en niveaux de gris pour les machines noir et blanc.
- **Méthode documentée et reproductible :** rendu sRGB par PDFium (profils ICC du document, RVB, CMJN, couleurs spéciales, transparences), puis séparation en CMJN avec un profil ICC de sortie (`ANALYTICS_CMYK_ICC_PROFILE`, LittleCMS) ou, à défaut, une séparation de référence. La couverture est la moyenne de la valeur de teinte sur la surface de la page, jamais une proportion de pixels colorés. La méthode est enregistrée avec chaque analyse.
- **Estimation du toner** sur une machine choisie : le travail est ramené à des pages A4 équivalentes et passe par le moteur de consommation de la Phase 5 (toners, prix, calibration). Une machine noir et blanc imprime en niveaux de gris.
- **Rapport de préproduction** (`/analyses/:id`) : document (couverture moyenne, formats, empreinte), estimation (coût du travail et par exemplaire, grammes par encre, calibration), tableau des pages avec le toner d'un exemplaire, méthode de mesure ; imprimable.
- **Historique :** analyses, modifications et suppressions dans le journal d'audit.

Méthode et décisions dans [docs/architecture.md](docs/architecture.md), section « Analyse PDF ».

### Critères d'acceptation

| Critère                                        | Résultat                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| Import PDF                                     | Validé : multipart par le relais du frontend, 50 Mo et 500 pages au plus  |
| Analyse page par page                          | Validé                                                                    |
| Formats, dimensions, orientation               | Validé : 7 formats normalisés à ± 3 mm, sinon « Personnalisé »            |
| Couverture C, M, J, N et cumulée               | Validé, par page et en moyenne pondérée par la surface                    |
| Méthode documentée, adaptée aux profils ICC    | Validé : profil ICC de sortie configurable, séparation de référence sinon |
| RVB, CMJN, tons directs, transparences         | Validé : un test pour chacun                                              |
| Estimation toner                               | Validé : moteur et calibration de la Phase 5, valeurs calculées à la main |
| Rapport de préproduction                       | Validé                                                                    |
| `build`, `typecheck`, `lint` et `test` passent | Validé : 30 tâches sur 30, sans cache                                     |

Détail des tests :

| Paquet                 | Tests | Dont nouveaux en Phase 6 |
| ---------------------- | ----- | ------------------------ |
| `@arksen/api`          | 60    |                          |
| `@arksen/validation`   | 53    | 4                        |
| `@arksen/analytics`    | 68    | 26                       |
| `@arksen/web`          | 34    |                          |
| `@arksen/shared-types` | 12    |                          |
| `@arksen/database`     | 2     |                          |
| `@arksen/workers`      | 2     |                          |
| `@arksen/collector`    | 2     |                          |

Soit 233 tests unitaires et d'intégration, et **77 tests de bout en bout** sur la stack Docker réelle (9 nouveaux, dans `apps/api/test/e2e/print-jobs.e2e.test.ts`). Un PDF de trois pages (A4 à moitié cyan, A4 noire, A3 blanche) donne 12,5 % de cyan et 25 % de noir en moyenne ; dix exemplaires font 40 pages A4 équivalentes, 4 g de noir et 2 g de cyan pour un coût de 1,60, et 4,43 g de noir sur une machine noir et blanc. Les tests vérifient aussi le nom de fichier accentué, le refus d'un fichier qui n'est pas un PDF, les droits, l'isolation entre entreprises et le déclencheur de périmètre en base. Leur premier passage a révélé une erreur (création imbriquée des pages refusée par Prisma à cause de la clé étrangère composite), corrigée avant le commit.

Les tests Python mesurent des PDF construits pour l'occasion : primaires, gris, page blanche, demi-page, CMJN natif, transparence à 50 %, ton direct, profil ICC, moyenne pondérée, formats et erreurs (fichier non PDF, protégé, endommagé, vide, trop long).

Vérification visuelle : liste des analyses et rapport de préproduction, en clair, en sombre et sur mobile, sans erreur dans la console. Données de démonstration : une analyse « Plaquette commerciale 2027.pdf » (A4, A3 paysage et Letter) dans `demo-interface`.

### Écarts par rapport au plan

- **PDFium plutôt que PyMuPDF et Ghostscript,** pour éviter l'AGPL : point des phases précédentes résolu.
- **Analyse synchrone :** l'API attend le service d'analyse (2 minutes au plus). Une file BullMQ n'apporterait rien tant que les fichiers sont limités à 50 Mo et 500 pages.
- **Module « Impressions » reporté en Phase 9 :** le registre des travaux réellement imprimés et de leurs coûts relève des coûts d'impression.

### Points restants

- **Profil ICC :** aucun profil n'est fourni avec l'application (licences des profils FOGRA ou GRACoL). Il se configure par `ANALYTICS_CMYK_ICC_PROFILE`.
- **Approximation du rendu :** les PDF en CMJN natif passent par le sRGB avant d'être séparés : un noir enrichi ou un gris en CMJN peut changer de répartition entre les encres. La surface encrée totale reste juste ; la calibration corrige l'écart propre à chaque machine.
- **Requêtes concurrentes dans une transaction :** toujours ouvert (voir Phase 5).
- **Données de test :** entreprises `e2e-pdf-…` laissées par les tests.
- **Points des phases précédentes toujours ouverts :** voir les sections précédentes.

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
- **Moteur sans authentification :** il n'est joignable que par l'API sur le réseau interne. Résolu en Phase 10 : la pile de production ne publie pas son port.
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

- **Proxy frontal :** résolu en Phase 10. Nginx remplace `X-Forwarded-For`, et l'adresse est résolue par Express pour Better Auth.
- **Limitation en mémoire :** les compteurs de tentatives sont propres à chaque instance de l'API. Avec plusieurs instances, il faudra les stocker dans Redis.
- **Mot de passe temporaire :** son changement n'est pas encore imposé à la première connexion.
- **Mot de passe oublié :** pas de réinitialisation par e-mail, faute de service d'envoi. Un administrateur réinitialise le mot de passe.
- **Double authentification :** non prévue par le plan, à envisager pour les Super Administrateurs.
- **Conservation du journal d'audit :** résolu en Phase 10 (trois ans par défaut, un an au moins, garde-fou en base).
- **Données de test :** les tests de bout en bout laissent dans la base de développement des entreprises dont l'identifiant commence par `e2e-`.
- **Points de la Phase 1 toujours ouverts :** ESLint 10, licences AGPL de la Phase 6, aucun commit.

## Journal des modifications

### 6 novembre 2026 : installation hors ligne

- **Infrastructure :** `compose.offline.yaml` ; installateurs `infrastructure/offline/install.ps1` et `install.sh`.
- **Scripts :** `scripts/offline-bundle.mjs` et commande `pnpm offline:bundle`.
- **Documentation :** `docs/offline.md` ; liens dans `deployment.md` et le README.

### 5 novembre 2026 : Phase 10

- **Base de données :** migration `20261109000000_retention` : purge du journal d'audit limitée aux entrées de plus d'un an, fonction `purge_audit_logs` réservée à `arksen_system`.
- **API :**
  - module `reports` : modèle de document et rendus CSV, Excel (exceljs) et PDF (pdfkit), neuf rapports, statistiques ;
  - export CSV du journal d'audit ;
  - `RetentionService` et purge quotidienne ;
  - routes `system/retention` ;
  - adresse du client résolue par Express pour Better Auth.
- **Contrats :** `packages/shared-types/src/reports.ts`, types de conservation, `packages/validation/src/reports.ts`, variables `RETENTION_*`, permission `platform:system:manage`.
- **Web :**
  - pages Rapports et Administration système ;
  - export du journal d'audit ;
  - panneau Rapports du tableau de bord ;
  - en-têtes de sécurité ;
  - navigation : plus aucun module annoncé pour une phase à venir.
- **Infrastructure :**
  - `compose.prod.yaml`, `compose.cloud.yaml` et `compose.onprem.yaml` ;
  - image Nginx (modèle, TLS, autorité locale) ;
  - image de sauvegarde (`backup.sh`, `restore.sh`) ;
  - `.env.production.example`.
- **Agent :** `--ca-file`, `-CaFile`, empreintes SHA-256, signature Authenticode facultative, scripts en UTF-8 avec BOM.
- **Tests :** `reports.e2e.test.ts`, rendus, adresse du client, schémas, conservation, navigation, agent.
- **Documentation :** `docs/deployment.md`, `docs/security.md`, `configuration.md`, `architecture.md`, `collector.md`, README.

### 8 novembre 2026 : Phase 9

- **Base de données :** migration `20261108000000_operations` :
  - tables `paper_types`, `paper_stocks`, `paper_movements` (registre immuable), `printer_cost_settings`, `contracts`, `contract_printers`, `invoices` (figés une fois émis), `tenant_sequences`, `interventions`, `maintenance_plans` ;
  - champs d'impression des travaux analysés et nouveaux types d'alerte ;
  - contraintes et RLS.
- **API :** modules `paper`, `costs` (modèle de coût testé), `contracts` (calcul des relevés testé), `maintenance` (état des plans testé, évaluation horaire), registre des impressions dans `print-jobs`, numérotation par entreprise.
- **Contrats :** `packages/shared-types/src/operations.ts`, `packages/validation/src/operations.ts`, permissions `costs:*`, `contracts:*` et `interventions:*`.
- **Web :**
  - pages Coûts d'impression, Papier, Contrats, Interventions, Maintenance et Impressions ;
  - enregistrement de l'impression depuis le rapport de préproduction ;
  - navigation, journal d'audit et indicateurs à venir du tableau de bord.
- **Tests :** `operations.e2e.test.ts`, coûts, relevés, plans de maintenance, schémas.
- **Documentation :** `docs/architecture.md` (section « Coûts, contrats et maintenance » et matrice des droits), `docs/development.md`.

### 7 novembre 2026 : Phase 8

- **Base de données :** migration `20261107000000_stocks` : `toner_stocks`, `stock_movements` (registre immuable, solde par déclencheur, stock jamais négatif), `toner_replacements`, `supply_level_readings`, `alerts` (index unique partiel de déduplication), contraintes et RLS.
- **API :** modules `stocks` (articles, mouvements, transferts, références, remplacements, détection, prévisions, évaluation horaire des ruptures prévues) et `alerts` (ouverture idempotente, résolution automatique, prise en compte, clôture, synthèse). La collecte alimente l'historique des niveaux et les alertes de toner. L'état SNMP comprend l'épuisement prévu.
- **Contrats :** `packages/shared-types/src/stocks.ts`, `packages/validation/src/stocks.ts`, permissions `stocks:read`, `stocks:manage`, `toner-replacements:manage`, `alerts:read` et `alerts:manage`.
- **Web :** pages Stocks, Toners et Alertes, panneau Alertes et stocks critiques du tableau de bord, épuisement prévu dans l'état SNMP, navigation et libellés du journal d'audit.
- **Tests :** `stocks.e2e.test.ts`, calculs de prévision, schémas ; délais SNMP élargis dans les tests de l'agent pour une machine chargée.
- **Documentation :** `docs/architecture.md` (section « Toners, stocks et alertes » et matrice des droits), `docs/development.md`.

### 6 novembre 2026 : Phase 7

- **Agent :** `services/collector` : configuration, protection DPAPI, outbox SQLite, SNMP, Printer-MIB, collecte, découverte, synchronisation, interface locale, service Windows, ligne de commande ; paquet `packaging/` (PyInstaller, scripts d'installation) ; 41 tests contre le simulateur SNMP.
- **Base de données :** migration `20261106000000_collector` : `collector_agents`, `agent_events`, `agent_sync_logs`, `printer_states`, `discovered_devices`, OID des compteurs des fiches techniques, contraintes et RLS.
- **API :** module `collector` : administration des agents, protocole des agents (`agent/v1/enroll`, `config`, `events`), `AgentGuard`, état SNMP des machines.
- **Contrats :** `packages/shared-types/src/collector.ts`, `packages/validation/src/collector.ts`, permissions `agents:read` et `agents:manage`.
- **Web :** fonctionnalité `features/collector` (page Agents de collecte, panneau État SNMP), OID des compteurs dans la fiche technique, navigation et libellés du journal d'audit.
- **Tests :** `collector.e2e.test.ts`, tests des schémas et des identifiants d'agent.
- **Documentation :** `docs/collector.md`, `docs/architecture.md` (section « Collecte SNMP » et matrice des droits), `docs/development.md`.

### 5 novembre 2026 : Phase 6

- **Analyse :** `services/analytics/src/arksen_analytics/pdf_analysis.py` (rendu, séparation, couverture, formats) et `pdf_api.py` (`POST /v1/pdf/analyze`), dépendances `pypdfium2`, `numpy`, `pillow`, `python-multipart`, avec 26 tests.
- **Base de données :** migration `20261105120000_print_jobs` : `print_jobs` et `print_job_pages`, contraintes, déclencheur de périmètre de la machine et RLS.
- **API :** module `print-jobs` (import multipart, liste, détail, estimation, modification, suppression) et client `analysis.client.ts` ; `ConsumptionService.estimateWork` réutilise le moteur pour un travail.
- **Contrats :** `packages/shared-types/src/print-jobs.ts`, `packages/validation/src/print-jobs.ts`, permissions `print-jobs:read` et `print-jobs:manage`.
- **Web :** fonctionnalité `features/print-jobs` (import, liste, rapport de préproduction), routes `/analyses` et `/analyses/:id`, entrée « Analyse PDF » de la navigation, libellés du journal d'audit.
- **Tests :** `print-jobs.e2e.test.ts`, envoi multipart dans le client de test.
- **Documentation :** `docs/architecture.md` (section « Analyse PDF » et matrice des droits), `docs/configuration.md`, `docs/development.md`.

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
