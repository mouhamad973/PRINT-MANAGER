# Installation et déploiement

ARKSEN PRINT MANAGER s'installe de deux façons, avec les mêmes images :

- **Cloud** : un serveur public opéré par Arksen, plusieurs entreprises clientes, certificat Let's Encrypt.
- **On-Premise** : le serveur d'une entreprise, sur son réseau local, sans accès Internet requis, certificat signé par une autorité locale.

La pile de développement (`docker compose up`, [development.md](development.md)) n'est pas faite pour la production : elle publie la base, Redis et l'API sur l'hôte.

## Prérequis

- Linux x86-64 (Debian 12, Ubuntu 24.04 ou équivalent) ou Windows Server avec Docker Desktop ; 4 processeurs, 8 Go de mémoire, 50 Go de disque.
- Docker Engine 27 ou plus récent, avec Docker Compose 2.30 ou plus récent.
- Le dépôt ARKSEN (archive ou `git clone`).
- Cloud : un nom DNS qui pointe vers le serveur, ports 80 et 443 ouverts depuis Internet.
- On-Premise : un nom DNS interne ou une adresse IP fixe, ports 443 (et 80) ouverts sur le réseau local.

## Pile de production

| Service     | Rôle                                                      | Exposé         |
| ----------- | --------------------------------------------------------- | -------------- |
| `nginx`     | HTTPS, redirection HTTP, HSTS, adresse réelle des clients | 80 et 443      |
| `web`       | Frontend Next.js et relais `/backend` vers l'API          | Réseau interne |
| `api`       | API NestJS                                                | Réseau interne |
| `workers`   | Traitements asynchrones                                   | Réseau interne |
| `analytics` | Analyse PDF et moteur CMJN                                | Réseau interne |
| `postgres`  | Base de données                                           | Réseau interne |
| `redis`     | Cache et files de tâches                                  | Réseau interne |
| `migrate`   | Rôles, migrations et droits, puis s'arrête                | —              |
| `backup`    | Sauvegarde quotidienne de la base                         | —              |
| `certbot`   | Cloud seulement : certificat Let's Encrypt                | —              |

## Installation

### 1. Configuration

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Remplissez chaque valeur ([configuration.md](configuration.md)). Générez les secrets avec :

```bash
openssl rand -hex 32
```

- `PUBLIC_WEB_URL` est l'adresse exacte ouverte par les utilisateurs, en `https://`, avec le port s'il n'est pas 443.
- `CREDENTIALS_ENCRYPTION_KEY` doit être conservée hors du serveur : sans elle, une sauvegarde restaurée perd ses secrets SNMP.
- `SUPER_ADMIN_EMAIL` et `SUPER_ADMIN_PASSWORD` créent le premier Super Administrateur au premier démarrage ; videz-les ensuite.

### 2a. Démarrage Cloud

```bash
docker compose --env-file .env.production -f infrastructure/compose/compose.prod.yaml -f infrastructure/compose/compose.cloud.yaml up -d --build
```

Au premier démarrage, nginx sert un certificat provisoire ; `certbot` obtient le certificat Let's Encrypt par validation HTTP, et nginx le prend dans l'heure. Pour l'appliquer tout de suite :

```bash
docker compose --env-file .env.production -f infrastructure/compose/compose.prod.yaml -f infrastructure/compose/compose.cloud.yaml restart nginx
```

`certbot` renouvelle le certificat deux fois par jour quand il approche de l'expiration, et nginx se recharge de lui-même.

### 2b. Démarrage On-Premise

```bash
docker compose --env-file .env.production -f infrastructure/compose/compose.prod.yaml -f infrastructure/compose/compose.onprem.yaml up -d --build
```

Au premier démarrage, nginx crée une **autorité de certification locale ARKSEN** (valable 10 ans) et un certificat pour `SERVER_NAME`, `localhost` et `SERVER_IP` (valable 825 jours). Récupérez le certificat de l'autorité :

```bash
docker compose --env-file .env.production -f infrastructure/compose/compose.prod.yaml -f infrastructure/compose/compose.onprem.yaml cp nginx:/etc/nginx/certs/ca.pem ./arksen-ca.pem
```

Installez `arksen-ca.pem` :

- sur les postes Windows, dans « Autorités de certification racines de confiance » (stratégie de groupe ou `certutil -addstore Root arksen-ca.pem`) ;
- dans l'agent de collecte : `install.ps1 ... -CaFile arksen-ca.pem`.

Pour utiliser le certificat de l'entreprise à la place, copiez `fullchain.pem` et `privkey.pem` dans le volume `tls-certs` (`docker compose ... cp`), puis redémarrez nginx : un certificat présent n'est jamais remplacé.

Pour renouveler le certificat local avant ses 825 jours, supprimez `fullchain.pem` du volume et redémarrez nginx : l'autorité est conservée, les postes n'ont rien à refaire.

### 3. Vérification

```bash
docker compose --env-file .env.production -f infrastructure/compose/compose.prod.yaml -f infrastructure/compose/compose.onprem.yaml ps
```

Tous les services doivent être `healthy` (sauf `migrate`, terminé). Ouvrez `PUBLIC_WEB_URL`, connectez-vous avec le Super Administrateur, puis ouvrez « Administration système » : version, mode de déploiement et état des services.

Dans la suite, `$ARKSEN` désigne la commande complète :

```bash
ARKSEN="docker compose --env-file .env.production -f infrastructure/compose/compose.prod.yaml -f infrastructure/compose/compose.onprem.yaml"
```

## Mise à jour

```bash
git pull
$ARKSEN up -d --build
```

Le service `migrate` applique les nouvelles migrations avant le démarrage de l'API. Faites une sauvegarde juste avant (section suivante).

## Sauvegarde et restauration

Le service `backup` fait une sauvegarde au démarrage, puis toutes les `BACKUP_INTERVAL_HOURS` heures, dans `BACKUP_DIR` : `arksen-AAAAMMJJ-HHMMSS.dump` (format `pg_dump` compressé) et son empreinte `.sha256`. Les sauvegardes de plus de `BACKUP_RETENTION_DAYS` jours sont supprimées. **Recopiez ce dossier hors du serveur** (NAS, stockage objet) : une sauvegarde sur le même disque ne protège pas d'une panne de disque.

Sauvegarde immédiate :

```bash
$ARKSEN run --rm backup once
```

Restauration (le contenu actuel de la base est remplacé) :

```bash
$ARKSEN stop api workers web
$ARKSEN run --rm backup restore arksen-20261105-020000.dump
$ARKSEN up -d
```

Sur un serveur neuf, démarrez d'abord la pile une fois (le service `migrate` crée les rôles `arksen_app` et `arksen_system`), puis restaurez. La restauration vérifie l'empreinte du fichier et s'exécute en une transaction : en cas d'erreur, la base reste intacte.

Avec la base, sauvegardez à part `.env.production` (dont `CREDENTIALS_ENCRYPTION_KEY`) et, en On-Premise, le volume `tls-certs` (autorité locale).

## Exploitation

- **Journaux** : `$ARKSEN logs -f api` ; rotation automatique (5 fichiers de 20 Mo par service).
- **Conservation des données** : appliquée chaque jour par l'API ; réglages dans [security.md](security.md).
- **Pare-feu** : n'ouvrez que 80 et 443. Aucun autre port n'est publié.
- **Agents de collecte** : ils joignent le serveur par `PUBLIC_WEB_URL` en HTTPS. Voir [collector.md](collector.md).

## Désinstallation

```bash
$ARKSEN down
```

Les volumes (base, Redis, certificats) sont conservés. `down --volumes` les supprime définitivement : faites une sauvegarde avant.
