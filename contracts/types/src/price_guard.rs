use soroban_sdk::contracttype;

/// M2 (markets design note, Section 2): a fast, sale-only pause
/// signal `Series.buy_cover` checks when an asset has one configured.
/// Shared between `Series` (the caller, via its own `PriceGuardClient`)
/// and any contract implementing the `check(asset) -> GuardStatus`
/// side of it (for example `price-guard-mock`), so both sides encode
/// the same type rather than two independently-defined enums that
/// happen to match today.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GuardStatus {
    Ok,
    Paused,
    Unavailable,
}
