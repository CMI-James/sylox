//! Required scenario (task brief): the real `RiskOracle`,
//! `EventRegistry`, `Staking`, `Treasury`, `MarketFactory` and
//! `Series` wired together, no mock anywhere between them, deploying
//! `Series` the same way production does - through
//! `MarketFactory.open_series` against a real uploaded Wasm hash
//! (`env.upload(Series)`), never a direct `env.register`. Epoch base
//! around 497,000 (not 0), so this does not accidentally exercise only
//! the small-number edge of anything.
//!
//! The five steps:
//! 1. A real depeg starts day 88 of a 90 day series (seller deposited
//!    and quoted, buyer bought real cover, on day 0).
//! 2. The series reads Pending once "now" passes `expiry` (day 90),
//!    observed via `state()`'s own pure read before anything declares.
//! 3. The event is proposed (`propose_tier1`, unchallenged) and
//!    finalized to Declared.
//! 4. `trigger()` picks up the covering Declared event; the buyer
//!    claims their cover in full.
//! 5. The seller withdraws `collateral - cover_written + premium_earned`
//!    (their own Section 9.6 Triggered-state maximum).
//!
//! A sixth check beyond the brief's own five: once both payouts land,
//! `balance_identity_is_zero` holds exactly (proved algebraically in
//! the PR description, not just by this one run), so a final `sync()`
//! must read Finalized, and the series' own settlement balance must
//! be exactly zero.

extern crate std;

use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, BytesN, Env, Map, Vec};
use sylox_types::{
    AssetConfig, EndpointStatus, EventDefinition, EventKind, IssuerActions, IssuerFlags, Reference,
    SeriesState, SeriesTerms, SignalSet,
};

use crate::{Series, SeriesClient};

const EPOCH_SECS: u64 = 3_600;
const SUB_EPOCH_SECS: u64 = 300;
/// `RiskOracle`'s own `SIGNAL_DISPUTE_SECS`, not exported: this
/// integration test lives in a different crate, so it cannot read
/// that constant directly, the same reasoning
/// `event_registry::test::integration`'s own `KEEPER_BOND` comment
/// already documents for an analogous constant.
const SIGNAL_DISPUTE_SECS: u64 = 7_200;

struct Fixture<'a> {
    oracle: risk_oracle::RiskOracleClient<'a>,
    registry: event_registry::EventRegistryClient<'a>,
    factory: market_factory::MarketFactoryClient<'a>,
    staking: staking::StakingClient<'a>,
    usdc: Address,
    usdc_client: token::TokenClient<'a>,
    usdc_admin_client: token::StellarAssetClient<'a>,
}

/// Generates every contract address up front (the same technique
/// `event_registry::test::integration`'s own `setup` uses for the
/// `RiskOracle`/`EventRegistry` cycle), since `EventRegistry` needs
/// `MarketFactory`'s address in its own constructor and
/// `MarketFactory` needs `EventRegistry`'s: a real circular
/// dependency with no natural construction order.
fn setup(env: &Env) -> Fixture<'_> {
    env.mock_all_auths();

    let governor = Address::generate(env);
    let sac_admin = Address::generate(env);
    let usdc = env.register_stellar_asset_contract_v2(sac_admin).address();
    let usdc_client = token::TokenClient::new(env, &usdc);
    let usdc_admin_client = token::StellarAssetClient::new(env, &usdc);

    let registry_id = Address::generate(env);
    let oracle_id = Address::generate(env);
    let staking_id = Address::generate(env);
    let treasury_id = Address::generate(env);
    let factory_id = Address::generate(env);

    env.register_at(
        &treasury_id,
        treasury::Treasury,
        (governor.clone(), staking_id.clone(), usdc.clone()),
    );

    env.register_at(
        &staking_id,
        staking::Staking,
        (
            governor.clone(),
            oracle_id.clone(),
            registry_id.clone(),
            treasury_id.clone(),
            usdc.clone(),
        ),
    );
    let staking = staking::StakingClient::new(env, &staking_id);

    env.register_at(
        &oracle_id,
        risk_oracle::RiskOracle,
        (governor.clone(), registry_id.clone(), staking_id.clone()),
    );
    let oracle = risk_oracle::RiskOracleClient::new(env, &oracle_id);

    env.register_at(
        &registry_id,
        event_registry::EventRegistry,
        (
            governor.clone(),
            oracle_id.clone(),
            staking_id.clone(),
            factory_id.clone(),
            usdc.clone(),
        ),
    );
    let registry = event_registry::EventRegistryClient::new(env, &registry_id);

    let series_wasm = env.upload(Series);
    env.register_at(
        &factory_id,
        market_factory::MarketFactory,
        (
            governor,
            oracle_id,
            registry_id,
            treasury_id,
            usdc.clone(),
            series_wasm,
        ),
    );
    let factory = market_factory::MarketFactoryClient::new(env, &factory_id);

    Fixture {
        oracle,
        registry,
        factory,
        staking,
        usdc,
        usdc_client,
        usdc_admin_client,
    }
}

fn asset_config(env: &Env, asset: &Address, issuer: &Address) -> AssetConfig {
    AssetConfig {
        asset: asset.clone(),
        issuer: issuer.clone(),
        reference: Reference::Usd,
        home_domain: soroban_sdk::String::from_str(env, "example.com"),
        amm_adapters: Vec::new(env),
        fx_adapter: None,
        min_liquidity: 100_000_000_000,
        issuer_flags: IssuerFlags::default(),
        enabled: true,
    }
}

fn depeg_definition(asset: &Address) -> EventDefinition {
    EventDefinition {
        asset: asset.clone(),
        kind: EventKind::Depeg,
        version: 0,
        reference: Reference::Usd,
        depeg_threshold: 9_500_000,
        depeg_window_secs: 259_200,
        max_missing_epochs: 6,
        cure_threshold: 9_800_000,
        freeze_pct_bps: 0,
        auth_revocation_threshold: 0,
        mint_spike_bps: 0,
        halt_window_secs: 0,
        challenge_secs: 86_400,
        ruling_deadline_secs: 1_209_600,
    }
}

fn signal_set(env: &Env, keeper: &Address, epoch: u64, peg_ratio: i128) -> SignalSet {
    SignalSet {
        epoch,
        posted_at: 0,
        peg_ratio,
        peg_ratio_p10: peg_ratio,
        liquidity_2pct: 500_000_000_000,
        redemption_net: 0,
        supply: 10_000_000_000_000,
        supply_change_bps: 0,
        issuer_actions: IssuerActions::default(),
        endpoint: EndpointStatus::Unknown,
        inputs_hash: BytesN::from_array(env, &[7u8; 32]),
        poster: keeper.clone(),
    }
}

fn post_run(
    env: &Env,
    oracle: &risk_oracle::RiskOracleClient,
    keeper: &Address,
    asset: &Address,
    start_epoch: u64,
    count: u64,
    peg_ratio: i128,
) {
    for i in 0..count {
        let epoch = start_epoch + i;
        env.ledger().set_timestamp((epoch + 1) * EPOCH_SECS);
        oracle.post_signals(keeper, asset, &signal_set(env, keeper, epoch, peg_ratio));
    }
}

/// Posts sub-epoch 0 of `hour`, at exactly its own close (the 300s
/// grid default), so `Series.check_feed_not_behind` (M1) reads a feed
/// that is not behind at that same timestamp.
fn post_sub_signal(
    env: &Env,
    oracle: &risk_oracle::RiskOracleClient,
    keeper: &Address,
    asset: &Address,
    hour: u64,
    peg_ratio: i128,
) {
    let sub_start = hour * EPOCH_SECS;
    env.ledger().set_timestamp(sub_start + SUB_EPOCH_SECS);
    oracle.post_sub_signals(
        keeper,
        asset,
        &hour,
        &0u32,
        &signal_set(env, keeper, hour, peg_ratio),
    );
}

#[test]
fn day_88_depeg_full_lifecycle_against_real_contracts() {
    let env = Env::default();
    let fx = setup(&env);

    let asset_issuer = Address::generate(&env);
    let asset = env
        .register_stellar_asset_contract_v2(asset_issuer.clone())
        .address();
    fx.oracle
        .add_asset(&asset_config(&env, &asset, &asset_issuer));
    fx.registry.register_definition(&depeg_definition(&asset));
    fx.factory
        .set_related_sellers(&asset, &Vec::from_array(&env, [asset_issuer.clone()]));

    // -- baseline: 168 healthy epochs so `median_liquidity`,
    // `cover_gate` and `is_stale` all read real history by the time
    // the series opens (epoch base ~497,000, not 0). --
    const EPOCH_BASE: u64 = 497_000;
    const PRE_SERIES_BASELINE: u64 = 168;
    // Mirrors `Staking`'s own private `params::KEEPER_BOND` (not
    // exported): this integration test lives in a different crate,
    // matching `event_registry::test::integration`'s own documented
    // reasoning for the same constant.
    const KEEPER_BOND: i128 = 50_000_000_000;
    let keeper = Address::generate(&env);
    fx.staking.add_keeper(&keeper);
    fx.usdc_admin_client.mint(&keeper, &KEEPER_BOND);
    fx.staking.stake(&keeper, &KEEPER_BOND);
    assert!(fx.staking.is_active_keeper(&keeper));
    post_run(
        &env,
        &fx.oracle,
        &keeper,
        &asset,
        EPOCH_BASE,
        PRE_SERIES_BASELINE,
        9_900_000,
    );

    let series_start_epoch = EPOCH_BASE + PRE_SERIES_BASELINE;
    let series_start = series_start_epoch * EPOCH_SECS;
    let series_expiry = series_start + 90 * 86_400;

    let mut def_versions = Map::new(&env);
    def_versions.set(EventKind::Depeg, 1u32);
    let terms = SeriesTerms {
        asset: asset.clone(),
        def_versions,
        settlement: fx.usdc.clone(),
        start: series_start,
        expiry: series_expiry,
        claim_window_secs: 30 * 86_400,
        cap: 10_000_000_000_000,
        max_cover_per_buyer: 10_000_000_000_000,
        require_holding: false,
        fee_bps: 750,
    };

    let series_address = fx.factory.open_series(&terms);
    let series = SeriesClient::new(&env, &series_address);

    // -- day 0: a seller deposits and quotes, a buyer buys real cover --
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller_collateral = 20_000 * 10_000_000i128; // 20,000 USDC at 7dp
    fx.usdc_admin_client.mint(&seller, &seller_collateral);
    series.deposit(&seller, &seller_collateral);
    series.quote(&seller, &500u32, &seller_collateral);

    // One sub-epoch posted exactly "now", so `check_feed_not_behind`
    // (M1) sees a feed that is not behind.
    post_sub_signal(
        &env,
        &fx.oracle,
        &keeper,
        &asset,
        series_start_epoch,
        9_900_000,
    );

    let buy_amount = 5_000 * 10_000_000i128; // 5,000 USDC, well under cover_cap
    fx.usdc_admin_client.mint(&buyer, &buy_amount);
    let (filled, premium_total) = series.buy_cover(
        &buyer,
        &buy_amount,
        &500u32,
        &series.premium_quote(&buy_amount, &500u32).1,
    );
    assert_eq!(
        filled, buy_amount,
        "the buyer's single seller must fill it in full"
    );
    assert!(premium_total > 0);
    assert_eq!(
        series.balance(&buyer),
        filled,
        "cover units minted 1:1 with the filled amount (I4)"
    );

    // -- day 88: the real depeg starts. Baseline days 81-88, failing
    // window days 88-91 (72 epochs, matching `depeg_window_secs`). --
    let depeg_start_epoch = series_start_epoch + 88 * 24;
    let depeg_baseline_start = depeg_start_epoch - 168;
    post_run(
        &env,
        &fx.oracle,
        &keeper,
        &asset,
        depeg_baseline_start,
        168,
        9_900_000,
    );
    post_run(
        &env,
        &fx.oracle,
        &keeper,
        &asset,
        depeg_start_epoch,
        72,
        9_000_000,
    );

    // -- the series reads Pending once "now" has passed `expiry`
    // (day 90), observed here before anything is even proposed. --
    assert_eq!(
        series.state(),
        SeriesState::Pending,
        "day 91, past expiry, nothing declared yet: Pending (step 2)"
    );

    // -- propose (unchallenged) and finalize to Declared --
    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + SIGNAL_DISPUTE_SECS + 1);
    let proposer = Address::generate(&env);
    let event_id = fx
        .registry
        .propose_tier1(&proposer, &asset, &EventKind::Depeg, &1);

    let after = now + SIGNAL_DISPUTE_SECS + 1 + 86_400 + 259_200 + SIGNAL_DISPUTE_SECS + 1;
    env.ledger().set_timestamp(after);
    fx.registry.finalize(&event_id);

    // -- trigger: the series picks up the covering Declared event --
    let triggered_event_id = series.trigger();
    assert_eq!(triggered_event_id, event_id);
    assert_eq!(series.state(), SeriesState::Triggered);

    // -- the buyer claims their cover in full --
    let buyer_balance_before = fx.usdc_client.balance(&buyer);
    let claimed = series.claim(&buyer, &filled);
    assert_eq!(
        claimed, filled,
        "the buyer claims the full cover amount (step 4)"
    );
    assert_eq!(series.balance(&buyer), 0);
    assert_eq!(
        fx.usdc_client.balance(&buyer),
        buyer_balance_before + filled
    );

    // -- the seller withdraws collateral minus cover written plus
    // premiums earned: Section 9.6's own Triggered-state maximum. --
    let position = series.position(&seller).unwrap();
    let expected_withdrawal =
        position.collateral - position.cover_written + position.premium_earned;
    let seller_balance_before = fx.usdc_client.balance(&seller);
    let withdrawn = series.withdraw(&seller, &expected_withdrawal);
    assert_eq!(withdrawn, expected_withdrawal, "step 5's own exact amount");
    assert_eq!(
        fx.usdc_client.balance(&seller),
        seller_balance_before + expected_withdrawal
    );
    let position_after = series.position(&seller).unwrap();
    assert_eq!(position_after.collateral, position.cover_written);
    assert_eq!(position_after.premium_earned, 0);

    // -- beyond the brief's own five steps: both payouts settled the
    // balance identity to exactly zero, so one more sync must read
    // Finalized, and the series' own settlement balance is zero. --
    assert_eq!(series.sync(), SeriesState::Finalized);
    assert_eq!(fx.usdc_client.balance(&series_address), 0);
}

/// Regression test (PR #67 review): a series that never has a single
/// buyer used to stay stuck in `MarketFactory`'s own live list and
/// `Pins` forever once it reached Expired, because `sync_internal`
/// only called `release_cover` when `total_reserved` was positive.
/// Fixed by calling `release_cover` unconditionally (deviation 17 in
/// the design note, caught by the I26 property test). Opens a series
/// with no deposit, no quote and no `buy_cover` at all, lets it reach
/// Expired, syncs it, then confirms it is off the live list, its pin
/// is cleared, and its slot is genuinely free, not just reported
/// empty, proved by opening a second series for the same asset right
/// after (the old bug would have left `MAX_SERIES_PER_ASSET` one slot
/// short forever, not just reported a stale count).
#[test]
fn a_series_with_no_buyer_still_leaves_the_live_list_and_pins_at_expiry() {
    let env = Env::default();
    let fx = setup(&env);

    let asset_issuer = Address::generate(&env);
    let asset = env
        .register_stellar_asset_contract_v2(asset_issuer.clone())
        .address();
    fx.oracle
        .add_asset(&asset_config(&env, &asset, &asset_issuer));
    fx.registry.register_definition(&depeg_definition(&asset));
    fx.factory
        .set_related_sellers(&asset, &Vec::from_array(&env, [asset_issuer.clone()]));

    const KEEPER_BOND: i128 = 50_000_000_000;
    let keeper = Address::generate(&env);
    fx.staking.add_keeper(&keeper);
    fx.usdc_admin_client.mint(&keeper, &KEEPER_BOND);
    fx.staking.stake(&keeper, &KEEPER_BOND);

    // Only enough history for `is_stale`, never a full 168-slot ring:
    // no `buy_cover` ever happens in this test.
    const EPOCH_BASE: u64 = 497_000;
    env.ledger().set_timestamp((EPOCH_BASE + 1) * EPOCH_SECS);
    fx.oracle.post_signals(
        &keeper,
        &asset,
        &signal_set(&env, &keeper, EPOCH_BASE, 9_900_000),
    );

    let now = env.ledger().timestamp();
    let mut def_versions = Map::new(&env);
    def_versions.set(EventKind::Depeg, 1u32);
    let terms = SeriesTerms {
        asset: asset.clone(),
        def_versions,
        settlement: fx.usdc.clone(),
        start: now,
        expiry: now + 10_000,
        claim_window_secs: 100,
        cap: 1,
        max_cover_per_buyer: 1,
        require_holding: false,
        fee_bps: 0,
    };
    let series_address = fx.factory.open_series(&terms);
    let series = SeriesClient::new(&env, &series_address);

    assert_eq!(fx.factory.series_for(&asset).len(), 1);
    assert!(fx.factory.has_live_cover(&asset, &EventKind::Depeg, &1));

    // No deposit, no quote, no buy_cover: this series never reserves
    // a single unit of cover (`total_reserved` stays 0 throughout,
    // exactly the condition the old bug needed to trigger). Advance
    // past its own acceptance_end (expiry + depeg_window_secs, the
    // longest window its one pinned kind carries) so it reaches
    // Expired, then sync it.
    env.ledger().set_timestamp(terms.expiry + 259_200 + 1);
    assert_eq!(series.sync(), SeriesState::Expired);

    // Off the list, pin cleared, open_cover unaffected (it was never
    // incremented in the first place).
    assert!(
        fx.factory.series_for(&asset).is_empty(),
        "the no-buyer series must be off MarketFactory's own live list after Expired"
    );
    assert!(
        !fx.factory.has_live_cover(&asset, &EventKind::Depeg, &1),
        "its pin must be cleared, not left live forever"
    );
    assert_eq!(fx.factory.open_cover(&asset), 0);

    // The slot is genuinely free, not just reported empty: a fresh
    // signal for `is_stale`, then a second series for the same asset
    // opens without TooManySeries.
    let now2 = env.ledger().timestamp();
    let fresh_epoch = now2 / EPOCH_SECS - 1;
    env.ledger().set_timestamp((fresh_epoch + 1) * EPOCH_SECS);
    fx.oracle.post_signals(
        &keeper,
        &asset,
        &signal_set(&env, &keeper, fresh_epoch, 9_900_000),
    );
    let second = fx.factory.open_series(&terms);
    assert_ne!(second, series_address);
    assert_eq!(fx.factory.series_for(&asset).len(), 1);
}
