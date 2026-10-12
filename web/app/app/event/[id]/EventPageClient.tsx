"use client";

import { useEffect, useState } from "react";
import { Eyebrow, Card } from "@sylox/ui/components";
import { TestnetBanner } from "@/components/TestnetBanner";
import { Countdown } from "@/components/Countdown";
import { WriteActionButton } from "@/components/WriteActionButton";
import { DashboardShell } from "@/components/DashboardShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { fetchEventPageData, type EventPageData } from "@/lib/event-data";
import { Networks, prepareCheckpointCure, confirmCheckpointCure, prepareFinalize, confirmFinalize } from "@sylox/sdk";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: EventPageData };

const FIXTURE_IDS = new Set(["fixture-proposed", "fixture-challenged", "fixture-cured", "fixture-declared"]);

export async function loadData(eventId: string): Promise<EventPageData> {
  // DEV-ONLY: a fixture route never reaches the live contract fetch,
  // and the whole fixture module (lib/event-fixtures.ts) is pulled in
  // ONLY through this dynamic import, inside this dev-only branch -
  // that's what lets a production build's bundler strip the module
  // out entirely rather than merely hide it behind a runtime check.
  // In a production build (NODE_ENV === "production"), a fixture id
  // falls straight through to the real fetch below, which 404s on it
  // exactly like any other nonexistent numeric event_id would.
  if (process.env.NODE_ENV !== "production" && FIXTURE_IDS.has(eventId)) {
    const { EVENT_FIXTURES } = await import("@/lib/event-fixtures");
    return EVENT_FIXTURES[eventId];
  }

  let parsed: bigint;
  try {
    parsed = BigInt(eventId);
  } catch {
    throw new Error(`"${eventId}" isn't a valid event id.`);
  }
  return fetchEventPageData(parsed);
}

export function EventPageClient({ eventId }: { eventId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Bumped after every successful write (Checkpoint/Finalize) to
  // re-run the effect below and refetch this event's own data - a
  // write changes the contract's state (the whole point of signing
  // it), so the page must reflect that on its own rather than leaving
  // the PROPOSED badge sitting there until a manual reload.
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadData(eventId)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, refetchToken]);

  const handleActionSuccess = () => setRefetchToken((t) => t + 1);

  const assetAddress = state.status === "ready" && state.data.proposal.status === "ok"
    ? state.data.proposal.value.record.asset
    : null;
  const assetCode = state.status === "ready" && state.data.proposal.status === "ok"
    ? state.data.proposal.value.assetCode
    : null;

  return (
    <DashboardShell title="Event">
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16 md:px-16 md:py-24">
        <TestnetBanner />

        <div className="mt-6">
          <Breadcrumb
            items={[
              { label: "Explorer", href: "/" },
              { label: "Events", href: "/events" },
              ...(assetAddress ? [{ label: assetCode ?? "Asset", href: `/asset/${assetAddress}` }] : []),
              { label: `Event #${eventId}` },
            ]}
          />
        </div>

        {state.status === "loading" && (
          <p className="mt-8 font-mono text-sm text-cyber-tin" role="status">
            Loading event from the registry…
          </p>
        )}

        {state.status === "error" && (
          <p className="mt-8 font-mono text-sm text-risk-crimson" role="alert">
            Could not load this event: {state.message}
          </p>
        )}

        {state.status === "ready" && (
          <EventSections eventId={eventId} data={state.data} onActionSuccess={handleActionSuccess} />
        )}
      </main>
    </DashboardShell>
  );
}

function SectionError({ message }: { message: string }) {
  return (
    <p className="font-mono text-sm text-risk-crimson" role="alert">
      Couldn&apos;t load this section: {message}
    </p>
  );
}

function EventSections({
  eventId,
  data,
  onActionSuccess,
}: {
  eventId: string;
  data: EventPageData;
  onActionSuccess: () => void;
}) {
  return (
    <div className="mt-8 flex flex-col gap-10">
      <ProposalSection data={data} />
      <CountdownSection data={data} />
      <CureProgressSection data={data} />
      <ActionsSection eventId={eventId} data={data} onActionSuccess={onActionSuccess} />
    </div>
  );
}

const STATE_LABEL: Record<string, string> = {
  Proposed: "Proposed",
  Challenged: "Challenged",
  Escalated: "Challenged", // see event-fixtures.ts: the contract never sets the unused Challenged variant, challenge() goes straight to Escalated.
  Declared: "Declared",
  Rejected: "Rejected",
  Cured: "Cured",
  None: "None",
};

function ProposalSection({ data }: { data: EventPageData }) {
  if (data.proposal.status === "error") return <SectionError message={data.proposal.message} />;
  const { record, assetCode, definitionSentence } = data.proposal.value;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Eyebrow>{record.kind.tag}</Eyebrow>
          <h1 className="mt-2 font-display text-3xl leading-[0.95] tracking-tight text-silo-oatmeal md:text-4xl">
            {assetCode}
          </h1>
          <p className="mt-1 font-mono text-xs text-cyber-tin/70">Event #{record.id.toString()}</p>
        </div>
        <span className="shrink-0 rounded-full border border-risk-crimson/40 bg-risk-crimson/10 px-3 py-1 font-mono text-sm uppercase tracking-wide text-risk-crimson-tint">
          {STATE_LABEL[record.state.tag] ?? record.state.tag}
        </span>
      </div>

      <p className="mt-4 max-w-xl text-sm leading-relaxed text-cyber-tin">{definitionSentence}</p>

      {isSet(record.declared_at) ? (
        <p className="mt-2 font-mono text-xs text-cyber-tin">
          Declared at {formatUtc(record.declared_at)}.
        </p>
      ) : (
        record.state.tag === "Proposed" && (
          <p className="mt-2 font-mono text-xs text-cyber-tin">Proposed at {formatUtc(record.proposed_at)}.</p>
        )
      )}
    </div>
  );
}

// `EventRecord.declared_at` is `Option<u64>` on the contract (unset
// while Proposed) - decoded as `bigint | null` by the generated
// bindings (SDK 17; previously `bigint | undefined`) - but a 0 has
// also been observed coming through from a live read. Whichever of
// null/undefined/0 shows up, 0 is never a real Unix timestamp this
// contract could emit, so all three are treated as "not actually set
// yet" rather than letting any of them render as an epoch date.
function isSet(value: bigint | null | undefined): value is bigint {
  return value !== undefined && value !== null && value !== BigInt(0);
}

function formatUtc(unixSecs: bigint): string {
  return new Date(Number(unixSecs) * 1000).toISOString();
}

function CountdownSection({ data }: { data: EventPageData }) {
  if (data.countdown.status === "error") {
    return (
      <div>
        <Eyebrow>+ CHALLENGE WINDOW</Eyebrow>
        <div className="mt-4">
          <SectionError message={data.countdown.message} />
        </div>
      </div>
    );
  }

  const countdown = data.countdown.value;
  if (countdown.phase === "closed") return null;

  return (
    <div>
      <Eyebrow>+ {countdown.phase === "challenge" ? "CHALLENGE WINDOW" : "COMMITTEE RULING"}</Eyebrow>
      <div className="mt-4">
        <Countdown
          deadline={countdown.deadline}
          label={countdown.phase === "challenge" ? "Time left to challenge" : "Time left for a ruling"}
        />
      </div>
    </div>
  );
}

function CureProgressSection({ data }: { data: EventPageData }) {
  if (data.cureProgress.status === "error") {
    return (
      <div>
        <Eyebrow>+ CURE PROGRESS</Eyebrow>
        <div className="mt-4">
          <SectionError message={data.cureProgress.message} />
        </div>
      </div>
    );
  }

  const progress = data.cureProgress.value;
  if (progress === null) return null;

  return (
    <div>
      <Eyebrow>+ CURE PROGRESS</Eyebrow>
      <Card className="mt-4 flex flex-col gap-2">
        <p className="font-mono text-sm text-silo-oatmeal">{progress.recorded.toString()} hours recorded.</p>
        <p className="font-mono text-xs text-cyber-tin">
          {progress.any_below_threshold ? "At least one hour was below threshold." : "No hour below threshold yet."}
        </p>
        <p className="font-mono text-xs text-cyber-tin">
          {progress.any_missing ? "At least one hour is missing." : "No missing hours."}
        </p>
      </Card>
    </div>
  );
}

// Compact form for the note next to a disabled Finalize ("Available in
// 35m"), distinct from Countdown.tsx's own formatRemaining: that one
// spells out every unit down to the second for its own two-line display
// block, which would crowd a one-line note next to a button. Rounds to
// the single coarsest unit instead - the exact second a 2-hour challenge
// window closes isn't actionable information next to a button whose
// whole point is "come back later."
function formatAvailableIn(seconds: number): string {
  if (seconds <= 0) return "Available now";
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `Available in ${days}d`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `Available in ${hours}h`;
  const minutes = Math.max(1, Math.floor(seconds / 60));
  return `Available in ${minutes}m`;
}

/** Ticks once a second toward `deadline` - same tick cadence as Countdown.tsx, kept independent since this hook returns a plain string rather than rendering its own block. */
function useAvailableIn(deadline: bigint): string {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);

  return formatAvailableIn(Number(deadline) - now);
}

function ActionsSection({
  eventId,
  data,
  onActionSuccess,
}: {
  eventId: string;
  data: EventPageData;
  onActionSuccess: () => void;
}) {
  // finalize() throws ChallengeWindowOpen while the event is Proposed
  // and its own challenge window hasn't closed yet (see
  // contracts/event-registry/src/lib.rs's finalize() and
  // web/docs/content/docs/concepts.mdx's Proposed->Declared row) - the
  // same "challenge" phase CountdownSection above already reads from
  // data.countdown. useAvailableIn is called unconditionally (React's
  // rules of hooks - this component returns early below when the
  // proposal failed to load) with a BigInt(0) fallback deadline when
  // the window isn't actually open; formatAvailableIn(0) is never
  // rendered in that case, since the text below only shows while
  // challengeWindowOpen is true.
  const challengeDeadline =
    data.countdown.status === "ok" && data.countdown.value.phase === "challenge"
      ? data.countdown.value.deadline
      : BigInt(0);
  const challengeWindowOpen = challengeDeadline > BigInt(0);
  const availableInText = useAvailableIn(challengeDeadline);

  if (data.proposal.status === "error") return null;
  const { record } = data.proposal.value;

  // checkpoint_cure only ever exists for a Depeg event (every other
  // kind has no such thing to check) - never a button to show
  // disabled-with-an-explanation, just not shown at all for those
  // kinds.
  const isDepeg = record.kind.tag === "Depeg";
  // Within a Depeg event, Checkpoint only applies while it's still
  // Proposed (checkpoint_cure's own WrongState check) - every other
  // state would simulate straight to an error, so THIS condition
  // (unlike kind above) is still shown disabled with an explanation,
  // since it's a real state the event legitimately passes through.
  const checkpointDisabled = record.state.tag !== "Proposed";

  // Disabling Finalize for exactly the challenge-window case, rather
  // than only gating on record.state.tag !== "Proposed" like Checkpoint
  // does, is what actually stops someone clicking Finalize and getting
  // a simulate-time error for a condition the page already knows about.
  // A countdown fetch error fails open (challengeWindowOpen stays
  // false) rather than permanently hiding a legitimate action behind an
  // unrelated read failure - the simulate step still catches a
  // genuinely-too-early click either way.
  const finalizeDisabled = record.state.tag !== "Proposed" || challengeWindowOpen;
  const finalizeDisabledReason =
    record.state.tag !== "Proposed"
      ? "Only applies to an event that's still Proposed."
      : challengeWindowOpen
        ? `Challenge window open. ${availableInText}.`
        : undefined;

  const eventIdBigInt = () => {
    try {
      return BigInt(eventId);
    } catch {
      throw new Error("This is fixture data - there's no real event id to write against.");
    }
  };

  return (
    <div>
      <Eyebrow>+ ACTIONS</Eyebrow>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {isDepeg && (
          <WriteActionButton
            label="Checkpoint"
            disabled={checkpointDisabled}
            disabledReason={checkpointDisabled ? "Only applies while the event's still Proposed." : undefined}
            prepare={(signer) => prepareCheckpointCure(Networks.Testnet, eventIdBigInt(), signer)}
            confirm={(prepared, signer) => confirmCheckpointCure(prepared, signer)}
            onSuccess={onActionSuccess}
          />
        )}
        <WriteActionButton
          label="Finalize"
          disabled={finalizeDisabled}
          disabledReason={finalizeDisabledReason}
          prepare={(signer) => prepareFinalize(Networks.Testnet, eventIdBigInt(), signer)}
          confirm={(prepared, signer) => confirmFinalize(prepared, signer)}
          onSuccess={onActionSuccess}
        />
      </div>
      <p className="mt-4 font-mono text-xs text-cyber-tin">
        Payouts for affected markets will appear here once protection markets launch.
      </p>
    </div>
  );
}
