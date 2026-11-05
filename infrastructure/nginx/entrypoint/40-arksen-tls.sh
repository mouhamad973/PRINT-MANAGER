#!/bin/sh
# Certificat TLS du frontal, avant le démarrage de nginx.
#
#   1. Un certificat Let's Encrypt obtenu par le service certbot (Cloud) est recopié.
#   2. Sinon, un certificat déjà présent dans /etc/nginx/certs (fourni par l'exploitant) est gardé.
#   3. Sinon, une autorité locale ARKSEN est créée et signe un certificat pour SERVER_NAME
#      (On-Premise). Son certificat, ca.pem, est à installer sur les postes et les agents.
#
# Une boucle de fond recopie ensuite un certificat Let's Encrypt renouvelé et recharge nginx.
set -eu

CERTS=/etc/nginx/certs
LIVE="/etc/letsencrypt/live/${SERVER_NAME}"
mkdir -p "$CERTS"

copy_letsencrypt() {
    if [ -s "$LIVE/fullchain.pem" ] && ! cmp -s "$LIVE/fullchain.pem" "$CERTS/fullchain.pem"; then
        cp "$LIVE/fullchain.pem" "$CERTS/fullchain.pem"
        cp "$LIVE/privkey.pem" "$CERTS/privkey.pem"
        chmod 600 "$CERTS/privkey.pem"
        return 0
    fi
    return 1
}

local_authority() {
    echo "ARKSEN : création d'une autorité de certification locale pour ${SERVER_NAME}"
    umask 077
    if [ ! -s "$CERTS/ca.key" ]; then
        openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes \
            -keyout "$CERTS/ca.key" -out "$CERTS/ca.pem" \
            -subj "/O=ARKSEN PRINT MANAGER/CN=ARKSEN autorite locale ${SERVER_NAME}" \
            -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
            -addext "keyUsage=critical,keyCertSign,cRLSign"
    fi
    san="DNS:${SERVER_NAME},DNS:localhost,IP:127.0.0.1"
    if [ -n "${SERVER_IP:-}" ]; then
        san="${san},IP:${SERVER_IP}"
    fi
    openssl req -newkey rsa:2048 -sha256 -nodes \
        -keyout "$CERTS/privkey.pem" -out "$CERTS/server.csr" \
        -subj "/O=ARKSEN PRINT MANAGER/CN=${SERVER_NAME}"
    printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$san" > "$CERTS/server.ext"
    openssl x509 -req -in "$CERTS/server.csr" -CA "$CERTS/ca.pem" -CAkey "$CERTS/ca.key" \
        -CAcreateserial -days 825 -sha256 -extfile "$CERTS/server.ext" -out "$CERTS/server.pem"
    cat "$CERTS/server.pem" "$CERTS/ca.pem" > "$CERTS/fullchain.pem"
    rm -f "$CERTS/server.csr" "$CERTS/server.ext"
    chmod 644 "$CERTS/ca.pem" "$CERTS/fullchain.pem"
}

if ! copy_letsencrypt && [ ! -s "$CERTS/fullchain.pem" ]; then
    local_authority
fi

(
    while sleep 3600; do
        if copy_letsencrypt; then
            echo "ARKSEN : certificat renouvelé, rechargement de nginx"
            nginx -s reload
        fi
    done
) &
