# A separate Dockerfile for this service - not Railpack (see railpack.json
# at the repo root) - because Railpack's own build-plan resolution in this
# monorepo consistently built web/landing's package.json scripts regardless
# of this service's dashboard-configured build/start commands (observed
# across three different Railway projects/services). A Dockerfile has no
# auto-detection step to get wrong: it runs exactly the commands below.
FROM node:24-slim

WORKDIR /app

# The whole monorepo, not just web/app - this app depends on the
# web/shared/ui and @sylox/sdk workspace members, so npm's workspace
# resolution needs every workspace's package.json (and the root
# lockfile) present.
COPY package.json package-lock.json ./
COPY web/app/package.json web/app/package.json
COPY web/landing/package.json web/landing/package.json
COPY web/shared/ui/package.json web/shared/ui/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/sdk/src/contracts/event-registry/package.json packages/sdk/src/contracts/event-registry/package.json
COPY packages/sdk/src/contracts/risk-oracle/package.json packages/sdk/src/contracts/risk-oracle/package.json
COPY packages/sdk/src/contracts/token/package.json packages/sdk/src/contracts/token/package.json

RUN npm install

COPY . .

ENV NODE_ENV=production
# web/app's own build needs @sylox/sdk's compiled dist/ output (its
# package.json points "types"/"main" there, not raw src/), so the SDK
# must build first - same ordering CI's own web workspace job needs
# (see .github/workflows/ci.yml).
RUN npm run build -w @sylox/sdk && npm run build -w web/app

EXPOSE 3000
CMD ["npm", "run", "start", "-w", "web/app", "--", "-p", "3000"]
