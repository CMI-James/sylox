import type { SyloxNetwork } from "./networks.js";
import type { Signer } from "./signer.js";
import type { CacheAdapter } from "./events/cache-adapter.js";
import { Oracle } from "./oracle.js";
import { Events } from "./events/list.js";
import {
  prepareFinalize,
  confirmFinalize,
  prepareCheckpointCure,
  confirmCheckpointCure,
  prepareProposeTier1,
  confirmProposeTier1,
  prepareChallenge,
  confirmChallenge,
  type Prepared,
  type WriteResult,
  type PrepareOptions,
} from "./events/actions.js";
import type { CureProgress, EventKind } from "./contracts/event-registry.js";

export interface SyloxOptions {
  /** rpcUrl, passphrase and contract ids preset - e.g. `Networks.Testnet`. */
  network: SyloxNetwork;
  /** signTransaction adapter (e.g. Stellar Wallets Kit via WalletContext). Required for any write call (events.proposeTier1, events.challenge, events.prepareFinalize/prepareCheckpointCure's confirm step); omit entirely for a read-only consumer. */
  signer?: Signer;
  /** Optional cache adapter for events.list()'s RPC-scan cache (defaults to an in-memory-only no-op - see events/cache-adapter.ts). */
  cacheAdapter?: CacheAdapter;
}

/**
 * The SDK's single entry point (Section 19.1: `new Sylox({ network,
 * signer })`). Exposes `al.oracle` and `al.events` (this PR's scope -
 * `al.markets`/`al.staking`/`al.treasury` are deliberately NOT built,
 * see this PR's description). `al.fx` and `Networks`/`SyloxError` are
 * separate top-level exports (fx.ts, networks.ts, errors.ts) rather
 * than instance members, matching Section 19's own `al.fx.toNumber(...)`
 * usage alongside `al.oracle`/`al.events` - `al.fx` needs no network or
 * signer, so it's exported as plain functions a consumer can also use
 * without constructing a Sylox instance at all.
 *
 * `al.stream` (Section 19.2's `onBandChanged`) is explicitly deferred -
 * see this PR's description's deviations section.
 */
export class Sylox {
  readonly network: SyloxNetwork;
  readonly oracle: Oracle;
  readonly events: EventsNamespace;

  private readonly signer?: Signer;

  constructor(options: SyloxOptions) {
    this.network = options.network;
    this.signer = options.signer;
    this.oracle = new Oracle(options.network);
    this.events = new EventsNamespace(options.network, this.signer, options.cacheAdapter);
  }
}

/**
 * `al.events` - reads (event/status/coverGate/list, delegated to
 * events/list.ts's Events class) plus writes (proposeTier1/challenge/
 * finalize/checkpointCure, each a prepare+confirm pair per Section
 * 19.7's "every write is simulated first" guarantee). Writes bundle
 * the signer that was passed to `new Sylox(...)` so a caller doesn't
 * have to thread it through every call manually - `confirm*` still
 * takes it explicitly too (matching actions.ts's own exported
 * functions), for a caller that wants to swap signers between prepare
 * and confirm (e.g. a UI that lets the visitor reconnect a different
 * wallet mid-flow); the instance-bundled signer is just this
 * namespace's own convenience default.
 */
class EventsNamespace extends Events {
  constructor(
    network: SyloxNetwork,
    private readonly defaultSigner: Signer | undefined,
    cacheAdapter?: CacheAdapter,
  ) {
    super(network, cacheAdapter);
  }

  private requireSigner(action: string): Signer {
    if (!this.defaultSigner) {
      throw new Error(
        `${action} requires a signer. Pass { signer } to new Sylox({ network, signer }), or use the prepare*/confirm* functions from "@sylox/sdk" directly with an explicit signer.`,
      );
    }
    return this.defaultSigner;
  }

  /** Section 19.6: `al.events.proposeTier1(arsSac, "Depeg")` - uses the canonical Depeg definition, prepares, simulates, and signs+sends in one call via the instance's own signer. */
  async proposeTier1(asset: string, kind: EventKind["tag"], options: PrepareOptions = {}): Promise<WriteResult<bigint>> {
    const signer = this.requireSigner("proposeTier1");
    const prepared = await prepareProposeTier1(this.network, asset, kind, signer.publicKey, options);
    return confirmProposeTier1(prepared, signer);
  }

  /** Section 19.6: `al.events.challenge(eventId, evidenceHash)` - bond locked in Staking, escalates at once. */
  async challenge(eventId: bigint, evidenceHash: Uint8Array, options: PrepareOptions = {}): Promise<WriteResult<void>> {
    const signer = this.requireSigner("challenge");
    const prepared = await prepareChallenge(this.network, eventId, evidenceHash, signer.publicKey, options);
    return confirmChallenge(prepared, signer);
  }

  /** Simulates and, if it would succeed, signs+sends `finalize(eventId)` via the instance's own signer. Throws SyloxError (never signing) if simulation would fail. */
  async finalize(eventId: bigint, options: PrepareOptions = {}): Promise<WriteResult<void>> {
    const signer = this.requireSigner("finalize");
    const prepared = await prepareFinalize(this.network, eventId, signer.publicKey, options);
    return confirmFinalize(prepared, signer);
  }

  /** Simulates and, if it would succeed, signs+sends `checkpoint_cure(eventId)` via the instance's own signer. */
  async checkpointCure(eventId: bigint, options: PrepareOptions = {}): Promise<WriteResult<CureProgress>> {
    const signer = this.requireSigner("checkpointCure");
    const prepared = await prepareCheckpointCure(this.network, eventId, signer.publicKey, options);
    return confirmCheckpointCure(prepared, signer);
  }
}

export type { Prepared, WriteResult, PrepareOptions };
