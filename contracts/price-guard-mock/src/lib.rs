#![no_std]

//! A minimal, deployable `PriceGuard` (markets design note, Section 2;
//! M2): `check(asset)` returns whatever `GuardStatus` the admin last
//! set for that asset, `Ok` until anyone has set anything. This is
//! the mock the design note's own Scope line says ships with this
//! build - the real adapter (reading an actual fast price signal) is
//! out of scope here.
//!
//! `MarketFactory.price_guard(asset)` has to be told this contract's
//! address before `Series.buy_cover` ever calls it; with no guard
//! configured for an asset, `buy_cover` skips the check entirely
//! (Section 2's own stated default) - deploying this contract is
//! never, by itself, enough to gate anything, and nothing here wires
//! it in as a default for any asset.
//!
//! No `upgrade()`/`migrate()`/`version()`: unlike the protocol
//! contracts this stands in front of, this is a disposable demo/test
//! utility with no funds and no state worth preserving across a
//! redeploy - replacing it outright costs nothing a real upgrade path
//! would be worth building for.

use soroban_sdk::{contract, contractimpl, Address, Env};
use sylox_types::GuardStatus;

#[contract]
pub struct PriceGuardMock;

#[derive(Clone)]
#[soroban_sdk::contracttype]
enum DataKey {
    Admin,
    Status(Address),
}

#[contractimpl]
impl PriceGuardMock {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Admin-only. `Ok`/`Paused`/`Unavailable` for the given asset,
    /// read back by `check` below.
    pub fn set_status(env: Env, asset: Address, status: GuardStatus) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Status(asset), &status);
    }

    /// `PriceGuard::check` (Section 2, M1). `Ok` if nothing has been
    /// set for this asset yet.
    pub fn check(env: Env, asset: Address) -> GuardStatus {
        env.storage()
            .instance()
            .get(&DataKey::Status(asset))
            .unwrap_or(GuardStatus::Ok)
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }
}

#[cfg(test)]
mod test;
