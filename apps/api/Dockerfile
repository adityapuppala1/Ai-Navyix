FROM node:22-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# Never copy developer registry credentials into an image layer.
RUN printf 'engine-strict=true\n' > .npmrc
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/policy/package.json packages/policy/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/browser-session/package.json packages/browser-session/package.json
# Missing/outdated lockfile is a build failure; resolve and review it before building.
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/server packages/server
COPY packages/workflow packages/workflow
COPY tsconfig.base.json ./
# Code generation needs URL syntax, not a live database or deployment secrets.
RUN DATABASE_URL=postgresql://127.0.0.1:1/navyix_codegen MIGRATION_DATABASE_URL=postgresql://127.0.0.1:1/navyix_codegen pnpm --filter @navyix/api db:generate
RUN pnpm --filter @navyix/api build
FROM node:22-alpine
WORKDIR /workspace
ENV NODE_ENV=production API_HOST=0.0.0.0 NAVYIX_API_ENABLED=false
RUN corepack enable
COPY --from=build /workspace /workspace
USER node
EXPOSE 4000
CMD ["node","apps/api/dist/main.js"]
