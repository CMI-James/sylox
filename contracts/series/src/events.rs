//! Series events. technical-doc.md Section 13.

use soroban_sdk::{contractevent, Address, Vec};
use sylox_types::SeriesState;

#[contractevent(topics = ["sylox", "deposited"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposited {
    #[topic]
    pub seller: Address,
    pub amount: i128,
    pub collateral_after: i128,
}

#[contractevent(topics = ["sylox", "quoted"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Quoted {
    #[topic]
    pub seller: Address,
    pub rate_bps: u32,
    pub available: i128,
}

/// One seller's fill, for `CoverBought.fills`.
#[derive(Clone, Debug, Eq, PartialEq)]
#[soroban_sdk::contracttype]
pub struct Fill {
    pub seller: Address,
    pub amount: i128,
    pub rate_bps: u32,
}

#[contractevent(topics = ["sylox", "cover_bought"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CoverBought {
    #[topic]
    pub buyer: Address,
    pub filled: i128,
    pub premium: i128,
    pub fee: i128,
    pub fills: Vec<Fill>,
}

#[contractevent(topics = ["sylox", "position_transferred"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PositionTransferred {
    #[topic]
    pub from: Address,
    pub to: Address,
}

#[contractevent(topics = ["sylox", "triggered"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Triggered {
    #[topic]
    pub series: Address,
    pub event_id: u64,
}

#[contractevent(topics = ["sylox", "claimed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claimed {
    #[topic]
    pub holder: Address,
    pub amount: i128,
}

#[contractevent(topics = ["sylox", "withdrawn"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdrawn {
    #[topic]
    pub seller: Address,
    pub amount: i128,
}

#[contractevent(topics = ["sylox", "state_changed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StateChanged {
    #[topic]
    pub series: Address,
    pub from: SeriesState,
    pub to: SeriesState,
}
