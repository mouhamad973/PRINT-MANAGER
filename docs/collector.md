# Agent ARKSEN Collector

Service Windows installé sur le réseau du client. Il interroge les imprimantes en SNMP, garde ses relevés dans une base SQLite locale et les synchronise avec ARKSEN PRINT MANAGER, en Cloud comme en On-Premise. Il continue de collecter sans Internet et rattrape seul ses synchronisations.

Code : `services/collector` (Python 3.12, PySNMP, httpx, SQLite, pywin32). Paquet : PyInstaller.

## Installation chez un client

1. Dans ARKSEN PRINT MANAGER, ouvrir **Parc › Agents de collecte** et cliquer **Ajouter un agent**. Choisir le site couvert, ou aucun pour tout le parc. Le **code d'enregistrement** s'affiche une seule fois ; il est valable 24 heures et sert une seule fois.
2. Sur un poste Windows allumé en permanence (serveur, poste de l'accueil) et qui joint les imprimantes en UDP 161, décompresser `arksen-collector-<version>.zip`.
3. En administrateur, depuis le dossier décompressé :

   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1 -Server https://print.exemple.com -Code XXXX-XXXX-XXXX-XXXX
   ```

   Le script copie l'agent dans `C:\Program Files\Arksen\Collector`, restreint le dossier de données aux administrateurs et au système, enregistre l'agent puis installe et démarre le service `ArksenCollector` en démarrage automatique.

4. L'interface locale est ensuite ouverte sur ce poste : <http://127.0.0.1:8765/>.

Sans `-Server` ni `-Code`, l'agent s'enregistre depuis l'interface locale.

Désinstallation : `uninstall.ps1`. Les données (`C:\ProgramData\Arksen\Collector`) sont conservées, car elles peuvent contenir des relevés pas encore synchronisés.

### Configuration des machines

Les machines interrogées se configurent dans ARKSEN PRINT MANAGER, et non sur le poste. Elles sont saisies ou découvertes, et l'agent reçoit leur configuration du serveur.

- **Fiche de la machine › Réseau et SNMP :** adresse IP ou nom d'hôte, version SNMP (v1, v2c ou v3), communauté ou utilisateur SNMPv3. Ces secrets sont chiffrés en base et ne sont déchiffrés que pour l'agent authentifié.
- **Fiche technique du modèle :** OID des compteurs noir et couleur. Le compteur total est standard (Printer-MIB `prtMarkerLifeCount`). Le partage entre noir et couleur, lui, est propre à chaque constructeur.
  - Sans ces OID, une machine noir et blanc est relevée sur son compteur total.
  - Une machine couleur, elle, ne produit aucun relevé : seul son état est collecté. Aucun partage entre noir et couleur n'est inventé.

L'agent rafraîchit sa configuration toutes les 5 minutes. Il garde la dernière en cache, protégée par DPAPI, pour continuer à collecter hors ligne.

### Interface locale

Elle est servie uniquement sur `127.0.0.1`. Elle permet de :

- enregistrer l'agent : adresse du serveur et code ;
- voir l'identifiant de l'entreprise et celui de l'agent, attribués par le serveur ;
- régler la fréquence de collecte (15 minutes par défaut) ;
- régler les plages explorées par la découverte et les communautés essayées ;
- indiquer un certificat d'autorité pour un serveur On-Premise à certificat interne ;
- suivre l'état de la synchronisation : événements en attente, journal, rejets ;
- lancer une collecte, une synchronisation ou une découverte immédiate.

Protections de l'interface locale :

- l'en-tête `Host` est vérifié, contre le rebinding DNS ;
- l'origine et un jeton anti-CSRF sont vérifiés sur chaque formulaire ;
- une politique CSP stricte s'applique, et la page ne peut pas être affichée dans un cadre.

### Ligne de commande

```bash
arksen-collector enroll --server https://print.exemple.com --code XXXX-XXXX-XXXX-XXXX
```

| Commande                                     | Effet                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `run`                                        | Collecte et synchronise en continu, au premier plan, avec l'interface locale |
| `collect`                                    | Collecte une fois, puis synchronise (`--no-sync` pour s'en dispenser)        |
| `sync`                                       | Envoie tout de suite les événements en attente                               |
| `discover --range 192.168.1.0/24`            | Cherche les imprimantes d'une plage                                          |
| `status`                                     | État de l'agent et de sa synchronisation, en JSON                            |
| `ui`                                         | Ouvre l'interface locale                                                     |
| `service install`, `start`, `stop`, `remove` | Gère le service Windows                                                      |

Toutes les commandes acceptent `--home <dossier>` pour un autre dossier de données. Par défaut, c'est `%ProgramData%\Arksen\Collector`, ou la variable `ARKSEN_COLLECTOR_HOME`.

## Ce qui est collecté

À chaque collecte, l'agent interroge les machines en parallèle, 16 à la fois. Il lit, uniquement par des OID normalisés plus ceux de la fiche technique :

| Information                  | Source                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Compteur total               | Printer-MIB `prtMarkerLifeCount`                                             |
| Compteurs noir et couleur    | OID de la fiche technique du modèle                                          |
| Niveaux des consommables     | Printer-MIB `prtMarkerSuppliesTable` et `prtMarkerColorantTable`             |
| Statut et activité           | Host Resources `hrDeviceStatus` et `hrPrinterStatus`                         |
| Alertes                      | `hrPrinterDetectedErrorState` : papier, toner, capot, bourrage, maintenance… |
| Numéro de série, description | Printer-MIB `prtGeneralSerialNumber`, `hrDeviceDescr`                        |

Ces niveaux suivent une règle de lecture :

- Un niveau n'est exprimé en pourcentage que si la machine donne à la fois le niveau et la capacité.
- Les valeurs réservées de la Printer-MIB (« il en reste », « inconnu ») restent inconnues.
- Ces niveaux ont l'origine `snmp_level`. Ce sont des niveaux déclarés par la machine, jamais une consommation mesurée.

Une machine injoignable produit un état « injoignable » avec la raison de l'échec, et jamais de relevé. Les raisons possibles sont :

- pas de réponse : machine éteinte, adresse ou communauté incorrecte ;
- identifiants SNMPv3 refusés ;
- adresse introuvable.

**Découverte.** Toutes les 6 heures, si des plages sont configurées, l'agent interroge chaque adresse (4 096 au plus) avec les communautés indiquées.

- Il ne retient que les imprimantes : `hrDeviceType` vaut `hrDevicePrinter`, ou un numéro de série Printer-MIB est présent.
- Le serveur rattache un équipement découvert à la machine de même numéro de série. Les autres apparaissent comme « Hors du parc » : on peut les associer à une machine, ou les ignorer.

## Stockage local et synchronisation

Base `collector.db` (SQLite, mode WAL, écritures synchrones) dans le dossier de données :

| Table          | Contenu                                                          |
| -------------- | ---------------------------------------------------------------- |
| `outbox`       | Événements à envoyer, avec leur statut de synchronisation        |
| `readings`     | Relevés de compteurs, liés à leur événement                      |
| `sync_log`     | Journal des 1 000 dernières synchronisations                     |
| `printer_runs` | Dernière tentative et dernier succès par machine                 |
| `kv`           | Configuration reçue (protégée), horodatages, état d'autorisation |

**Transactional Outbox.** Un relevé et son événement sont écrits dans la même transaction SQLite : l'un n'existe jamais sans l'autre.

Chaque événement porte :

- un UUID, qui sert de clé d'idempotence ;
- l'identifiant de la machine et celui de l'agent ;
- un horodatage ;
- une version de schéma (1) ;
- un statut : `pending`, `accepted`, `duplicate` ou `rejected`.

**Envoi.** Toutes les 30 secondes, et juste après chaque collecte, l'agent envoie les événements dus par lots de 200. Le serveur acquitte chaque événement :

| Accusé      | Sens                                                                   | Suite côté agent              |
| ----------- | ---------------------------------------------------------------------- | ----------------------------- |
| `accepted`  | Traité                                                                 | Sort de l'attente             |
| `duplicate` | Déjà reçu (renvoi après une réponse perdue) : pas de second traitement | Sort de l'attente             |
| `rejected`  | Refusé définitivement, avec sa raison                                  | Gardé, marqué, jamais renvoyé |
| aucun       | Lot interrompu                                                         | Reste à envoyer               |

**Reprise.** Après un échec, l'agent attend avant de renvoyer :

- les échecs sont une coupure réseau, un délai dépassé ou une erreur serveur ;
- le délai croît de façon exponentielle : 5 s, 10 s, 20 s… jusqu'à une heure, à ±20 % près pour ne pas synchroniser tous les agents en même temps ;
- aucune intervention n'est nécessaire.

Si le serveur refuse le jeton (agent révoqué), l'agent s'arrête et conserve ses événements. Un nouveau code les fera partir.

**Conservation.** Un événement non acquitté n'est jamais supprimé. Les événements acceptés ou en doublon sont purgés après 30 jours. Les rejetés sont conservés pour consultation.

## Sécurité

- **Enregistrement :** code à usage unique de 80 bits, valable 24 heures, limité à 10 tentatives par adresse IP et par 10 minutes. Le serveur ne conserve que son empreinte SHA-256.
- **Jeton de l'agent :** 256 bits, délivré une seule fois.
  - Le serveur n'en garde que l'empreinte.
  - L'agent le garde chiffré par DPAPI (portée machine) : copié sur un autre poste, il est illisible.
  - Il est revérifié à chaque requête, et une révocation prend effet immédiatement.
- **Identité :** le serveur déduit l'entreprise et le site de l'agent de son jeton, jamais de la requête. Un événement pour la machine d'un autre site ou d'une autre entreprise est rejeté (« Machine inconnue pour cet agent »). Les tables de la collecte sont sous RLS.
- **Transport :** HTTPS obligatoire. HTTP n'est admis que vers la boucle locale, ou sur autorisation explicite (réseau de test). Un certificat d'autorité interne peut être ajouté pour un serveur On-Premise.
- **Adresse des requêtes :** l'agent joint le serveur par le relais du frontend (`https://<serveur>/backend/api/v1/agent/v1/…`). Il n'a donc besoin que de l'adresse web de l'application.

## Protocole (version 1)

| Route                   | Authentification      | Rôle                                                      |
| ----------------------- | --------------------- | --------------------------------------------------------- |
| `POST /agent/v1/enroll` | Code d'enregistrement | Échange le code contre l'identité de l'agent et son jeton |
| `GET /agent/v1/config`  | `Bearer ark_…`        | Machines à interroger, secrets SNMP, OID des compteurs    |
| `POST /agent/v1/events` | `Bearer ark_…`        | Lot d'au plus 200 événements ; un accusé par événement    |

L'agent envoie aussi les en-têtes `X-Agent-Version` et `X-Agent-Hostname`, affichés dans la liste des agents.

Types d'événements : `meter.reading`, `printer.status`, `device.discovered`.

- **Validation :** chaque événement est validé et traité dans sa propre transaction. Un événement mal formé est rejeté seul, sans bloquer le lot.
- **Événement en retard :** un état plus ancien que le dernier connu (reprise après une coupure) ne remplace pas ce dernier.
- **Horodatage :** un événement daté de plus de 5 minutes dans le futur est rejeté : il trahit une horloge déréglée.

## Construction du paquet

Sous Windows, depuis `services/collector` :

```powershell
powershell -ExecutionPolicy Bypass -File packaging\build.ps1
```

Le script produit :

- `dist\arksen-collector\`, l'exécutable autonome et ses bibliothèques, sans Python à installer ;
- `dist\arksen-collector-<version>.zip`, avec `install.ps1` et `uninstall.ps1`.

L'exécutable sert à la fois de ligne de commande et de service : lancé sans argument par le gestionnaire de services Windows, il démarre le service.

## Tests

`pnpm --filter @arksen/collector test` lance les tests de l'agent. Ils interrogent un vrai répondeur SNMP sur la boucle locale (snmpsim) : de vraies requêtes UDP en SNMP v1, v2c et v3 (SHA et AES).

Les équipements simulés sont définis dans `tests/snmpdata/generate.py` :

- un multifonction couleur ;
- une imprimante noir et blanc ;
- un commutateur.

Ce sont des données de test : leurs descriptions l'indiquent, et leurs OID constructeur appartiennent à l'entreprise fictive 99999.

Les tests couvrent :

- la collecte et la découverte ;
- les erreurs SNMP ;
- l'outbox : transactions, accusés, reprise et purge ;
- la synchronisation : coupure réseau, réponse perdue suivie d'un doublon, rejet, révocation ;
- la configuration et l'interface locale.
