# Installation hors ligne (On-Premise sans Internet)

Pour un client dont le serveur n'a **aucun accès à Internet**, ARKSEN s'installe depuis un paquet préparé à l'avance. Ce paquet contient :

- toutes les images Docker ;
- les fichiers Compose ;
- les installateurs Windows et Linux ;
- l'agent de collecte.

Le serveur ne télécharge rien, ni à l'installation ni ensuite.

Le fonctionnement est celui de l'installation On-Premise ([deployment.md](deployment.md)) : HTTPS par une autorité locale ARKSEN, sauvegardes quotidiennes, accès des postes par le réseau local.

## 1. Préparer le paquet (poste connecté, chez Arksen)

Sur un poste qui a le dépôt, Docker et Internet :

```bash
node scripts/offline-bundle.mjs
```

Le script :

- construit les images de production ;
- leur donne la version du paquet (`0.1.0-<commit>`, suivi de `-modifie` si des fichiers suivis n'étaient pas commités) ;
- les exporte, compressées, dans `images/arksen-images.tar.gz` ;
- y ajoute les fichiers d'installation et l'agent de collecte (à construire d'abord avec `services/collector/packaging/build.ps1`) ;
- calcule l'empreinte SHA-256 de chaque fichier dans `SHA256SUMS.txt`.

Le résultat est le dossier `dist/offline/arksen-onprem-<version>/`, d'environ 1 à 2 Go.

| Option         | Effet                                       |
| -------------- | ------------------------------------------- |
| `--skip-build` | Réutilise les images déjà construites       |
| `--out <dir>`  | Dossier de sortie (défaut : `dist/offline`) |
| `--no-agent`   | N'inclut pas l'agent de collecte Windows    |

Copiez le dossier sur une clé USB formatée en **exFAT ou NTFS**, car FAT32 refuse les fichiers de plus de 4 Go.

## 2. Prérequis sur le serveur du client

- 4 processeurs, 8 Go de mémoire, 50 Go de disque, une adresse IP fixe sur le réseau local.
- **Docker installé à l'avance**, avec Compose 2.24 ou plus récent. Sans Internet, apportez aussi ses fichiers d'installation :
  - **Linux** : les paquets `.deb` ou `.rpm` de Docker Engine (`docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-compose-plugin`), téléchargés depuis download.docker.com pour la distribution du serveur, puis installés avec `dpkg -i` ou `rpm -i` ;
  - **Windows** : l'installateur de Docker Desktop (vérifiez sa licence pour une entreprise de plus de 250 personnes).

## 3. Installer

Copiez le dossier du paquet sur le serveur, ou laissez-le sur la clé, puis lancez l'installateur depuis ce dossier.

**Windows** (PowerShell, Docker Desktop démarré) :

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

**Linux :**

```bash
sudo bash install.sh
```

L'installateur :

1. vérifie Docker et l'intégrité de chaque fichier du paquet (SHA-256) ;
2. copie les fichiers dans le dossier d'installation (`C:\ARKSEN` ou `/opt/arksen` ; options `-InstallDir` ou `--dir`) ;
3. à la première installation, demande :
   - le nom du serveur sur le réseau ;
   - son adresse IP ;
   - l'e-mail et le mot de passe du Super Administrateur.

   Il génère les autres secrets dans `.env.production`, lisible seulement par les administrateurs ;

4. charge les images (`docker load`) ;
5. lors d'une mise à jour, sauvegarde la base avant de changer de version ;
6. démarre ARKSEN et attend que chaque service soit sain ;
7. une fois le compte créé, retire l'e-mail et le mot de passe du Super Administrateur de `.env.production` ;
8. copie le certificat de l'autorité locale dans `arksen-ca.pem`.

Les questions peuvent être réglées à l'avance, pour une installation sans saisie. Seul le mot de passe reste demandé, sauf avec `-AdminPassword` (SecureString) sous Windows.

| Windows       | Linux           | Défaut              |
| ------------- | --------------- | ------------------- |
| `-ServerName` | `--server-name` | Nom de la machine   |
| `-ServerIp`   | `--server-ip`   | Adresse IP détectée |
| `-HttpsPort`  | `--https-port`  | 443                 |
| `-HttpPort`   | `--http-port`   | 80                  |
| `-AdminEmail` | `--admin-email` | demandé             |

**Conservez une copie de `.env.production` hors du serveur.** Il contient la clé de chiffrement des secrets SNMP, et une sauvegarde ne peut pas être restaurée sans elle.

## 4. Après l'installation

- **Postes des utilisateurs.** Installez `arksen-ca.pem` dans les autorités racines de confiance, par stratégie de groupe ou avec `certutil -addstore Root arksen-ca.pem`. Les utilisateurs ouvrent ensuite l'adresse affichée par l'installateur, par exemple `https://print-srv`.
- **Agent de collecte.** Il est dans `agent/`. Installez-le sur un poste du réseau des imprimantes avec `install.ps1 ... -CaFile arksen-ca.pem` ([collector.md](collector.md)).
- **Commandes courantes** : le raccourci `arksen` du dossier d'installation remplace la longue commande `docker compose`. Sous Windows, il s'appelle `arksen.cmd` et se lance avec `.\arksen.cmd` depuis PowerShell :

  ```bash
  ./arksen ps          # état des services
  ./arksen logs -f api # journaux
  ./arksen down        # arrêt (données conservées)
  ./arksen up -d       # démarrage
  ./arksen run --rm backup once  # sauvegarde immédiate
  ```

- **Sauvegardes.** Elles vont dans le dossier `backups/` du dossier d'installation. Recopiez-les régulièrement sur un autre support, comme un NAS ou un disque externe.

## 5. Mettre à jour

Préparez un nouveau paquet, apportez-le, puis relancez le même installateur. Il garde `.env.production`, sauvegarde la base, charge les nouvelles images et démarre la nouvelle version. Les migrations de la base s'appliquent toutes seules.

**Retour à la version précédente :**

1. Remettez son numéro dans `ARKSEN_VERSION` (fichier `.env.production`). Ses images restent sur le serveur tant qu'elles ne sont pas supprimées.
2. Restaurez la sauvegarde faite avant la mise à jour ([deployment.md](deployment.md#sauvegarde-et-restauration)).
3. Lancez `arksen up -d`.

## Limites

- Le certificat est celui de l'autorité locale ARKSEN. Pour utiliser le certificat de l'entreprise, voir [deployment.md](deployment.md#2b-démarrage-on-premise).
- Les mises à jour du système et de Docker du serveur restent à la charge du client.
