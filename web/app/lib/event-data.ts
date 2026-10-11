import { Networks, assetDisplayName, eventRegistryClient, type EventRecord, type CureProgress, type EventDefinition } from "@sylox/sdk";
import { al } from "./sylox-client";
import { sentenceFor } from "./asset-data";

// EventRegistry.definition has no al.events wrapper (al.events's own
// surface is event/status/coverGate/list - see events/list.ts's top
// doc comment) - read directly, same pattern as asset-data.ts's own
// fetchOneDefinition.
function registryContract() {
  return eventRegistryClient(Networks.Testnet);
}

/** A Result<T, {message}> from a generated client, normalized to a plain outcome - same shape as asset-data.ts's SectionResult, kept local since this module has its own independent sections. */
type SectionResult<T> = { status: "ok"; value: T } | { status: "error"; message: string };

function ok<T>(value: T): SectionResult<T> {
  return { status: "ok", value };
}

function err<T>(e: unknown): SectionResult<T> {
  return { status: "error", message: e instanceof Error ? e.message : String(e) };
}

async function section<T>(fn: () => Promise<T>): Promise<SectionResult<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e);
  }
}

// ---------------------------------------------------------------------------
// 1. The proposal itself
// ---------------------------------------------------------------------------

export interface EventProposal {
  record: EventRecord;
  assetCode: string;
  /** The plain-language sentence for the specific definition version this event was checked against - never the canonical one, which can have moved on since. */
  definitionSentence: string;
}

async function fetchEventRecord(eventId: bigint): Promise<EventRecord> {
  const record = await al.events.event(eventId);
  if (!record) throw new Error(`No event found with id ${eventId}.`);
  return record;
}

async function fetchDefinitionByVersion(
  asset: string,
  kind: EventRecord["kind"],
  version: number,
): Promise<EventDefinition> {
  const tx = await registryContract().definition({ asset, kind, version });
  const def = tx.result;
  if (!def) {
    throw new Error(`No definition found for this event's pinned version (${version}).`);
  }
  return def;
}

async function fetchProposal(eventId: bigint): Promise<{ proposal: EventProposal; def: EventDefinition }> {
  const record = await fetchEventRecord(eventId);
  const [assetCode, def] = await Promise.all([
    assetDisplayName(Networks.Testnet, record.asset).then((name) => name.split(":")[0] || name),
    fetchDefinitionByVersion(record.asset, record.kind, record.def_version),
  ]);

  return {
    proposal: {
      record,
      assetCode,
      definitionSentence: sentenceFor(record.kind.tag, def),
    },
    def,
  };
}

// ---------------------------------------------------------------------------
// 2. Challenge-window / ruling countdown
// ---------------------------------------------------------------------------

export type CountdownPhase =
  | { phase: "challenge"; deadline: bigint }
  | { phase: "ruling"; deadline: bigint }
  | { phase: "closed" };

/**
 * The real deadline for whatever window the event is currently in -
 * never derived from a RingSlot's pending_until, which belongs to the
 * oracle's own hourly signal lifecycle (Section 5.7), a different
 * clock from the event's own challenge/ruling windows (Section 8.1,
 * 8.3). While Proposed: record.proposed_at + def.challenge_secs,
 * exactly the deadline finalize() itself checks against
 * (ChallengeWindowOpen). While Escalated: the contract's own
 * ruling_deadline(event_id) read (escalated_at + ruling_deadline_secs,
 * lib.rs), never recomputed client-side from escalated_at + a locally
 * held challenge_secs/ruling_deadline_secs that could drift from what
 * the contract actually used if the definition was later superseded.
 * No dedicated al.events wrapper for ruling_deadline either - read
 * directly, same as definition() above.
 */
async function fetchCountdown(eventId: bigint, record: EventRecord, def: EventDefinition): Promise<CountdownPhase> {
  if (record.state.tag === "Proposed") {
    return { phase: "challenge", deadline: record.proposed_at + def.challenge_secs };
  }
  if (record.state.tag === "Escalated") {
    const tx = await registryContract().ruling_deadline({ event_id: eventId });
    const deadline = tx.result;
    if (deadline === undefined || deadline === null) {
      throw new Error("Event is Escalated but the contract has no ruling deadline for it.");
    }
    return { phase: "ruling", deadline };
  }
  return { phase: "closed" };
}

// ---------------------------------------------------------------------------
// 3. Cure progress
// ---------------------------------------------------------------------------

/**
 * checkpoint_cure is permissionless and idempotent (lib.rs's own doc
 * comment), and every generated client method auto-simulates on
 * construction - reading its simulated .result here shows the
 * contract's own current cure-progress record without submitting
 * anything. A real Checkpoint click still calls signAndSend() on this
 * same AssembledTransaction (via @sylox/sdk's own prepareCheckpointCure/
 * confirmCheckpointCure); this fetch is a read, not a hidden write.
 */
async function fetchCureProgress(eventId: bigint): Promise<CureProgress | null> {
  const tx = await registryContract().checkpoint_cure({ event_id: eventId });
  const result = tx.result;
  if (result.isErr()) {
    // WrongState (not Proposed/not a Depeg event) isn't a real error to
    // surface - cure progress simply doesn't apply to this event.
    return null;
  }
  return result.unwrap();
}

// ---------------------------------------------------------------------------
// Assembled page data - every section independently failable, matching
// the Asset screen's pattern (lib/asset-data.ts).
// ---------------------------------------------------------------------------

export interface EventPageData {
  proposal: SectionResult<EventProposal>;
  countdown: SectionResult<CountdownPhase>;
  cureProgress: SectionResult<CureProgress | null>;
}

export async function fetchEventPageData(eventId: bigint): Promise<EventPageData> {
  // The record is fetched once, up front, and reused - every other
  // section needs it (kind/asset/state for the countdown and cure
  // progress), and an event's record is immutable in the fields those
  // sections read (id, asset, kind, def_version never change after
  // proposal), so re-fetching it per section would only be extra RPC
  // round trips for identical data, not independent freshness.
  let shared: { proposal: EventProposal; def: EventDefinition } | null = null;
  try {
    shared = await fetchProposal(eventId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      proposal: err(message),
      countdown: err("Could not load the event record."),
      cureProgress: err("Could not load the event record."),
    };
  }

  const [countdown, cureProgress] = await Promise.all([
    section(() => fetchCountdown(eventId, shared!.proposal.record, shared!.def)),
    section(() => fetchCureProgress(eventId)),
  ]);

  return { proposal: ok(shared.proposal), countdown, cureProgress };
}
