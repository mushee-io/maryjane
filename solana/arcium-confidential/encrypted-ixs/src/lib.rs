//! Mary Jane confidential prediction-order circuits.
//!
//! The public market/question stays outside MPC. Individual order side, direction,
//! limit price and size are encrypted. The MXE keeps an encrypted aggregate state.
//! A separate snapshot computation reveals only aggregate directional pressure.

use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct PrivateOrder {
        /// 1 = YES, 2 = NO
        pub side: u64,
        /// 1 = BUY, 2 = SELL
        pub kind: u64,
        /// Limit price in basis points. Kept private even though the first
        /// aggregate-pressure circuit does not expose a matching book.
        pub price_bps: u64,
        /// Outcome shares in Mary Jane base units (6 decimals).
        pub shares: u64,
    }

    pub struct ConfidentialState {
        pub yes_pressure: u64,
        pub no_pressure: u64,
        pub order_count: u64,
    }

    pub struct PublicAggregate {
        pub yes_pressure: u64,
        pub no_pressure: u64,
        pub order_count: u64,
    }

    #[instruction]
    pub fn init_confidential_state() -> Enc<Mxe, ConfidentialState> {
        Mxe::get().from_arcis(ConfidentialState {
            yes_pressure: 0,
            no_pressure: 0,
            order_count: 0,
        })
    }

    /// Folds one encrypted order into encrypted market pressure.
    ///
    /// BUY YES and SELL NO add YES pressure.
    /// BUY NO and SELL YES add NO pressure.
    ///
    /// The current v1 intentionally does not reveal or persist an individual
    /// order book. Matching and confidential settlement are separate milestones.
    #[instruction]
    pub fn apply_private_order(
        order_ctxt: Enc<Shared, PrivateOrder>,
        state_ctxt: Enc<Mxe, ConfidentialState>,
    ) -> Enc<Mxe, ConfidentialState> {
        let order = order_ctxt.to_arcis();
        let mut state = state_ctxt.to_arcis();

        // Weight by limit-price conviction while keeping both inputs private.
        // A nonzero floor keeps tiny prices from disappearing from the aggregate.
        let mut weight = (order.shares * order.price_bps) / 10_000;
        if weight == 0 {
            weight = 1;
        }

        let yes_direction =
            (order.kind == 1 && order.side == 1) ||
            (order.kind == 2 && order.side == 2);

        if yes_direction {
            state.yes_pressure += weight;
        } else {
            state.no_pressure += weight;
        }

        state.order_count += 1;
        state_ctxt.owner.from_arcis(state)
    }

    /// Reveals only the aggregate pressure used for public probability updates.
    /// No individual side, size, price or direction is returned.
    #[instruction]
    pub fn reveal_aggregate(
        state_ctxt: Enc<Mxe, ConfidentialState>,
    ) -> PublicAggregate {
        let state = state_ctxt.to_arcis();
        PublicAggregate {
            yes_pressure: state.yes_pressure,
            no_pressure: state.no_pressure,
            order_count: state.order_count,
        }
        .reveal()
    }
}
