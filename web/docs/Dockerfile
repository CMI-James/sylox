# A separate Dockerfile for this service - not Railpack (see railpack.json
# at the repo root) - same reasoning as web/app/Dockerfile's own header:
# Railpack's own build-plan resolution in this monorepo consistently built
# web/landing's package.json scripts regardless of a service's own
# dashboard-configured build/start commands (observed across three
# different Railway projects/services). A Dockerfile has no auto-detection
# step to get wrong: it runs exactly the commands below.
FROM node:24-slim

WORKDIR /app

# The whole monorepo, not just web/docs - npm workspace resolution needs
# every workspace's package.json (and the root lockfile) present, even
# ones this service doesn't itself depend on (same list web/app/Dockerfile
# copies, for the same reason - see its own comment here).
COPY package.json package-lock.json ./
COPY web/app/package.json web/app/package.json
COPY web/landing/package.json web/landing/package.json
COPY web/shared/ui/package.json web/shared/ui/package.json
COPY web/docs/package.json web/docs/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/sdk/src/contracts/event-registry/package.json packages/sdk/src/contracts/event-registry/package.json
COPY packages/sdk/src/contracts/risk-oracle/package.json packages/sdk/src/contracts/risk-oracle/package.json
COPY packages/sdk/src/contracts/token/package.json packages/sdk/src/contracts/token/package.json

RUN npm install

COPY . .

ENV NODE_ENV=production
# web/docs's own build needs @sylox/sdk's compiled dist/ output (its
# package.json points "types"/"main" there, not raw src/) - both because
# web/docs imports @sylox/sdk directly and because
# scripts/generate-contract-reference.mjs reads the SDK's own contract
# bindings/error-map source files at build time (via this package's own
# prebuild npm lifecycle hook, not a direct @sylox/sdk import, but the
# ordering still has to be SDK-built-before-docs-built the same way
# web/app's build does) - same ordering CI's own web/docs workspace job
# needs (see .github/workflows/ci.yml).
RUN npm run build -w @sylox/sdk && npm run build -w web/docs

EXPOSE 3000
CMD ["npm", "run", "start", "-w", "web/docs", "--", "-p", "3000"]
