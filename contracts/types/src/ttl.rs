//! Shared TTL-extension constants and helpers for `MarketFactory` and
//! `Series`. markets design note, Section 3: unlike the four existing
//! contracts (none of which call `extend_ttl` on their own current-state
//! storage yet, known gap, issue #28), these two extend from day one -
//! instance entries on every state-changing call, persistent entries on
//! every write plus the specific hot-path reads each contract's own
//! `lib.rs` calls this for.
//!
//! One shared implementation rather than one copy per contract, since
//! both contracts apply the identical policy (same ledger counts, same
//! threshold/extend_to shape) - the same reasoning
//! `sylox_types::treasury_deposit` and `sylox_types::upgrade` already
//! follow for their own cross-contract mechanics.

use soroban_sdk::{Env, IntoVal, Val};

/// Instance entries (`Terms`/`State`/`Totals`/`Quotes` on `Series`;
/// `Config`/`SeriesCounter` on `MarketFactory`): re-extend once
/// remaining TTL drops below 20 days.
pub const INSTANCE_TTL_THRESHOLD: u32 = 345_600;
/// ... to 30 days. Matches `deploy/extend-ttl.sh`'s own
/// `EXTEND_TARGET_LEDGERS` exactly, so that script's periodic sweep
/// becomes a redundant safety net for these two contracts rather than
/// the only thing keeping their instance entries alive.
pub const INSTANCE_TTL_EXTEND_TO: u32 = 518_400;

/// Persistent entries (`Position`, the cover token's `Balance`;
/// `OpenCover`, `Deployed`, `SeriesList`, `Pins`, `LiveCoverCount`,
/// `RelatedSellers`, `HardCap`): re-extend once remaining TTL drops
/// below 300 days.
pub const PERSISTENT_TTL_THRESHOLD: u32 = 5_184_000;
/// ... to 365 days, matching Section 15.2's own explicit "minimum 1
/// year" floor for Series positions and cover balances.
pub const PERSISTENT_TTL_EXTEND_TO: u32 = 6_307_200;

/// Extends the calling contract's own instance entry. Call at the top
/// of every state-changing function, after `require_auth`/validation
/// so a rejected call never pays for an extension it then reverts.
pub fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
}

/// Extends `key`'s persistent TTL if the entry exists; a no-op
/// otherwise (nothing to extend). Safe to call unconditionally after
/// every write, and from the specific hot-path reads each contract's
/// own `lib.rs` names.
pub fn extend_persistent<K>(env: &Env, key: &K)
where
    K: IntoVal<Env, Val>,
{
    let storage = env.storage().persistent();
    if storage.has(key) {
        storage.extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
    }
}
