#!/usr/bin/env bash
# Installe ou met à jour ARKSEN PRINT MANAGER sur un serveur Linux SANS accès Internet, depuis
# le paquet hors ligne (scripts/offline-bundle.mjs). Prérequis : Docker Engine et Compose.
#
#   sudo bash install.sh [--dir /opt/arksen] [--server-name print.local] [--server-ip 10.0.0.5]
#                        [--https-port 443] [--http-port 80] [--admin-email admin@exemple.com]
#
# Première installation : pose les questions manquantes (le mot de passe du Super Administrateur
# est lu sur l'entrée standard), génère les secrets dans <dir>/.env.production. Mise à jour :
# sauvegarde la base, puis démarre la nouvelle version. Voir LISEZMOI.md.
set -euo pipefail

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR=/opt/arksen
SERVER_NAME=''
SERVER_IP=''
SERVER_IP_SET=0
HTTPS_PORT=443
HTTP_PORT=80
ADMIN_EMAIL=''
COMPOSE_FILES=(compose.prod.yaml compose.onprem.yaml compose.offline.yaml)

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --server-name) SERVER_NAME="$2"; shift 2 ;;
    --server-ip) SERVER_IP="$2"; SERVER_IP_SET=1; shift 2 ;;
    --https-port) HTTPS_PORT="$2"; shift 2 ;;
    --http-port) HTTP_PORT="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n== %s\n' "$1"; }
fail() { printf 'ERREUR : %s\n' "$1" >&2; exit 1; }

compose() {
  local args=(compose --env-file .env.production)
  for file in "${COMPOSE_FILES[@]}"; do args+=(-f "infrastructure/compose/$file"); done
  docker "${args[@]}" "$@"
}

new_secret() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# Remplace (ou ajoute) KEY=VALUE dans .env.production sans interpréter la valeur.
set_env() {
  local key="$1" value="$2" tmp found=0 line
  tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" == "$key="* ]]; then
      printf '%s=%s\n' "$key" "$value"
      found=1
    else
      printf '%s\n' "$line"
    fi
  done < "$ENV_FILE" > "$tmp"
  [ "$found" = 1 ] || printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

ask() {
  local prompt="$1" default="$2" answer
  read -r -p "$prompt [$default] : " answer
  printf '%s' "${answer:-$default}"
}

# --- 1. Vérifications ---
step 'Vérification de Docker'
docker version --format '{{.Server.Version}}' > /dev/null 2>&1 \
  || fail 'Docker ne répond pas : démarrez-le (systemctl start docker) ou lancez ce script avec sudo.'
COMPOSE_VERSION="$(docker compose version --short 2>/dev/null | sed 's/^v//')" \
  || fail 'Docker Compose est requis (paquet docker-compose-plugin).'
if [ "$(printf '%s\n2.24.0\n' "${COMPOSE_VERSION%%-*}" | sort -V | head -n1)" != '2.24.0' ]; then
  fail "Docker Compose 2.24 ou plus récent est requis (trouvé : $COMPOSE_VERSION)."
fi
echo "Docker $(docker version --format '{{.Server.Version}}'), Compose $COMPOSE_VERSION"

step 'Vérification du paquet (SHA-256)'
[ -f "$BUNDLE/SHA256SUMS.txt" ] || fail 'SHA256SUMS.txt introuvable : paquet incomplet.'
(cd "$BUNDLE" && sha256sum --check --quiet SHA256SUMS.txt) || fail 'Paquet altéré ou mal copié.'
VERSION="$(tr -d '[:space:]' < "$BUNDLE/VERSION")"
echo "Paquet intègre, version $VERSION"

# --- 2. Fichiers ---
step "Copie des fichiers dans $INSTALL_DIR"
mkdir -p "$INSTALL_DIR/infrastructure/compose"
for file in "${COMPOSE_FILES[@]}"; do
  cp "$BUNDLE/infrastructure/compose/$file" "$INSTALL_DIR/infrastructure/compose/"
done
cp "$BUNDLE/.env.production.example" "$BUNDLE/VERSION" "$BUNDLE/LISEZMOI.md" "$INSTALL_DIR/"
[ -d "$BUNDLE/agent" ] && cp -r "$BUNDLE/agent" "$INSTALL_DIR/"
{
  echo '#!/bin/sh'
  echo '# Raccourci : ./arksen ps, ./arksen logs api, ./arksen down, ./arksen up -d ...'
  echo 'cd "$(dirname "$0")" || exit 1'
  printf 'exec docker compose --env-file .env.production'
  for file in "${COMPOSE_FILES[@]}"; do printf ' -f infrastructure/compose/%s' "$file"; done
  echo ' "$@"'
} > "$INSTALL_DIR/arksen"
chmod 755 "$INSTALL_DIR/arksen"
cd "$INSTALL_DIR"

# --- 3. Configuration (première installation) ---
ENV_FILE="$INSTALL_DIR/.env.production"
FIRST_INSTALL=0
if [ ! -f "$ENV_FILE" ]; then
  FIRST_INSTALL=1
  step 'Configuration'
  [ -n "$SERVER_NAME" ] || SERVER_NAME="$(ask 'Nom du serveur sur le réseau' "$(hostname -s 2>/dev/null || hostname)")"
  if [ "$SERVER_IP_SET" = 0 ]; then
    SERVER_IP="$(ask 'Adresse IP du serveur' "$(hostname -I 2>/dev/null | awk '{print $1}')")"
  fi
  until [[ "$ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; do
    read -r -p 'E-mail du Super Administrateur : ' ADMIN_EMAIL
  done
  while :; do
    read -r -s -p 'Mot de passe du Super Administrateur (12 caractères minimum) : ' PASSWORD; echo
    read -r -s -p 'Confirmez le mot de passe : ' CONFIRM; echo
    if [ "$PASSWORD" != "$CONFIRM" ]; then echo 'Les deux saisies diffèrent.'; continue; fi
    if [ "${#PASSWORD}" -lt 12 ]; then echo 'Au moins 12 caractères.'; continue; fi
    if [[ "$PASSWORD" == *"'"* ]]; then echo "L'apostrophe ' n'est pas acceptée."; continue; fi
    break
  done
  if [ "$HTTPS_PORT" = 443 ]; then PUBLIC_URL="https://$SERVER_NAME"; else PUBLIC_URL="https://$SERVER_NAME:$HTTPS_PORT"; fi

  (umask 077 && cp .env.production.example "$ENV_FILE")
  set_env SERVER_NAME "$SERVER_NAME"
  set_env PUBLIC_WEB_URL "$PUBLIC_URL"
  set_env SERVER_IP "$SERVER_IP"
  set_env HTTP_PORT "$HTTP_PORT"
  set_env HTTPS_PORT "$HTTPS_PORT"
  for key in POSTGRES_PASSWORD APP_DB_PASSWORD SYSTEM_DB_PASSWORD REDIS_PASSWORD \
    BETTER_AUTH_SECRET CREDENTIALS_ENCRYPTION_KEY; do
    set_env "$key" "$(new_secret)"
  done
  set_env SUPER_ADMIN_EMAIL "$ADMIN_EMAIL"
  set_env SUPER_ADMIN_PASSWORD "'$PASSWORD'"
  set_env SUPER_ADMIN_NAME 'Super Administrateur'
  unset PASSWORD CONFIRM
  chmod 600 "$ENV_FILE"
  echo "Configuration écrite dans $ENV_FILE"
fi
set_env ARKSEN_VERSION "$VERSION"

# --- 4. Images ---
step 'Chargement des images Docker (quelques minutes)'
docker load -i "$BUNDLE/images/arksen-images.tar.gz"

# --- 5. Sauvegarde avant mise à jour ---
if [ "$FIRST_INSTALL" = 0 ] && [ -n "$(compose ps -a -q postgres)" ]; then
  step 'Sauvegarde de la base avant mise à jour'
  compose up -d --wait postgres
  compose run --rm --no-deps backup once
fi

# --- 6. Démarrage ---
step "Démarrage d'ARKSEN (premier démarrage : quelques minutes)"
compose up -d --wait --wait-timeout 900 --remove-orphans

if [ "$FIRST_INSTALL" = 1 ]; then
  # Le compte est créé : le mot de passe n'a plus rien à faire sur le disque.
  set_env SUPER_ADMIN_EMAIL ''
  set_env SUPER_ADMIN_PASSWORD ''
  compose up -d --wait --wait-timeout 300 api
fi

compose cp nginx:/etc/nginx/certs/ca.pem "$INSTALL_DIR/arksen-ca.pem"

PUBLIC_URL="$(sed -n 's/^PUBLIC_WEB_URL=//p' "$ENV_FILE")"
echo
echo "ARKSEN $VERSION est démarré : $PUBLIC_URL"
echo "Certificat de l'autorité locale : $INSTALL_DIR/arksen-ca.pem"
echo '  - à installer sur chaque poste Windows : certutil -addstore Root arksen-ca.pem'
echo "  - à donner à l'agent de collecte : install.ps1 ... -CaFile arksen-ca.pem"
echo "Commandes courantes : $INSTALL_DIR/arksen ps | logs api | down | up -d"
if [ "$FIRST_INSTALL" = 1 ]; then
  echo "Conservez une copie de $ENV_FILE hors du serveur (clé de chiffrement)."
fi
