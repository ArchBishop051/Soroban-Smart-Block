use soroban_explorer_contract::{ExplorerContract, ExplorerContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn schema_migration_is_admin_only_and_monotonic() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, ExplorerContract);
    let client = ExplorerContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.init(&admin, &1000);
    assert_eq!(client.schema_version(), 1);
    client.migrate(&admin, &1, &2, &10);
    assert_eq!(client.schema_version(), 2);
}

#[test]
#[should_panic]
fn migration_rejects_downgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, ExplorerContract);
    let client = ExplorerContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.init(&admin, &1000);
    client.migrate(&admin, &1, &0, &10);
}
