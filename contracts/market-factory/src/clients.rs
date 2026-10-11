//! Minimal client interfaces for the contracts MarketFactory calls
//! into, but does not implement. technical-doc.md Section 12.1
//! (RiskOracle), 12.2 (EventRegistry). Each trait lists only the
//! functions this contract actually calls, not that contract's full
//! API; mock contracts implementing these traits live in `test.rs`,
//! never the production build.

use soroban_sdk::{contractclient, Address, Env};
use sylox_types::{AssetConfig, EventKind};

#[contractclient(name = "RiskOracleClient")]
#[allow(dead_code)]
pub trait RiskOracle {
    fn asset_config(env: Env, asset: Address) -> Option<AssetConfig>;
    fn is_stale(env: Env, asset: Address) -> bool;
    /// `cover_cap`'s own liquidity term (Section 11.1): median
    /// `liquidity_2pct` over the last 168 hourly values.
    fn median_liquidity(env: Env, asset: Address) -> i128;
}

#[contractclient(name = "EventRegistryClient")]
#[allow(dead_code)]
pub trait EventRegistry {
    /// `open_series`'s own `AssetBlocked` check (Section 9.7): any
    /// kind Declared under its canonical version.
    fn has_declared(env: Env, asset: Address) -> bool;
    /// `open_series`'s own `DefinitionNotCurrent` check: every pinned
    /// version in `terms.def_versions` must equal this.
    fn current_version(env: Env, asset: Address, kind: EventKind) -> u32;
}
