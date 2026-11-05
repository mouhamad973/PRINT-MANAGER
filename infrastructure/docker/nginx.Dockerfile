# Frontal HTTPS : nginx officiel, plus openssl pour l'autorité locale des installations On-Premise.
FROM nginx:1.29-alpine
RUN apk add --no-cache openssl \
    && mkdir -p /var/www/acme /etc/nginx/certs \
    && rm -f /etc/nginx/conf.d/default.conf
COPY infrastructure/nginx/templates/ /etc/nginx/templates/
COPY --chmod=755 infrastructure/nginx/entrypoint/40-arksen-tls.sh /docker-entrypoint.d/40-arksen-tls.sh
# Seules ces variables sont remplacées dans les modèles : $host, $remote_addr... restent à nginx.
ENV NGINX_ENVSUBST_FILTER='^(SERVER_NAME|PUBLIC_WEB_URL)$'
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD wget -q --spider --no-check-certificate https://127.0.0.1/healthz || exit 1
