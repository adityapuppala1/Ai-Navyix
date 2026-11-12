FROM node:22-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/policy/package.json packages/policy/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/browser-session/package.json packages/browser-session/package.json
RUN pnpm install --no-frozen-lockfile
COPY apps/web apps/web
COPY packages/browser-session packages/browser-session
COPY packages/server/src/auth.mjs packages/server/src/errors.mjs packages/server/src/
COPY packages/workflow/src packages/workflow/src
COPY scripts/sync-workbench.mjs scripts/sync-workbench.mjs
COPY tsconfig.base.json ./
RUN pnpm --filter @navyix/web build
FROM node:22-alpine
WORKDIR /workspace
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /workspace /workspace
USER node
EXPOSE 3000
CMD ["pnpm","--filter","@navyix/web","start"]
