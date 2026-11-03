# API NestJS et image de migration Prisma. Le contexte de build est la racine du dépôt.
FROM node:24-slim AS base
ENV TURBO_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@10.34.9
WORKDIR /repo

FROM base AS pruner
RUN npm install --global turbo@2.11.10
COPY . .
RUN turbo prune @arksen/api --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
COPY tsconfig.base.json ./
RUN pnpm --filter @arksen/api... build
RUN pnpm --filter @arksen/api deploy --legacy --prod /prod/api

# Migrations : garde le workspace complet pour disposer de la CLI Prisma.
FROM builder AS migrate
WORKDIR /repo/packages/database
CMD ["sh", "-c", "node scripts/provision.mjs roles && pnpm exec prisma migrate deploy && node scripts/provision.mjs grants"]

FROM node:24-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /prod/api ./
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
