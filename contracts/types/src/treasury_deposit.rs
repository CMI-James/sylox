//! Shared helper for depositing into `Treasury` as a contract, not a
//! human caller. technical-doc.md Section 12.7: "When a contract is
//! the `from`, it authorizes the nested USDC transfer with
//! `env.authorize_as_current_contract` before the call" - because
//! `Treasury.deposit`'s own body calls `from.require_auth()`, then
//! transfers via the USDC SAC, which itself calls `from.require_auth()`
//! again, a SECOND hop past the depositing contract's own direct call
//! into `Treasury.deposit` that Soroban does not auto-authorize (it
//! only auto-authorizes a contract's own direct calls, never a call
//! two hops down).
//!
//! First built inline in `Staking.deposit_treasury_share`; extracted
//! here (markets design note, Section 9) ahead of `Series.buy_cover`
//! needing the identical pattern for its own fee deposit, so the two
//! calling contracts share one implementation instead of a second,
//! divergent copy. Mirrors `sylox_types::upgrade`'s own shape: a
//! contract's own `Config`/`Error` types are distinct per contract, so
//! only the amount-moving logic lives here, not a wrapper function
//! name each contract must call identically.

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contractclient, vec, Address, Env, IntoVal, Symbol,
};

use crate::TreasuryBucket;

/// The one `Treasury` function this helper calls. A separate, minimal
/// client rather than reusing a caller's own `clients.rs` interface,
/// since each contract's own client trait is its own distinct type.
#[contractclient(name = "TreasuryDepositClient")]
pub trait TreasuryDeposit {
    fn deposit(env: Env, from: Address, bucket: TreasuryBucket, amount: i128);
}

/// Deposits `amount` of the calling contract's own USDC into
/// `treasury`'s `bucket`, pre-authorizing the USDC SAC's nested
/// `transfer` call on the calling contract's own behalf. A non-positive
/// `amount` is a no-op, matching `Treasury.deposit`'s own `InvalidAmount`
/// guard being a caller concern, not this helper's.
pub fn deposit_treasury_share(
    env: &Env,
    usdc: &Address,
    treasury: &Address,
    bucket: TreasuryBucket,
    amount: i128,
) {
    if amount <= 0 {
        return;
    }
    let here = env.current_contract_address();
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: usdc.clone(),
                fn_name: Symbol::new(env, "transfer"),
                args: vec![
                    env,
                    here.clone().into_val(env),
                    treasury.clone().into_val(env),
                    amount.into_val(env),
                ],
            },
            sub_invocations: vec![env],
        }),
    ]);
    TreasuryDepositClient::new(env, treasury).deposit(&here, &bucket, &amount);
}
