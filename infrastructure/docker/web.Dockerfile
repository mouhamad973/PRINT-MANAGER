# Application Next.js en sortie autonome. Le contexte de build est la racine du dépôt.
FROM node:24-slim AS base
ENV TURBO_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@10.34.9
WORKDIR /repo

FROM base AS pruner
RUN npm install --global turbo@2.11.10
COPY . .
RUN turbo prune @arksen/web --docker

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
COPY tsconfig.base.json ./
RUN pnpm --filter @arksen/web... build

FROM node:24-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
