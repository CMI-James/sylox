import { scValToNative, nativeToScVal } from "@stellar/stellar-sdk";
import { eventRegistryClient } from "../contracts/event-registry.js";
import type { EventRecord, EventKind, AssetEventStatus, CoverGate } from "../contracts/event-registry.js";
import { coverGateError, extractErrorCode } from "../errors.js";
import type { SyloxNetwork } from "../networks.js";
import { EventsScanner, type EventRecordRaw } from "./rpc-scan.js";
import type { CacheAdapter } from "./cache-adapter.js";

/**
 * `al.events`'s read surface: `event(id)`, `status(asset, kind)`,
 * `coverGate(asset)`, and `list()`. `list()` is built THINNER than
 * web/app/lib/events-list-data.ts's own `listRegistryEvents` (ported
 * from, not copied) - that function returns `EventListRow`, a display
 * shape with `assetCode`/`windowClosesAt` UI fields. This returns
 * decoded `EventRecord`s as-is (the contract's own current state for
 * each id), leaving any display shaping to a UI layer out of this
 * PR's scope.
 *
 * STOPGAP (same as the source file): EventRegistry doesn't yet expose
 * a direct read listing every event it has ever stored, so this scans
 * the RPC's own event log (event_proposed) for event ids, then reads
 * each one's CURRENT state with `event(event_id)` - the log entry
 * itself is frozen at proposal time, never updated as an event moves
 * through Challenged/Escalated/Cured/Declared/Rejected.
 */

function topicXdr(symbol: string): string {
  return nativeToScVal(symbol, { type: "symbol" }).toXDR("base64");
}

interface DecodedEventProposed {
  event_id: bigint;
}

function eventIdFor(raw: EventRecordRaw): bigint {
  const decoded = scValToNative(raw.value as never) as DecodedEventProposed;
  return decoded.event_id;
}

export interface ListEventsOptions {
  /** Stop once this many events have been found, newest-first. Defaults to 50, matching events-list-data.ts's own default. */
  limit?: number;
  /** Called with each newly-resolved EventRecord as the backward scan progresses - lets a caller render partial results instead of waiting for the whole scan. Rows arrive in roughly newest-first order but resolution isn't strictly serialized against the scan's own chunking, so a later id can occasionally resolve before an earlier one; the final `events` array is always the complete, correctly-ordered list regardless. */
  onProgress?: (newlyResolved: EventRecord) => void;
}

export interface ListEventsResult {
  /** Newest-first, by proposal ledger. */
  events: EventRecord[];
  /** The oldest ledger actually scanned - use this for an honest "events in the last N days" label, never a fixed number. */
  oldestLedgerScanned: number;
  latestLedger: number;
  stoppedAtRequestCap: boolean;
}

export class Events {
  private readonly scanner: EventsScanner;

  constructor(
    protected readonly network: SyloxNetwork,
    cacheAdapter?: CacheAdapter,
  ) {
    // networkPassphrase as the cache namespace (in place of the source
    // file's own `testnetDeployment.network` string, e.g. "testnet") -
    // equally unique per network and already part of SyloxNetwork, so
    // no new field needed on that interface just for this.
    this.scanner = new EventsScanner(network.rpcUrl, network.networkPassphrase, cacheAdapter);
  }

  /** Wraps EventRegistry.event(event_id). `null` when no such event exists. */
  async event(eventId: bigint): Promise<EventRecord | null> {
    const tx = await eventRegistryClient(this.network).event({ event_id: eventId });
    return tx.result ?? null;
  }

  /** Per (asset, kind): wraps EventRegistry.event_status. */
  async status(asset: string, kind: EventKind["tag"]): Promise<AssetEventStatus> {
    const tx = await eventRegistryClient(this.network).event_status({
      asset,
      kind: { tag: kind, values: undefined },
    });
    return tx.result;
  }

  /** Wraps EventRegistry.cover_gate, decoded through SyloxError same as every other Result-returning read in this SDK. */
  async coverGate(asset: string): Promise<CoverGate> {
    const tx = await eventRegistryClient(this.network).cover_gate({ asset });
    const result = tx.result;
    if (result.isErr()) {
      throw coverGateError(extractErrorCode(tx));
    }
    return result.unwrap();
  }

  /**
   * Scans the RPC's event log for `event_proposed` ids, then reads
   * each one's current state. Returns decoded EventRecords, newest
   * first - never a display-shaped row (see this module's own top doc
   * comment).
   */
  async list(options: ListEventsOptions = {}): Promise<ListEventsResult> {
    const limit = options.limit ?? 50;
    const registry = eventRegistryClient(this.network);

    // Keyed by event id: the SAME in-flight (or settled) promise every
    // caller of resolveFor awaits, so a row started early by the
    // onProgress callback is never re-fetched by the final batch just
    // because that fetch hadn't settled yet when the scan resolved.
    const inFlight = new Map<string, Promise<EventRecord | null>>();

    const resolveFor = (id: bigint): Promise<EventRecord | null> => {
      const key = id.toString();
      const existing = inFlight.get(key);
      if (existing) return existing;
      const promise = registry.event({ event_id: id }).then((tx) => tx.result ?? null);
      inFlight.set(key, promise);
      return promise;
    };

    const resolveNewIds = (raws: EventRecordRaw[]): void => {
      if (!options.onProgress) return;
      for (const raw of raws) {
        const id = eventIdFor(raw);
        if (inFlight.has(id.toString())) continue;
        // Fire-and-forget: resolving a row never blocks the scan
        // itself from walking further chunks. A failed read here is
        // never fatal - the final Promise.all below awaits this SAME
        // promise and correctly surfaces a real rejection there.
        void resolveFor(id)
          .then((record) => {
            if (record !== null) options.onProgress?.(record);
          })
          .catch(() => {});
      }
    };

    const scan = await this.scanner.fetchEventsPaginated(
      {
        contractId: this.network.contracts.eventRegistry,
        topics: [topicXdr("sylox"), topicXdr("event_proposed"), "*"],
        limit,
      },
      { onProgress: resolveNewIds },
    );

    const eventIds = scan.events.map(eventIdFor);
    const events = (await Promise.all(eventIds.map((id) => resolveFor(id)))).filter(
      (r): r is EventRecord => r !== null,
    );

    return {
      events,
      oldestLedgerScanned: scan.oldestLedgerScanned,
      latestLedger: scan.latestLedger,
      stoppedAtRequestCap: scan.stoppedAtRequestCap,
    };
  }
}
