//! Storage keys for Series. technical-doc.md Section 15.1. `Terms`,
//! `State`, `Totals` and `Quotes` are all instance storage (one
//! ledger entry, Section 15.1's own table groups them together); the
//! markets design note Section 3's TTL policy treats them as one
//! unit for that reason.

use soroban_sdk::{contracttype, Address, Env, Vec};
use sylox_types::{Quote, SellerPosition, SeriesState, SeriesTerms, SeriesTotals};

/// The other four contracts' addresses, fixed at construction
/// (Section 12.5). Separate from `Terms` (the economic parameters,
/// invariant I11) purely for readability; both live in the same
/// instance entry regardless.
#[contracttype]
pub struct Config {
    pub factory: Address,
    pub oracle: Address,
    pub registry: Address,
    pub treasury: Address,
}

#[contracttype]
pub enum DataKey {
    Config,
    Terms,
    State,
    Totals,
    Quotes,
    /// Monotonic counter backing `Quote.sequence` (design note Section 8).
    QuoteSequence,
    /// The event that triggered this series (Section 9.5), once Triggered.
    EventId,
    /// Cumulative cover ever reserved with `MarketFactory` via
    /// `buy_cover` - the exact amount to release in one call when
    /// `sync_state()` transitions into Triggered or Expired. Equal to
    /// the cover token's own total supply at that same instant, since
    /// mint only happens at a fill and burn only happens via `claim`,
    /// which cannot run before Triggered - i.e. before release already
    /// happened.
    TotalReserved,
    /// When `trigger()` ran, so `claim_for`'s own `claim_window_secs`
    /// wait is measured from the right instant.
    TriggeredAt,
    Position(Address),
    /// SEP-41 cover token balance.
    Balance(Address),
    /// SEP-41 cover token allowance, by (from, spender).
    Allowance(Address, Address),
}

/// SEP-41 `allowance`/`approve`'s own standard shape: an amount plus
/// the ledger it expires on.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

pub fn get_config(env: &Env) -> Config {
    env.storage().instance().get(&DataKey::Config).unwrap()
}

pub fn set_config(env: &Env, config: &Config) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn get_terms(env: &Env) -> SeriesTerms {
    env.storage().instance().get(&DataKey::Terms).unwrap()
}

pub fn set_terms(env: &Env, terms: &SeriesTerms) {
    env.storage().instance().set(&DataKey::Terms, terms);
}

pub fn get_state(env: &Env) -> SeriesState {
    env.storage().instance().get(&DataKey::State).unwrap()
}

pub fn set_state(env: &Env, state: SeriesState) {
    env.storage().instance().set(&DataKey::State, &state);
}

pub fn get_totals(env: &Env) -> SeriesTotals {
    env.storage()
        .instance()
        .get(&DataKey::Totals)
        .unwrap_or_default()
}

pub fn set_totals(env: &Env, totals: &SeriesTotals) {
    env.storage().instance().set(&DataKey::Totals, totals);
}

pub fn get_quotes(env: &Env) -> Vec<Quote> {
    env.storage()
        .instance()
        .get(&DataKey::Quotes)
        .unwrap_or(Vec::new(env))
}

pub fn set_quotes(env: &Env, quotes: &Vec<Quote>) {
    env.storage().instance().set(&DataKey::Quotes, quotes);
}

/// Design note Section 8: a fresh `sequence` for each new quote
/// (including one replacing a cancelled/changed quote, which is
/// itself treated as a new quote).
pub fn next_quote_sequence(env: &Env) -> u64 {
    let next: u64 = env
        .storage()
        .instance()
        .get(&DataKey::QuoteSequence)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::QuoteSequence, &(next + 1));
    next
}

pub fn get_event_id(env: &Env) -> Option<u64> {
    env.storage().instance().get(&DataKey::EventId)
}

pub fn set_event_id(env: &Env, event_id: u64) {
    env.storage().instance().set(&DataKey::EventId, &event_id);
}

pub fn get_total_reserved(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalReserved)
        .unwrap_or(0)
}

pub fn add_total_reserved(env: &Env, amount: i128) {
    let total = get_total_reserved(env) + amount;
    env.storage()
        .instance()
        .set(&DataKey::TotalReserved, &total);
}

pub fn get_triggered_at(env: &Env) -> Option<u64> {
    env.storage().instance().get(&DataKey::TriggeredAt)
}

pub fn set_triggered_at(env: &Env, at: u64) {
    env.storage().instance().set(&DataKey::TriggeredAt, &at);
}

pub fn get_position(env: &Env, seller: &Address) -> Option<SellerPosition> {
    env.storage()
        .persistent()
        .get(&DataKey::Position(seller.clone()))
}

pub fn set_position(env: &Env, seller: &Address, position: &SellerPosition) {
    let key = DataKey::Position(seller.clone());
    env.storage().persistent().set(&key, position);
    sylox_types::ttl::extend_persistent(env, &key);
}

pub fn remove_position(env: &Env, seller: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Position(seller.clone()));
}

pub fn get_balance(env: &Env, holder: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Balance(holder.clone()))
        .unwrap_or(0)
}

pub fn set_balance(env: &Env, holder: &Address, amount: i128) {
    let key = DataKey::Balance(holder.clone());
    if amount == 0 {
        env.storage().persistent().remove(&key);
        return;
    }
    env.storage().persistent().set(&key, &amount);
    sylox_types::ttl::extend_persistent(env, &key);
}

pub fn get_allowance(env: &Env, from: &Address, spender: &Address) -> AllowanceValue {
    env.storage()
        .temporary()
        .get(&DataKey::Allowance(from.clone(), spender.clone()))
        .unwrap_or(AllowanceValue {
            amount: 0,
            expiration_ledger: 0,
        })
}

pub fn set_allowance(env: &Env, from: &Address, spender: &Address, value: &AllowanceValue) {
    let key = DataKey::Allowance(from.clone(), spender.clone());
    if value.amount == 0 {
        env.storage().temporary().remove(&key);
        return;
    }
    env.storage().temporary().set(&key, value);
    let live_for = value
        .expiration_ledger
        .saturating_sub(env.ledger().sequence());
    env.storage()
        .temporary()
        .extend_ttl(&key, live_for, live_for);
}
