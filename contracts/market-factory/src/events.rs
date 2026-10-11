//! MarketFactory events. technical-doc.md Section 13 (extended for
//! this build); markets design note Section 6.

use soroban_sdk::{contractevent, Address};

#[contractevent(topics = ["sylox", "series_opened"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SeriesOpened {
    #[topic]
    pub asset: Address,
    pub series: Address,
}

/// Markets design note, Section 6: the related-seller list is new to
/// this build, with no Section 13 row of its own yet to extend.
#[contractevent(topics = ["sylox", "related_sellers_set"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RelatedSellersSet {
    #[topic]
    pub asset: Address,
    pub count: u32,
}
