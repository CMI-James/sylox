//! Shared upgrade/migrate logic for every Sylox contract. technical-doc.md
//! Section 17.3: "Core contracts expose upgrade(wasm_hash), callable only
//! by the governor, which calls env.deployer().update_current_contract_wasm
//! (hash)." This module is that one implementation, called from each
//! contract's own 2-3 line upgrade()/migrate() wrapper (each contract's own
//! Config and Error are distinct types, so the auth check and the
//! AlreadyMigrated mapping stay in the caller; everything else lives here).
//!
//! update_current_contract_wasm itself is deprecated since soroban-sdk v28
//! in favor of update_current_contract(ContractExecutable::Wasm(hash)),
//! which does the same thing for a plain Wasm executable and is the
//! officially recommended replacement; used here instead of the literal
//! call the spec names.
//!
//! The Upgraded event carries old_version, not old_wasm_hash: there is no
//! SDK call that reads a contract's own current wasm hash from within its
//! own execution (checked env.deployer()'s full API: upload/update only, no
//! getter), so a wasm hash here would have to come from the caller,
//! unverified. old_version is the running code's own version() constant,
//! read before the swap, which cannot be wrong - the new version is
//! confirmed afterward by calling version() post-upgrade (see deploy/
//! README.md's upgrade procedure).
//!
//! Section 17.3's 14 day timelock for Staking/Treasury upgrades (they hold
//! funds) is NOT enforced here: it belongs to Governor (Section 17),
//! which is not built yet (contracts/governor is a stub). Known gap,
//! tracked against the Governor work; do_upgrade and do_migrate below are
//! the direct, immediate admin-gated calls every other governor-gated call
//! in this codebase already uses, with no queueing of their own.

use soroban_sdk::{contractevent, Address, BytesN, ContractExecutable, Env, Symbol};

/// technical-doc.md Section 17.3. `contract` is `env.current_contract_
/// address()`, so an indexer watching this topic across every Sylox
/// contract can tell which one just upgraded without decoding the event's
/// own emitting address separately.
#[contractevent(topics = ["sylox", "upgraded"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Upgraded {
    #[topic]
    pub contract: Address,
    pub old_version: u32,
    pub new_wasm_hash: BytesN<32>,
}

/// Call from each contract's own `upgrade(env, new_wasm_hash)`, after the
/// caller's own `config.governor.require_auth()` (this function does not
/// check auth itself - the caller already extracted `governor` from its
/// own `Config` type, which this module cannot name generically).
///
/// `current_version` is the calling contract's own `version()` constant,
/// read BEFORE the swap (the whole reason `Upgraded` can carry a true
/// `old_version` with no on-chain read-back: it is read from the code
/// that is about to stop running, by that same code, not guessed by the
/// caller).
pub fn do_upgrade(env: &Env, current_version: u32, new_wasm_hash: BytesN<32>) {
    env.deployer()
        .update_current_contract(ContractExecutable::Wasm(new_wasm_hash.clone()));
    Upgraded {
        contract: env.current_contract_address(),
        old_version: current_version,
        new_wasm_hash,
    }
    .publish(env);
}

/// Call from each contract's own `migrate(env, target_version) -> Result<(),
/// Error>`, after the caller's own `config.governor.require_auth()` (same
/// reasoning as `do_upgrade`: no auth check here, the caller already did
/// it). `key` is the instance storage key the CALLER's own DataKey enum
/// reserves for "the storage version this contract's data is currently
/// shaped for" - a plain Symbol, not a shared DataKey variant, since
/// every contract's own DataKey is a distinct type this module cannot
/// name.
///
/// Returns `true` if `target_version` had not yet been applied (and
/// applies it now - the caller's own migration body, if any, runs around
/// this call); `false` if it was already applied (the caller maps this to
/// its own `Error::AlreadyMigrated`-shaped variant). Comparing against the
/// STORED version, not merely "has this key ever been set", so migrate()
/// called again with a LATER target_version than the one on record still
/// returns true and records the new one - each version can run at most
/// once, not "migrate can run at most once ever".
pub fn do_migrate(env: &Env, key: &Symbol, target_version: u32) -> bool {
    let current: u32 = env.storage().instance().get(key).unwrap_or(0);
    if current >= target_version {
        return false;
    }
    env.storage().instance().set(key, &target_version);
    true
}
