FROM node:22-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/policy/package.json packages/policy/package.json
RUN pnpm install --no-frozen-lockfile
COPY apps/api apps/api
COPY tsconfig.base.json ./
RUN pnpm --filter @navyix/api db:generate && pnpm --filter @navyix/api build
FROM node:22-alpine
WORKDIR /workspace
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /workspace /workspace
USER node
EXPOSE 4000
CMD ["node","apps/api/dist/main.js"]
