# Workers BullMQ. Le contexte de build est la racine du dépôt.
FROM node:24-slim AS base
ENV TURBO_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@10.34.9
WORKDIR /repo

FROM base AS pruner
RUN npm install --global turbo@2.11.10
COPY . .
RUN turbo prune @arksen/workers --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
COPY tsconfig.base.json ./
RUN pnpm --filter @arksen/workers... build
RUN pnpm --filter @arksen/workers deploy --legacy --prod /prod/workers

FROM node:24-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /prod/workers ./
USER node
CMD ["node", "dist/main.js"]
