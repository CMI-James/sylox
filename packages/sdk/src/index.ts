/**
 * @sylox/sdk's single public entry point. Section 19.1:
 *
 * ```ts
 * import { Sylox, Networks } from "@sylox/sdk";
 * const al = new Sylox({ network: Networks.Testnet, signer: walletSigner });
 * ```
 */
export { Sylox, type SyloxOptions } from "./client.js";
export { Networks, type SyloxNetwork, type TestnetDeployment, type TestnetDemoAsset } from "./networks.js";
export { SyloxError } from "./errors.js";
export type { Signer } from "./signer.js";
export { toNumber, usdc } from "./fx.js";
export type { CacheAdapter } from "./events/cache-adapter.js";
export { noopCacheAdapter } from "./events/cache-adapter.js";
export type { OnRestoreNeeded, RestoreNeeded } from "./events/restore.js";
export type { WriteResult, Prepared, PrepareOptions } from "./events/actions.js";
export {
  prepareFinalize,
  confirmFinalize,
  prepareCheckpointCure,
  confirmCheckpointCure,
  prepareProposeTier1,
  confirmProposeTier1,
  prepareChallenge,
  confirmChallenge,
} from "./events/actions.js";
export { Events, type ListEventsOptions, type ListEventsResult } from "./events/list.js";
export { Oracle, type EffectiveRingSlot } from "./oracle.js";
// Gap found while wiring web/app onto this SDK (PR 2 of the SDK
// migration): tokenClient/assetDisplayName are real, finished exports
// of contracts/token.ts (used internally by Oracle/Events's own asset
// name lookups) but were never re-exported here, even though every
// other module this package is meant to replace in web/app IS
// exported. Added here rather than worked around in the app, since
// nothing about token.ts itself changes - this is purely closing an
// oversight in this file's own export list.
export { tokenClient, assetDisplayName } from "./contracts/token.js";
// Same gap, same fix: riskOracleClient/eventRegistryClient
// (contracts/risk-oracle.ts, contracts/event-registry.ts) are real,
// already-used-internally factory functions that were missing from
// this same export list. al.oracle/al.events deliberately don't wrap
// EVERY contract read (asset_config, event_in_progress,
// current_version, definition have no al.* method - see oracle.ts/
// events/list.ts's own "thinner surface" doc comments), so a consumer
// needing one of those specific fields has no way to reach the
// contract at all without these two factories - re-exporting them
// (not adding new al.* wrapper methods, not changing what either
// function does) is the same additive, behavior-free fix as the line
// above.
export { riskOracleClient } from "./contracts/risk-oracle.js";
export { eventRegistryClient } from "./contracts/event-registry.js";

// Re-exported types a consumer needs without reaching into the
// generated bindings' own module paths directly.
export type {
  RiskScore,
  Band,
  SignalSet,
  SlotState,
  SubEpoch,
  RingSlot,
  AssetConfig,
} from "./contracts/risk-oracle.js";
export type {
  EventRecord,
  EventKind,
  EventState,
  EventDefinition,
  CoverGate,
  AssetEventStatus,
  CureProgress,
} from "./contracts/event-registry.js";
