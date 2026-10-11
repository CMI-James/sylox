//! Storage keys for MarketFactory. technical-doc.md Section 15.1;
//! markets design note Section 6 (`RelatedSellers`), Section 10
//! (`Pins`, `LiveCoverCount`), Section 11.1 (`HardCap`,
//! `LiquidityCoverRatio` - see `get_hard_cap`/`get_liquidity_cover_ratio`
//! below for why these two exist at all; the spec names the `cover_cap`
//! formula but never says where its two inputs live), Section 2
//! (`PriceGuard` - same gap: M2 names the mechanism but never says
//! where a per-asset guard address is configured. `Series`' own
//! constructor signature is already fixed by Section 12.5 and does
//! not carry a governor address, so a guard cannot be set directly on
//! `Series`; stored here instead, the same governor-settable,
//! per-asset pattern as `RelatedSellers` and `HardCap`).

use soroban_sdk::{contracttype, Address, BytesN, Env, Map, Vec};
use sylox_types::EventKind;

#[contracttype]
pub struct Config {
    pub governor: Address,
    pub oracle: Address,
    pub registry: Address,
    pub treasury: Address,
    pub usdc: Address,
    pub series_wasm: BytesN<32>,
}

#[contracttype]
pub enum DataKey {
    Config,
    /// Monotonic counter; the next id to assign, and the deployment
    /// salt source (Section 3.2, 9.7).
    SeriesCounter,
    /// Asset of a series this factory deployed (auth check, Section
    /// 16.1: `reserve_cover`/`release_cover` require both membership
    /// here and `series.require_auth()`).
    Deployed(Address),
    /// Sum of open cover for this asset, across every live series
    /// (Section 11.1).
    OpenCover(Address),
    /// Live series addresses for this asset (Section 1: a series is
    /// dropped from here at `release_cover`).
    SeriesList(Address),
    /// Governor-set related-seller list for this asset (design note
    /// Section 6). Absent means "never set" (`RelatedSellerListNotSet`
    /// in `open_series`); present-but-empty is a deliberate, explicit
    /// choice, not a default.
    RelatedSellers(Address),
    /// A copy of a live series' own pinned (kind, version) map,
    /// written once at `open_series`, removed at `release_cover`
    /// (design note Section 10). The one thing `has_live_cover` and
    /// `LiveCoverCount` are derived from.
    Pins(Address),
    /// Count of currently-live series pinning (asset, kind, version)
    /// (design note Section 10, invariant I26). `has_live_cover` is
    /// `LiveCoverCount(...) > 0`.
    LiveCoverCount(Address, EventKind, u32),
    /// Governor-set per-asset cap, the other input to `cover_cap`'s
    /// `min(hard_cap(a), k * median_liquidity(a))` (Section 11.1).
    /// Absent means `i128::MAX` (no additional cap beyond the
    /// liquidity-derived one) - safe to default, unlike
    /// `RelatedSellers`: leaving it unset never opens a gap, it just
    /// means the liquidity term is the only real constraint until the
    /// governor sets a tighter one.
    HardCap(Address),
    /// Governor-set global `liquidity_cover_ratio` (`k`, Section
    /// 11.1), fixed point at `sylox_types::SCALE`. Absent means the
    /// spec's own stated default, 0.25 (`SCALE / 4`) - safe to
    /// default, since that default is the spec's own value, not a
    /// placeholder.
    LiquidityCoverRatio,
    /// Governor-set per-asset `PriceGuard` client address (M2, Section
    /// 2). Absent means no guard configured - `buy_cover` skips the
    /// check entirely, exactly as the spec's own stated default.
    PriceGuard(Address),
}

pub fn get_config(env: &Env) -> Option<Config> {
    env.storage().instance().get(&DataKey::Config)
}

pub fn set_config(env: &Env, config: &Config) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn next_series_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::SeriesCounter)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::SeriesCounter, &(id + 1));
    id
}

pub fn series_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::SeriesCounter)
        .unwrap_or(0)
}

pub fn get_deployed_asset(env: &Env, series: &Address) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::Deployed(series.clone()))
}

pub fn set_deployed(env: &Env, series: &Address, asset: &Address) {
    let key = DataKey::Deployed(series.clone());
    env.storage().persistent().set(&key, asset);
    sylox_types::ttl::extend_persistent(env, &key);
}

pub fn clear_deployed(env: &Env, series: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Deployed(series.clone()));
}

pub fn get_open_cover(env: &Env, asset: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::OpenCover(asset.clone()))
        .unwrap_or(0)
}

pub fn set_open_cover(env: &Env, asset: &Address, amount: i128) {
    let key = DataKey::OpenCover(asset.clone());
    env.storage().persistent().set(&key, &amount);
    sylox_types::ttl::extend_persistent(env, &key);
}

pub fn get_series_list(env: &Env, asset: &Address) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::SeriesList(asset.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn set_series_list(env: &Env, asset: &Address, list: &Vec<Address>) {
    let key = DataKey::SeriesList(asset.clone());
    env.storage().persistent().set(&key, list);
    sylox_types::ttl::extend_persistent(env, &key);
}

pub fn get_related_sellers(env: &Env, asset: &Address) -> Option<Vec<Address>> {
    env.storage()
        .persistent()
        .get(&DataKey::RelatedSellers(asset.clone()))
}

pub fn set_related_sellers(env: &Env, asset: &Address, list: &Vec<Address>) {
    let key = DataKey::RelatedSellers(asset.clone());
    env.storage().persistent().set(&key, list);
    sylox_types::ttl::extend_persistent(env, &key);
}

pub fn get_pins(env: &Env, series: &Address) -> Option<Map<EventKind, u32>> {
    env.storage()
        .persistent()
        .get(&DataKey::Pins(series.clone()))
}

pub fn set_pins(env: &Env, series: &Address, pins: &Map<EventKind, u32>) {
    let key = DataKey::Pins(series.clone());
    env.storage().persistent().set(&key, pins);
    sylox_types::ttl::extend_persistent(env, &key);
}

pub fn clear_pins(env: &Env, series: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Pins(series.clone()));
}

pub fn get_live_cover_count(env: &Env, asset: &Address, kind: EventKind, version: u32) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::LiveCoverCount(asset.clone(), kind, version))
        .unwrap_or(0)
}

pub fn set_live_cover_count(env: &Env, asset: &Address, kind: EventKind, version: u32, count: u32) {
    let key = DataKey::LiveCoverCount(asset.clone(), kind, version);
    env.storage().persistent().set(&key, &count);
    sylox_types::ttl::extend_persistent(env, &key);
}

pub fn get_hard_cap(env: &Env, asset: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::HardCap(asset.clone()))
        .unwrap_or(i128::MAX)
}

pub fn set_hard_cap(env: &Env, asset: &Address, amount: i128) {
    let key = DataKey::HardCap(asset.clone());
    env.storage().persistent().set(&key, &amount);
    sylox_types::ttl::extend_persistent(env, &key);
}

/// `SCALE / 4` = 0.25, the spec's own stated default (Section 11.1).
pub fn get_liquidity_cover_ratio(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::LiquidityCoverRatio)
        .unwrap_or(sylox_types::SCALE / 4)
}

pub fn set_liquidity_cover_ratio(env: &Env, ratio: i128) {
    env.storage()
        .instance()
        .set(&DataKey::LiquidityCoverRatio, &ratio);
}

pub fn get_price_guard(env: &Env, asset: &Address) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::PriceGuard(asset.clone()))
}

pub fn set_price_guard(env: &Env, asset: &Address, guard: Option<Address>) {
    let key = DataKey::PriceGuard(asset.clone());
    match guard {
        Some(address) => {
            env.storage().persistent().set(&key, &address);
            sylox_types::ttl::extend_persistent(env, &key);
        }
        None => env.storage().persistent().remove(&key),
    }
}
