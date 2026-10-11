# Sylox App

The app people use to see an issuer's risk, provide cover, buy cover, and claim. Talks to the Soroban contracts through `@sylox/sdk` (`packages/sdk`), a framework-free package wrapping the generated TypeScript bindings. No backend.

## Running it

From the repo root (this is an npm workspace member, not a standalone project):

```bash
npm install
npm run dev -w web/app
```

## Contract bindings

This app no longer generates or holds its own copy of the contract bindings. Every contract read and write goes through `@sylox/sdk` (`packages/sdk`), a framework-free package built specifically so this app (and any other future Sylox client) doesn't duplicate that code - `al.oracle`/`al.events` for the common reads, `riskOracleClient`/`eventRegistryClient`/`tokenClient` (re-exported from `@sylox/sdk`'s own top level) for the handful of contract reads that don't have a dedicated wrapper yet, and the standalone `prepareFinalize`/`confirmFinalize`/`prepareCheckpointCure`/`confirmCheckpointCure`/`prepareProposeTier1`/`confirmProposeTier1`/`prepareChallenge`/`confirmChallenge` functions for writes.

Bindings generation itself - `stellar-js generate` (the TypeScript bindings generator bundled inside `@stellar/stellar-sdk` since 17.2.0; the `stellar` CLI's own native `contract bindings typescript` command is a separate, now-deprecated thing that only ever emits SDK-`^16.0.1`-shaped bindings) - now lives in `packages/sdk/scripts/generate-bindings.mjs`, run via `npm run bindings:generate -w packages/sdk` after a testnet redeploy. `web/app/package.json` has no `bindings:generate` script any more; this app only ever consumes `@sylox/sdk`'s already-built output.

The network this app points at (RPC URL, passphrase, both contract ids, the demo asset) comes from `@sylox/sdk`'s own `Networks.Testnet`, itself generated at the SDK's build time from the repo's `deployments/testnet.json`/`deployments/testnet-demo-asset.json`. No contract address is ever written as a literal in app code, so a testnet redeploy (new contract IDs, followed by rebuilding `@sylox/sdk`) is a non-event for the app.

### Write-path smoke test (manual, not part of CI)

`npm run smoke:write-path -w web/app` builds and simulates (never signs or sends) `finalize` and `checkpoint_cure` against a real event on live testnet, proving `@sylox/sdk`'s own request/response/error-decode pipeline actually works end to end under the currently pinned SDK - something no mocked test can catch if a future SDK bump silently changes the wire shape. Not run by default (`npm test`) or in CI: it depends on live testnet RPC being reachable and responsive, which unrelated PRs' CI runs shouldn't be held hostage to. **Run it by hand before merging any PR that touches how this app calls `@sylox/sdk`'s write functions, or `packages/sdk` itself**, and paste its output in that PR.

## Screens

- **Explorer** (`/`): every tracked asset, its current risk band, score, staleness, and event status, read live from RiskOracle. Done.
- **Asset** (`/asset/[id]`): header, Confirmed/Live peg price, peg history chart, failure definitions, cover-sale status, active-event indicator (links to each event the asset currently has in progress). Done.
- **Event** (`/event/[id]`): proposal details, a countdown to the real challenge/ruling deadline, Depeg cure progress, and the Checkpoint/Finalize write actions. The first screen that writes to the contracts - see "Wallet" below.
- **Events** (`/events`): every proposed event read from EventRegistry, newest first, each linking to its Event screen - see "RPC getEvents pagination" below for how this actually finds them.
- Markets, Faucet: not built yet.

## Navigation

Every screen is wrapped in `components/DashboardShell.tsx`: a persistent sidebar (Explorer, Events, plus "Soon"-tagged placeholders for Markets/My positions/Faucet, and an External section linking the website, docs, and this repo) and a top bar (page title, a fixed Testnet badge, Connect Wallet). On narrow widths the sidebar collapses into a menu button that opens a drawer, with the same focus-trap/Escape handling as `WalletPickerModal`. Explorer, Asset, Event, and Events all stay fully readable with no wallet connected - the shell never gates them behind a "Connect your wallet" screen; only an actual write action (Checkpoint, Finalize) prompts for a connection when clicked, same as before the shell existed. A future screen showing the visitor's own data (My positions) is the first candidate for an actual wallet-gated empty state, once it's built.

## Wallet

The Event screen is the first to write to the contracts, so it's the first to need a connected wallet. Stellar Wallets Kit (`lib/wallet/kit.ts`) provides the actual wallet connections (Freighter, xBull, Albedo - each imported by its own subpath, not `defaultModules()`, which pulls in every "no extra config" module the kit ships), used strictly for its headless SDK - the kit's own built-in modal is never shown. The picker UI itself (`@sylox/ui`'s `WalletPickerModal`) is the shared design system's own component, driven by plain props; `web/shared/ui` never imports the kit.

The kit is loaded with a dynamic `import()` only when the picker actually opens (`lib/wallet/kit.ts`), not on every page load, so its bundle never ships to a visitor who never connects a wallet.

**SDK version boundary:** the kit bundles its own `@stellar/stellar-sdk` (17.2.1), the exact same version `@sylox/sdk` itself pins as a peer dependency - `npm ls @stellar/stellar-sdk` shows one deduped copy across the whole workspace. Only plain XDR strings cross between the kit and `@sylox/sdk`'s own write functions (`prepareFinalize`/`confirmFinalize`/`prepareCheckpointCure`/`confirmCheckpointCure`, called from `app/event/[id]/EventPageClient.tsx`) - never a `Transaction` or other SDK object, since those can in principle fail type checks across versions even when TypeScript compiles cleanly. This app itself has no direct `@stellar/stellar-sdk` dependency any more; everything that needs it goes through `@sylox/sdk` or the wallet kit.

**Dev-only fixtures:** `/event/fixture-proposed`, `-challenged`, `-cured`, `-declared` render from typed mock data (`lib/event-fixtures.ts`) instead of the live contract, so the screen's layout/countdown/buttons can be checked without a real event on testnet. Loaded only through a dynamic `import()` gated on `process.env.NODE_ENV !== "production"`, so the whole module - and every string in it - is stripped out of a production build, not just hidden behind a runtime check (verified by grepping the production bundle). A fixture id in a production build falls through to the live fetch and 404s on it like any other invalid id; a real numeric `event_id` always uses the live contract read, in every environment.

## RPC getEvents pagination

The actual `getEvents` scanning/chunking/caching logic - backward chunking, the `endLedger`-exclusive and ~10,000-ledger-per-request RPC quirks, the floor-margin/bounded-retry handling, the incremental cache - now lives entirely inside `@sylox/sdk` (`packages/sdk/src/events/rpc-scan.ts` + `chunk-plan.ts`, used by `al.events.list()`), not in this app. See that package's own doc comments for the full design writeup; it's ported near-verbatim from this app's own former `lib/stellar-rpc-events.ts`/`lib/chunk-plan.ts`, just with the sessionStorage mirroring pulled out behind an injectable `CacheAdapter` (see next paragraph) since the SDK itself has no DOM/browser API available at import time.

**This app's own piece is just the cache adapter and the display shaping.** `lib/sylox-cache-adapter.ts` is a small `CacheAdapter` implementation (`get`/`set` over plain strings, wrapped in `try`/`catch` so a missing/full/unavailable `sessionStorage` is never a hard failure) wired into the shared `Sylox` instance in `lib/sylox-client.ts`. `lib/events-list-data.ts`'s `listRegistryEvents()` calls `al.events.list()` and reshapes each decoded `EventRecord` into this screen's own `EventListRow` display shape (`assetCode`, `windowClosesAt`) - the RPC scan and its cache are entirely the SDK's concern now.

The Events screen's "Events in the last N days" label is still worked out from the ledger range `al.events.list()` reports it actually covered (`oldestLedgerScanned`), never a fixed 7 - a scan that stops before reaching the floor says so explicitly (`stoppedAtRequestCap`), rather than reading as if the full claimed window was checked when it wasn't.

**Still a stopgap, not the long-term design.** `EventRegistry` doesn't yet expose a direct read listing every event it has ever stored - `al.events.list()` scans the `event_proposed` log entry for each event's id, then reads its *current* state with `event(event_id)` (the log entry itself is frozen at proposal time). Once a direct enumeration read exists on the contract, swapping it in is meant to be a one-function change inside the SDK's `Events` class, not a rewrite of either the SDK or this screen. The `getEvents` scan itself stays the right mechanism for a genuine activity feed (e.g. `signals_posted`), which has no other direct read.

## Deployment

Served from Railway as its own service, separate from the `web/landing` service - `web/app` needs a live `next start` process (dynamic server-streamed content on `/asset/[id]`), not a static export.

Built from `web/app/Dockerfile`, not Railpack. Railpack's own build-plan resolution in this monorepo consistently ran `web/landing`'s `package.json` scripts regardless of this service's dashboard-configured custom build/start commands - reproduced across three separate Railway services/projects, with the repo-root `railpack.json` (needed so Railpack detects Node rather than Rust at the repo root - see its own commit history) logged as the authoritative config source each time, overriding the dashboard's build command specifically. A Dockerfile has no auto-detection step to get wrong: `docker build -f web/app/Dockerfile .` from the repo root runs exactly `npm install`, `npm run build -w web/app`, then (on container start) `next start -w web/app -- -p 3000` - nothing else. The service's build/start commands and root directory are set directly in the Railway dashboard, not config-as-code (a `web/app/railway.json` from that earlier attempt has since been deleted).

**Port.** The container always listens on 3000 (`EXPOSE 3000` + a hardcoded `-p 3000` in the Dockerfile's `CMD`, not Railway's `$PORT`) - an earlier attempt that read `$PORT` as a literal shell variable crash-looped, because the dashboard's leftover custom Start Command was overriding the Dockerfile's `CMD` without going through a shell that would expand it. Railway routes to the container by the custom domain's own **target port**, set to `3000` when `app.sylox.xyz` was attached (`railway domain app.sylox.xyz --port 3000`), not via a `PORT` environment variable - the service has no `PORT` variable set at all. If the Dockerfile's listen port ever changes, the domain's target port (Settings → Networking → the domain's own port field) has to change with it, or the site silently stops routing.

The build needs the whole monorepo (repo root, not `web/app/` alone) in its Docker build context, since `web/app` depends on the `web/shared/ui` workspace member for npm's workspace resolution to find it.

**Environment variables:** just `NODE_ENV=production`, set explicitly on the service - no `PORT` variable (see "Port" above: routing uses the domain's own target port, not `$PORT`). The app has no server-side secrets, API keys, or other runtime config - every contract address it reads comes from the committed `deployments/testnet.json`, and all RPC calls go straight from the browser to the public Soroban RPC endpoint (see "No backend" above).

Checked `railway variables --service sylox-app` directly (names only, no values, since this is the whole point of checking): `NODE_ENV` plus Railway's own auto-injected `RAILWAY_ENVIRONMENT`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_PRIVATE_DOMAIN`, `RAILWAY_PROJECT_ID`, `RAILWAY_PROJECT_NAME`, `RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_SERVICE_ID`, `RAILWAY_SERVICE_NAME`, `RAILWAY_SERVICE_SYLOX_APP_URL`, `RAILWAY_STATIC_URL`. Notably **no `RAILWAY_DOCKERFILE_PATH`** - this service points `railway up` at `web/app/Dockerfile` via a dashboard-level Build setting (Settings → Build → Dockerfile Path), not that environment variable, which is why this file's own first paragraph above already says the build/start config is dashboard-set, not config-as-code. Documented here, in the one place this project writes down what's actually configured on this service, since it wasn't written down anywhere else (see `deploy/README.md`'s own `sylox-live-poster` section, which DOES use `RAILWAY_DOCKERFILE_PATH` as a real variable - the two services use two different mechanisms to the same end, worth knowing if comparing them).

**Deploys via GitHub Actions, not Railway's own auto-deploy.** Railway's watch-path evaluation has been observed skipping deploys that genuinely touched a watched path - confirmed on a real push to `main` (a merge that changed `web/app/components/WalletButton.tsx`, squarely inside the then-watched `/web/app/**` pattern, logged `skippedReason: "No changes to watched files"`) - and, separately, skipping *every* direct `railway up` upload outright regardless of what changed: an upload carries no changed-files list for Railway to diff against, so with any watch paths set at all it always concludes nothing matched. Reported to Railway support.

**`sylox-app`'s Railway watch paths must stay empty.** That's the actual fix on our side, independent of whatever Railway's own investigation finds - with them cleared, Railway never runs its own (buggy) skip check against this service, full stop. Don't re-add them. `.github/workflows/ci.yml`'s `deploy-sylox-app` job does the path filtering instead: it runs after every other CI job passes on a push to `main`, diffs the whole push (`github.event.before..github.sha`, not just the latest commit) against `web/app/**`, `web/shared/**`, `deployments/**`, `package.json`, `package-lock.json`, and only then deploys with a pinned Railway CLI version (`npm install -g @railway/cli@5.64.2` - the same version this workflow was built and tested against; bump deliberately, not via `@latest`). `sylox-app`'s own Railway auto-deploy is turned off once this workflow has deployed successfully at least once. `web/landing` is unaffected: it keeps its own watch paths and its existing Railway auto-deploy, which has been reliable.

## Rules this app follows

- **Contract reads only, never recomputed.** Staleness, band, and score all come from the contract's own `check_stale`/`band`/`score` calls. The app never re-derives these from raw epoch/timestamp math, because the contract's actual staleness threshold isn't even exposed as a public read (see `lib/explorer-data.ts`'s doc comments).
- **Testnet labeled everywhere.** `components/TestnetBanner.tsx` renders on every page.
- **No marketing claims.** No "insured," no "guaranteed returns," no APY, the word "insurance" never appears.
- **Every write is simulated before it's signed.** A contract method that changes state is always constructed (which auto-simulates) first; its result is shown in plain words before the wallet is ever asked to sign anything (`@sylox/sdk`'s `prepare*`/`confirm*` split, called from `components/WriteActionButton.tsx` and `app/event/[id]/EventPageClient.tsx`).
