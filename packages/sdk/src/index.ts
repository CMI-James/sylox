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
