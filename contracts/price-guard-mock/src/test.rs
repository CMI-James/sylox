use soroban_sdk::{testutils::Address as _, Address, Env};
use sylox_types::GuardStatus;

use crate::{PriceGuardMock, PriceGuardMockClient};

#[test]
fn defaults_to_ok_until_set_then_reads_back() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(PriceGuardMock, (admin.clone(),));
    let client = PriceGuardMockClient::new(&env, &contract_id);
    let asset = Address::generate(&env);

    assert_eq!(client.check(&asset), GuardStatus::Ok);

    client.set_status(&asset, &GuardStatus::Paused);
    assert_eq!(client.check(&asset), GuardStatus::Paused);

    // A different asset is unaffected.
    let other_asset = Address::generate(&env);
    assert_eq!(client.check(&other_asset), GuardStatus::Ok);

    client.set_status(&asset, &GuardStatus::Unavailable);
    assert_eq!(client.check(&asset), GuardStatus::Unavailable);
}

#[test]
#[should_panic]
fn set_status_without_admin_auth_traps() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(PriceGuardMock, (admin,));
    let client = PriceGuardMockClient::new(&env, &contract_id);
    let asset = Address::generate(&env);
    // No mock_all_auths(): the admin never actually signs this call.
    client.set_status(&asset, &GuardStatus::Paused);
}

#[test]
fn admin_reads_back_the_constructor_argument() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(PriceGuardMock, (admin.clone(),));
    let client = PriceGuardMockClient::new(&env, &contract_id);
    assert_eq!(client.admin(), admin);
}
