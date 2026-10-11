import { Networks, assetDisplayName, eventRegistryClient, type EventRecord } from "@sylox/sdk";
import { al } from "./sylox-client";

/**
 * This screen's display shaping over `@sylox/sdk`'s own
 * `al.events.list()` (events/list.ts): that SDK method already does
 * the RPC event-log scan + per-id current-state resolution this file
 * used to do itself (STOPGAP reasoning unchanged - see events/list.ts's
 * own top doc comment: EventRegistry doesn't yet expose a direct read
 * listing every event it has ever stored). What's left here is purely
 * this screen's own display shape (`EventListRow`'s `assetCode`/
 * `windowClosesAt`), which the SDK deliberately does NOT produce -
 * `al.events.list()` returns decoded `EventRecord`s as-is, leaving any
 * display reshaping to a UI layer out of its own scope.
 */

export interface EventListRow {
  id: bigint;
  assetCode: string;
  kind: EventRecord["kind"]["tag"];
  state: EventRecord["state"]["tag"];
  proposedAt: bigint;
  /** Seconds remaining in the event's current window, if it's still open - null once Cured/Declared/Rejected. Derived the same way as the Event screen's own countdown (never a RingSlot's pending_until - see lib/event-data.ts). */
  windowClosesAt: bigint | null;
}

export interface EventListResult {
  rows: EventListRow[];
  /** The oldest ledger actually scanned - use this for an honest "Events in the last N days" label, never a fixed 7. */
  oldestLedgerScanned: number;
  latestLedger: number;
  stoppedAtRequestCap: boolean;
}

// ruling_deadline has no al.events wrapper (al.events's own surface is
// event/status/coverGate/list - see events/list.ts's top doc comment) -
// read directly, same pattern as lib/event-data.ts's own fetchCountdown.
function registryContract() {
  return eventRegistryClient(Networks.Testnet);
}

async function windowCloseFor(record: EventRecord): Promise<bigint | null> {
  if (record.state.tag === "Escalated") {
    const tx = await registryContract().ruling_deadline({ event_id: record.id });
    return tx.result ?? null;
  }
  // A Proposed event's own challenge_secs isn't on EventRecord itself
  // (only on its EventDefinition) - the list row only needs "is this
  // still open," which record.state already answers; the Event
  // screen itself (lib/event-data.ts) is where the full countdown,
  // fetched against the specific pinned definition, belongs.
  return null;
}

async function rowFor(record: EventRecord): Promise<EventListRow> {
  const [assetCode, windowClosesAt] = await Promise.all([
    assetDisplayName(Networks.Testnet, record.asset).then((name) => name.split(":")[0] || name),
    windowCloseFor(record),
  ]);

  return {
    id: record.id,
    assetCode,
    kind: record.kind.tag,
    state: record.state.tag,
    proposedAt: record.proposed_at,
    windowClosesAt,
  };
}

export interface ListRegistryEventsOptions {
  /**
   * Called with a newly-resolved row as soon as its display shaping
   * (assetCode/windowClosesAt) has finished for a record `al.events.
   * list()`'s own `onProgress` reported - not batched until the whole
   * scan finishes. Rows arrive in roughly the same newest-first order
   * the underlying ledger scan finds their ids in, but resolution
   * itself isn't strictly serialized against the scan's own chunking,
   * so a later id can occasionally resolve before an earlier one; the
   * final `rows` from the resolved promise is always the complete,
   * correctly-ordered list regardless.
   */
  onRowProgress?: (row: EventListRow) => void;
}

export async function listRegistryEvents(options: ListRegistryEventsOptions = {}): Promise<EventListResult> {
  // Keyed by event id: the SAME in-flight (or settled) promise every
  // caller of resolveFor awaits, so a row started early by onProgress
  // is never re-shaped twice just because that shaping hadn't settled
  // yet when the scan resolved.
  const inFlight = new Map<string, Promise<EventListRow>>();

  const resolveFor = (record: EventRecord): Promise<EventListRow> => {
    const key = record.id.toString();
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = rowFor(record);
    inFlight.set(key, promise);
    return promise;
  };

  const scan = await al.events.list({
    limit: 50,
    onProgress: (record) => {
      if (!options.onRowProgress) return;
      if (inFlight.has(record.id.toString())) return;
      // Fire-and-forget: resolving a row's display shape never blocks
      // the scan itself from walking further chunks, so the newest
      // rows a visitor can already see don't wait on an older, still-
      // in-flight one. A failed read here is never fatal - the final
      // Promise.all below awaits this SAME promise and correctly
      // surfaces a real rejection there, so this only needs to avoid
      // an unhandled rejection, not report the error itself.
      void resolveFor(record)
        .then((row) => options.onRowProgress?.(row))
        .catch(() => {});
    },
  });

  const rows = await Promise.all(scan.events.map((record) => resolveFor(record)));

  return {
    rows,
    oldestLedgerScanned: scan.oldestLedgerScanned,
    latestLedger: scan.latestLedger,
    stoppedAtRequestCap: scan.stoppedAtRequestCap,
  };
}
