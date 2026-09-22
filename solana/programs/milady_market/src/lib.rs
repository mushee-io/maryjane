use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Burn, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

pub mod beta;
pub mod marketlint;
pub mod orders;
pub mod resolution;
pub mod settlement;
pub use beta::*;
pub use marketlint::*;
pub use orders::*;
pub use resolution::*;
pub use settlement::*;

declare_id!("HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL");

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_FEE_BPS: u16 = 500;
pub const MIN_INITIAL_LIQUIDITY: u64 = 1_000;

#[program]
pub mod milady_market {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, MiladyError::FeeTooHigh);

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.collateral_mint = ctx.accounts.collateral_mint.key();
        config.fee_bps = fee_bps;
        config.paused = false;
        config.bump = ctx.bumps.config;

        emit!(ConfigInitialized {
            authority: config.authority,
            collateral_mint: config.collateral_mint,
            fee_bps,
        });
        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    pub fn create_market(ctx: Context<CreateMarket>, args: CreateMarketArgs) -> Result<()> {
        require!(!ctx.accounts.config.paused, MiladyError::ProtocolPaused);
        require!(
            args.close_ts > Clock::get()?.unix_timestamp,
            MiladyError::InvalidCloseTime
        );
        require!(
            args.resolution_ts >= args.close_ts,
            MiladyError::InvalidResolutionTime
        );

        marketlint::validate_certification_for_market(
            &ctx.accounts.marketlint_config,
            &ctx.accounts.marketlint_certification,
            ctx.accounts.authority.key(),
            args.market_seed,
            args.question_hash,
            args.metadata_hash,
            args.close_ts,
            args.resolution_ts,
        )?;

        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.authority.key();
        market.config = ctx.accounts.config.key();
        market.collateral_mint = ctx.accounts.collateral_mint.key();
        market.market_seed = args.market_seed;
        market.question_hash = args.question_hash;
        market.metadata_hash = args.metadata_hash;
        market.close_ts = args.close_ts;
        market.resolution_ts = args.resolution_ts;
        market.status = MarketStatus::Open;
        market.fee_bps = ctx.accounts.config.fee_bps;
        market.collateral_vault = ctx.accounts.collateral_vault.key();
        market.yes_mint = ctx.accounts.yes_mint.key();
        market.no_mint = ctx.accounts.no_mint.key();
        market.yes_reserve_vault = ctx.accounts.yes_reserve_vault.key();
        market.no_reserve_vault = ctx.accounts.no_reserve_vault.key();
        market.yes_reserve = 0;
        market.no_reserve = 0;
        market.lp_supply = 0;
        market.volume = 0;
        market.protocol_fees = 0;
        market.bump = ctx.bumps.market;

        emit!(MarketCreated {
            market: market.key(),
            authority: market.authority,
            collateral_mint: market.collateral_mint,
            yes_mint: market.yes_mint,
            no_mint: market.no_mint,
            close_ts: market.close_ts,
        });

        let certification = &mut ctx.accounts.marketlint_certification;
        certification.consumed = true;
        certification.market = market.key();

        emit!(MarketLintCertificationConsumed {
            certification: certification.key(),
            market: market.key(),
            report_hash: certification.report_hash,
            spec_hash: certification.spec_hash,
            overall_score: certification.overall_score,
            verdict: certification.verdict,
        });

        Ok(())
    }

    /// Creator-only safety valve for mistakes discovered immediately after launch.
    ///
    /// An unused market can be cancelled only while it is OPEN and before any
    /// collateral, outcome supply, liquidity, volume, or protocol fees exist.
    /// This deliberately does not provide a creator "rug" path once users have
    /// taken positions. Active markets must use the normal INVALID resolution flow.
    pub fn cancel_unused_market(ctx: Context<CancelUnusedMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(market.status == MarketStatus::Open, MiladyError::MarketNotOpen);
        require!(
            market.volume == 0
                && market.protocol_fees == 0
                && market.lp_supply == 0
                && market.yes_reserve == 0
                && market.no_reserve == 0
                && ctx.accounts.collateral_vault.amount == 0
                && ctx.accounts.yes_mint.supply == 0
                && ctx.accounts.no_mint.supply == 0,
            MiladyError::MarketHasActivity
        );

        market.status = MarketStatus::Cancelled;

        emit!(MarketCancelledByCreator {
            market: market.key(),
            authority: ctx.accounts.authority.key(),
            cancelled_at: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn split_complete_set(ctx: Context<PositionAction>, amount: u64) -> Result<()> {
        require!(amount > 0, MiladyError::ZeroAmount);
        validate_market_open(&ctx.accounts.config, &ctx.accounts.market)?;

        transfer_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.collateral_mint,
            &ctx.accounts.user_collateral,
            &ctx.accounts.collateral_vault,
            &ctx.accounts.authority,
            amount,
        )?;

        let config_key = ctx.accounts.config.key();
        let market_seed = ctx.accounts.market.market_seed;
        let market_bump = [ctx.accounts.market.bump];
        let market_seed_slices: &[&[u8]] = &[
            b"market",
            config_key.as_ref(),
            market_seed.as_ref(),
            &market_bump,
        ];
        let signer: &[&[&[u8]]] = &[market_seed_slices];
        mint_to_market_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.yes_mint,
            &ctx.accounts.user_yes,
            &ctx.accounts.market,
            signer,
            amount,
        )?;
        mint_to_market_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.no_mint,
            &ctx.accounts.user_no,
            &ctx.accounts.market,
            signer,
            amount,
        )?;

        emit!(CompleteSetSplit {
            market: ctx.accounts.market.key(),
            user: ctx.accounts.authority.key(),
            amount,
        });
        Ok(())
    }

    pub fn merge_complete_set(ctx: Context<PositionAction>, amount: u64) -> Result<()> {
        require!(amount > 0, MiladyError::ZeroAmount);

        burn_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.yes_mint,
            &ctx.accounts.user_yes,
            &ctx.accounts.authority,
            amount,
        )?;
        burn_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.no_mint,
            &ctx.accounts.user_no,
            &ctx.accounts.authority,
            amount,
        )?;

        let config_key = ctx.accounts.config.key();
        let market_seed = ctx.accounts.market.market_seed;
        let market_bump = [ctx.accounts.market.bump];
        let market_seed_slices: &[&[u8]] = &[
            b"market",
            config_key.as_ref(),
            market_seed.as_ref(),
            &market_bump,
        ];
        let signer: &[&[&[u8]]] = &[market_seed_slices];
        transfer_from_market_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.collateral_mint,
            &ctx.accounts.collateral_vault,
            &ctx.accounts.user_collateral,
            &ctx.accounts.market,
            signer,
            amount,
        )?;

        emit!(CompleteSetMerged {
            market: ctx.accounts.market.key(),
            user: ctx.accounts.authority.key(),
            amount,
        });
        Ok(())
    }

    pub fn add_liquidity(ctx: Context<LiquidityAction>, amount: u64) -> Result<()> {
        require!(amount >= MIN_INITIAL_LIQUIDITY, MiladyError::LiquidityTooSmall);
        validate_market_open(&ctx.accounts.config, &ctx.accounts.market)?;

        let yes_before = ctx.accounts.market.yes_reserve;
        let no_before = ctx.accounts.market.no_reserve;
        let lp_supply_before = ctx.accounts.market.lp_supply;

        let quote = quote_add_liquidity(
            yes_before,
            no_before,
            lp_supply_before,
            amount,
        )?;
        require!(quote.lp_shares > 0, MiladyError::LiquidityTooSmall);

        transfer_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.collateral_mint,
            &ctx.accounts.user_collateral,
            &ctx.accounts.collateral_vault,
            &ctx.accounts.authority,
            amount,
        )?;

        let config_key = ctx.accounts.config.key();
        let market_seed = ctx.accounts.market.market_seed;
        let market_bump = [ctx.accounts.market.bump];
        let market_seed_slices: &[&[u8]] = &[
            b"market",
            config_key.as_ref(),
            market_seed.as_ref(),
            &market_bump,
        ];
        let signer: &[&[&[u8]]] = &[market_seed_slices];
        mint_to_market_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.yes_mint,
            &ctx.accounts.yes_reserve_vault,
            &ctx.accounts.market,
            signer,
            amount,
        )?;
        mint_to_market_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.no_mint,
            &ctx.accounts.no_reserve_vault,
            &ctx.accounts.market,
            signer,
            amount,
        )?;

        if quote.excess_yes > 0 {
            transfer_from_market_signed(
                &ctx.accounts.token_program,
                &ctx.accounts.yes_mint,
                &ctx.accounts.yes_reserve_vault,
                &ctx.accounts.user_yes,
                &ctx.accounts.market,
                signer,
                quote.excess_yes,
            )?;
        }
        if quote.excess_no > 0 {
            transfer_from_market_signed(
                &ctx.accounts.token_program,
                &ctx.accounts.no_mint,
                &ctx.accounts.no_reserve_vault,
                &ctx.accounts.user_no,
                &ctx.accounts.market,
                signer,
                quote.excess_no,
            )?;
        }

        let market = &mut ctx.accounts.market;
        market.yes_reserve = yes_before
            .checked_add(quote.yes_added)
            .ok_or(MiladyError::MathOverflow)?;
        market.no_reserve = no_before
            .checked_add(quote.no_added)
            .ok_or(MiladyError::MathOverflow)?;
        market.lp_supply = lp_supply_before
            .checked_add(quote.lp_shares)
            .ok_or(MiladyError::MathOverflow)?;

        let position = &mut ctx.accounts.lp_position;
        if position.owner == Pubkey::default() {
            position.owner = ctx.accounts.authority.key();
            position.market = market.key();
            position.bump = ctx.bumps.lp_position;
        }
        position.shares = position
            .shares
            .checked_add(quote.lp_shares)
            .ok_or(MiladyError::MathOverflow)?;

        emit!(LiquidityAdded {
            market: market.key(),
            provider: ctx.accounts.authority.key(),
            collateral_in: amount,
            lp_shares: quote.lp_shares,
            yes_reserve: market.yes_reserve,
            no_reserve: market.no_reserve,
        });
        Ok(())
    }

    pub fn remove_liquidity(ctx: Context<LiquidityAction>, lp_shares: u64) -> Result<()> {
        require!(lp_shares > 0, MiladyError::ZeroAmount);
        require!(
            ctx.accounts.lp_position.shares >= lp_shares,
            MiladyError::InsufficientLpShares
        );
        require!(ctx.accounts.market.lp_supply > 0, MiladyError::NoLiquidity);

        let yes_before = ctx.accounts.market.yes_reserve;
        let no_before = ctx.accounts.market.no_reserve;
        let lp_supply_before = ctx.accounts.market.lp_supply;

        let yes_out = mul_div_floor(yes_before, lp_shares, lp_supply_before)?;
        let no_out = mul_div_floor(no_before, lp_shares, lp_supply_before)?;
        let merge_amount = yes_out.min(no_out);
        let excess_yes = yes_out
            .checked_sub(merge_amount)
            .ok_or(MiladyError::MathOverflow)?;
        let excess_no = no_out
            .checked_sub(merge_amount)
            .ok_or(MiladyError::MathOverflow)?;

        let config_key = ctx.accounts.config.key();
        let market_seed = ctx.accounts.market.market_seed;
        let market_bump = [ctx.accounts.market.bump];
        let market_seed_slices: &[&[u8]] = &[
            b"market",
            config_key.as_ref(),
            market_seed.as_ref(),
            &market_bump,
        ];
        let signer: &[&[&[u8]]] = &[market_seed_slices];

        if merge_amount > 0 {
            burn_from_market_signed(
                &ctx.accounts.token_program,
                &ctx.accounts.yes_mint,
                &ctx.accounts.yes_reserve_vault,
                &ctx.accounts.market,
                signer,
                merge_amount,
            )?;
            burn_from_market_signed(
                &ctx.accounts.token_program,
                &ctx.accounts.no_mint,
                &ctx.accounts.no_reserve_vault,
                &ctx.accounts.market,
                signer,
                merge_amount,
            )?;
            transfer_from_market_signed(
                &ctx.accounts.token_program,
                &ctx.accounts.collateral_mint,
                &ctx.accounts.collateral_vault,
                &ctx.accounts.user_collateral,
                &ctx.accounts.market,
                signer,
                merge_amount,
            )?;
        }
        if excess_yes > 0 {
            transfer_from_market_signed(
                &ctx.accounts.token_program,
                &ctx.accounts.yes_mint,
                &ctx.accounts.yes_reserve_vault,
                &ctx.accounts.user_yes,
                &ctx.accounts.market,
                signer,
                excess_yes,
            )?;
        }
        if excess_no > 0 {
            transfer_from_market_signed(
                &ctx.accounts.token_program,
                &ctx.accounts.no_mint,
                &ctx.accounts.no_reserve_vault,
                &ctx.accounts.user_no,
                &ctx.accounts.market,
                signer,
                excess_no,
            )?;
        }

        let market = &mut ctx.accounts.market;
        market.yes_reserve = yes_before
            .checked_sub(yes_out)
            .ok_or(MiladyError::MathOverflow)?;
        market.no_reserve = no_before
            .checked_sub(no_out)
            .ok_or(MiladyError::MathOverflow)?;
        market.lp_supply = lp_supply_before
            .checked_sub(lp_shares)
            .ok_or(MiladyError::MathOverflow)?;
        ctx.accounts.lp_position.shares = ctx
            .accounts
            .lp_position
            .shares
            .checked_sub(lp_shares)
            .ok_or(MiladyError::MathOverflow)?;

        emit!(LiquidityRemoved {
            market: market.key(),
            provider: ctx.accounts.authority.key(),
            lp_shares,
            collateral_out: merge_amount,
            yes_out: excess_yes,
            no_out: excess_no,
        });
        Ok(())
    }

    pub fn buy_yes(ctx: Context<Trade>, collateral_in: u64, min_yes_out: u64) -> Result<()> {
        buy_outcome(ctx, Side::Yes, collateral_in, min_yes_out)
    }

    pub fn buy_no(ctx: Context<Trade>, collateral_in: u64, min_no_out: u64) -> Result<()> {
        buy_outcome(ctx, Side::No, collateral_in, min_no_out)
    }

    pub fn sell_yes(ctx: Context<Trade>, yes_in: u64, min_collateral_out: u64) -> Result<()> {
        sell_outcome(ctx, Side::Yes, yes_in, min_collateral_out)
    }

    pub fn sell_no(ctx: Context<Trade>, no_in: u64, min_collateral_out: u64) -> Result<()> {
        sell_outcome(ctx, Side::No, no_in, min_collateral_out)
    }

    pub fn place_limit_order(
        ctx: Context<PlaceOrder>,
        args: PlaceOrderArgs,
    ) -> Result<()> {
        orders::place_order(ctx, args)
    }

    pub fn fill_limit_order(ctx: Context<FillOrder>, shares: u64) -> Result<()> {
        orders::fill_order(ctx, shares)
    }

    pub fn cancel_limit_order(ctx: Context<CancelOrder>) -> Result<()> {
        orders::cancel_order(ctx)
    }

    pub fn initialize_resolution_config(
        ctx: Context<InitializeResolutionConfig>,
        proposal_bond: u64,
        dispute_bond: u64,
        challenge_period_secs: i64,
        escalation_period_secs: i64,
    ) -> Result<()> {
        resolution::initialize_resolution_config(
            ctx,
            proposal_bond,
            dispute_bond,
            challenge_period_secs,
            escalation_period_secs,
        )
    }

    pub fn update_resolution_config(
        ctx: Context<UpdateResolutionConfig>,
        proposal_bond: u64,
        dispute_bond: u64,
        challenge_period_secs: i64,
        escalation_period_secs: i64,
    ) -> Result<()> {
        resolution::update_resolution_config(
            ctx,
            proposal_bond,
            dispute_bond,
            challenge_period_secs,
            escalation_period_secs,
        )
    }

    pub fn close_market(ctx: Context<CloseMarket>) -> Result<()> {
        resolution::close_market(ctx)
    }

    pub fn propose_resolution(
        ctx: Context<ProposeResolution>,
        args: ResolutionProposalArgs,
    ) -> Result<()> {
        resolution::propose_resolution(ctx, args)
    }

    pub fn dispute_resolution(
        ctx: Context<DisputeResolution>,
        dispute_evidence_hash: [u8; 32],
    ) -> Result<()> {
        resolution::dispute_resolution(ctx, dispute_evidence_hash)
    }

    pub fn finalize_uncontested(ctx: Context<FinalizeUncontested>) -> Result<()> {
        resolution::finalize_uncontested(ctx)
    }

    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        final_outcome: Outcome,
        adjudication_hash: [u8; 32],
    ) -> Result<()> {
        resolution::resolve_dispute(ctx, final_outcome, adjudication_hash)
    }

    pub fn cancel_stalled_dispute(ctx: Context<CancelStalledDispute>) -> Result<()> {
        resolution::cancel_stalled_dispute(ctx)
    }

    pub fn redeem_winnings(ctx: Context<RedeemWinnings>, amount: u64) -> Result<()> {
        settlement::redeem_winnings(ctx, amount)
    }

    pub fn refund_invalid(
        ctx: Context<RefundInvalid>,
        yes_amount: u64,
        no_amount: u64,
    ) -> Result<()> {
        settlement::refund_invalid(ctx, yes_amount, no_amount)
    }

    pub fn initialize_marketlint_config(
        ctx: Context<InitializeMarketLintConfig>,
        attestor: Pubkey,
        min_score: u8,
        max_duplicate_probability: u8,
        min_resolution_clarity_score: u8,
        require_green: bool,
    ) -> Result<()> {
        marketlint::initialize_marketlint_config(
            ctx,
            attestor,
            min_score,
            max_duplicate_probability,
            min_resolution_clarity_score,
            require_green,
        )
    }

    pub fn update_marketlint_config(
        ctx: Context<UpdateMarketLintConfig>,
        attestor: Pubkey,
        min_score: u8,
        max_duplicate_probability: u8,
        min_resolution_clarity_score: u8,
        require_green: bool,
        enabled: bool,
    ) -> Result<()> {
        marketlint::update_marketlint_config(
            ctx,
            attestor,
            min_score,
            max_duplicate_probability,
            min_resolution_clarity_score,
            require_green,
            enabled,
        )
    }

    pub fn certify_market(
        ctx: Context<CertifyMarket>,
        args: CertifyMarketArgs,
    ) -> Result<()> {
        marketlint::certify_market(ctx, args)
    }

    pub fn initialize_beta_config(
        ctx: Context<InitializeBetaConfig>,
        oracle: Pubkey,
        lock_buffer_secs: i64,
        max_oracle_delay_secs: i64,
        fee_bps: u16,
    ) -> Result<()> {
        beta::initialize_beta_config(
            ctx,
            oracle,
            lock_buffer_secs,
            max_oracle_delay_secs,
            fee_bps,
        )
    }

    pub fn update_beta_config(
        ctx: Context<UpdateBetaConfig>,
        oracle: Pubkey,
        lock_buffer_secs: i64,
        max_oracle_delay_secs: i64,
        fee_bps: u16,
        paused: bool,
    ) -> Result<()> {
        beta::update_beta_config(
            ctx,
            oracle,
            lock_buffer_secs,
            max_oracle_delay_secs,
            fee_bps,
            paused,
        )
    }

    pub fn open_beta_round(
        ctx: Context<OpenBetaRound>,
        args: OpenBetaRoundArgs,
    ) -> Result<()> {
        beta::open_beta_round(ctx, args)
    }

    pub fn enter_beta_round(
        ctx: Context<EnterBetaRound>,
        side: BetaSide,
        collateral_in: u64,
    ) -> Result<()> {
        beta::enter_beta_round(ctx, side, collateral_in)
    }

    pub fn lock_beta_round(ctx: Context<LockBetaRound>) -> Result<()> {
        beta::lock_beta_round(ctx)
    }

    pub fn settle_beta_round(
        ctx: Context<SettleBetaRound>,
        end_price: i64,
        observed_ts: i64,
        observation_hash: [u8; 32],
    ) -> Result<()> {
        beta::settle_beta_round(ctx, end_price, observed_ts, observation_hash)
    }

    pub fn claim_beta_round(ctx: Context<ClaimBetaRound>) -> Result<()> {
        beta::claim_beta_round(ctx)
    }

    pub fn sweep_beta_fees(ctx: Context<SweepBetaFees>) -> Result<()> {
        beta::sweep_beta_fees(ctx)
    }
}

fn buy_outcome(
    ctx: Context<Trade>,
    side: Side,
    collateral_in: u64,
    min_out: u64,
) -> Result<()> {
    require!(collateral_in > 0, MiladyError::ZeroAmount);
    validate_market_open(&ctx.accounts.config, &ctx.accounts.market)?;
    require!(
        ctx.accounts.market.yes_reserve > 0 && ctx.accounts.market.no_reserve > 0,
        MiladyError::NoLiquidity
    );

    let fee = fee_amount(collateral_in, ctx.accounts.market.fee_bps)?;
    let net_in = collateral_in
        .checked_sub(fee)
        .ok_or(MiladyError::MathOverflow)?;
    require!(net_in > 0, MiladyError::AmountAfterFeeTooSmall);

    let yes_before = ctx.accounts.market.yes_reserve;
    let no_before = ctx.accounts.market.no_reserve;
    let outcome_out = match side {
        Side::Yes => quote_buy(yes_before, no_before, net_in)?,
        Side::No => quote_buy(no_before, yes_before, net_in)?,
    };
    require!(outcome_out >= min_out, MiladyError::SlippageExceeded);

    transfer_from_user(
        &ctx.accounts.token_program,
        &ctx.accounts.collateral_mint,
        &ctx.accounts.user_collateral,
        &ctx.accounts.collateral_vault,
        &ctx.accounts.authority,
        collateral_in,
    )?;

    let config_key = ctx.accounts.config.key();
    let market_seed = ctx.accounts.market.market_seed;
    let market_bump = [ctx.accounts.market.bump];
    let market_seed_slices: &[&[u8]] = &[
        b"market",
        config_key.as_ref(),
        market_seed.as_ref(),
        &market_bump,
    ];
    let signer: &[&[&[u8]]] = &[market_seed_slices];
    mint_to_market_signed(
        &ctx.accounts.token_program,
        &ctx.accounts.yes_mint,
        &ctx.accounts.yes_reserve_vault,
        &ctx.accounts.market,
        signer,
        net_in,
    )?;
    mint_to_market_signed(
        &ctx.accounts.token_program,
        &ctx.accounts.no_mint,
        &ctx.accounts.no_reserve_vault,
        &ctx.accounts.market,
        signer,
        net_in,
    )?;

    match side {
        Side::Yes => transfer_from_market_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.yes_mint,
            &ctx.accounts.yes_reserve_vault,
            &ctx.accounts.user_yes,
            &ctx.accounts.market,
            signer,
            outcome_out,
        )?,
        Side::No => transfer_from_market_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.no_mint,
            &ctx.accounts.no_reserve_vault,
            &ctx.accounts.user_no,
            &ctx.accounts.market,
            signer,
            outcome_out,
        )?,
    }

    let market = &mut ctx.accounts.market;
    match side {
        Side::Yes => {
            market.yes_reserve = yes_before
                .checked_add(net_in)
                .and_then(|v| v.checked_sub(outcome_out))
                .ok_or(MiladyError::MathOverflow)?;
            market.no_reserve = no_before
                .checked_add(net_in)
                .ok_or(MiladyError::MathOverflow)?;
        }
        Side::No => {
            market.no_reserve = no_before
                .checked_add(net_in)
                .and_then(|v| v.checked_sub(outcome_out))
                .ok_or(MiladyError::MathOverflow)?;
            market.yes_reserve = yes_before
                .checked_add(net_in)
                .ok_or(MiladyError::MathOverflow)?;
        }
    }
    market.protocol_fees = market
        .protocol_fees
        .checked_add(fee)
        .ok_or(MiladyError::MathOverflow)?;
    market.volume = market
        .volume
        .checked_add(collateral_in)
        .ok_or(MiladyError::MathOverflow)?;

    emit!(TradeExecuted {
        market: market.key(),
        trader: ctx.accounts.authority.key(),
        side,
        is_buy: true,
        amount_in: collateral_in,
        amount_out: outcome_out,
        fee,
        yes_reserve: market.yes_reserve,
        no_reserve: market.no_reserve,
    });
    Ok(())
}

fn sell_outcome(
    ctx: Context<Trade>,
    side: Side,
    outcome_in: u64,
    min_collateral_out: u64,
) -> Result<()> {
    require!(outcome_in > 0, MiladyError::ZeroAmount);
    validate_market_open(&ctx.accounts.config, &ctx.accounts.market)?;
    require!(
        ctx.accounts.market.yes_reserve > 0 && ctx.accounts.market.no_reserve > 0,
        MiladyError::NoLiquidity
    );

    let yes_before = ctx.accounts.market.yes_reserve;
    let no_before = ctx.accounts.market.no_reserve;
    let gross_out = match side {
        Side::Yes => quote_sell(yes_before, no_before, outcome_in)?,
        Side::No => quote_sell(no_before, yes_before, outcome_in)?,
    };
    require!(gross_out > 0, MiladyError::AmountAfterFeeTooSmall);

    let fee = fee_amount(gross_out, ctx.accounts.market.fee_bps)?;
    let net_out = gross_out
        .checked_sub(fee)
        .ok_or(MiladyError::MathOverflow)?;
    require!(net_out >= min_collateral_out, MiladyError::SlippageExceeded);

    match side {
        Side::Yes => transfer_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.yes_mint,
            &ctx.accounts.user_yes,
            &ctx.accounts.yes_reserve_vault,
            &ctx.accounts.authority,
            outcome_in,
        )?,
        Side::No => transfer_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.no_mint,
            &ctx.accounts.user_no,
            &ctx.accounts.no_reserve_vault,
            &ctx.accounts.authority,
            outcome_in,
        )?,
    }

    let config_key = ctx.accounts.config.key();
    let market_seed = ctx.accounts.market.market_seed;
    let market_bump = [ctx.accounts.market.bump];
    let market_seed_slices: &[&[u8]] = &[
        b"market",
        config_key.as_ref(),
        market_seed.as_ref(),
        &market_bump,
    ];
    let signer: &[&[&[u8]]] = &[market_seed_slices];
    burn_from_market_signed(
        &ctx.accounts.token_program,
        &ctx.accounts.yes_mint,
        &ctx.accounts.yes_reserve_vault,
        &ctx.accounts.market,
        signer,
        gross_out,
    )?;
    burn_from_market_signed(
        &ctx.accounts.token_program,
        &ctx.accounts.no_mint,
        &ctx.accounts.no_reserve_vault,
        &ctx.accounts.market,
        signer,
        gross_out,
    )?;
    transfer_from_market_signed(
        &ctx.accounts.token_program,
        &ctx.accounts.collateral_mint,
        &ctx.accounts.collateral_vault,
        &ctx.accounts.user_collateral,
        &ctx.accounts.market,
        signer,
        net_out,
    )?;

    let market = &mut ctx.accounts.market;
    match side {
        Side::Yes => {
            market.yes_reserve = yes_before
                .checked_add(outcome_in)
                .and_then(|v| v.checked_sub(gross_out))
                .ok_or(MiladyError::MathOverflow)?;
            market.no_reserve = no_before
                .checked_sub(gross_out)
                .ok_or(MiladyError::MathOverflow)?;
        }
        Side::No => {
            market.no_reserve = no_before
                .checked_add(outcome_in)
                .and_then(|v| v.checked_sub(gross_out))
                .ok_or(MiladyError::MathOverflow)?;
            market.yes_reserve = yes_before
                .checked_sub(gross_out)
                .ok_or(MiladyError::MathOverflow)?;
        }
    }
    market.protocol_fees = market
        .protocol_fees
        .checked_add(fee)
        .ok_or(MiladyError::MathOverflow)?;
    market.volume = market
        .volume
        .checked_add(gross_out)
        .ok_or(MiladyError::MathOverflow)?;

    emit!(TradeExecuted {
        market: market.key(),
        trader: ctx.accounts.authority.key(),
        side,
        is_buy: false,
        amount_in: outcome_in,
        amount_out: net_out,
        fee,
        yes_reserve: market.yes_reserve,
        no_reserve: market.no_reserve,
    });
    Ok(())
}

fn validate_market_open(config: &ProtocolConfig, market: &Market) -> Result<()> {
    require!(!config.paused, MiladyError::ProtocolPaused);
    require!(market.status == MarketStatus::Open, MiladyError::MarketNotOpen);
    require!(
        Clock::get()?.unix_timestamp < market.close_ts,
        MiladyError::MarketClosed
    );
    Ok(())
}

fn fee_amount(amount: u64, fee_bps: u16) -> Result<u64> {
    mul_div_floor(amount, fee_bps as u64, BPS_DENOMINATOR)
}

fn quote_buy(outcome_reserve: u64, other_reserve: u64, net_in: u64) -> Result<u64> {
    require!(
        outcome_reserve > 0 && other_reserve > 0,
        MiladyError::NoLiquidity
    );

    let k = (outcome_reserve as u128)
        .checked_mul(other_reserve as u128)
        .ok_or(MiladyError::MathOverflow)?;
    let new_other = (other_reserve as u128)
        .checked_add(net_in as u128)
        .ok_or(MiladyError::MathOverflow)?;
    let new_outcome_before = (outcome_reserve as u128)
        .checked_add(net_in as u128)
        .ok_or(MiladyError::MathOverflow)?;
    let new_outcome_after = div_ceil_u128(k, new_other)?;
    require!(
        new_outcome_before > new_outcome_after,
        MiladyError::AmountAfterFeeTooSmall
    );

    u64::try_from(new_outcome_before - new_outcome_after)
        .map_err(|_| error!(MiladyError::MathOverflow))
}

fn quote_sell(outcome_reserve: u64, other_reserve: u64, outcome_in: u64) -> Result<u64> {
    require!(
        outcome_reserve > 0 && other_reserve > 0,
        MiladyError::NoLiquidity
    );

    let x = outcome_reserve as u128;
    let y = other_reserve as u128;
    let s = outcome_in as u128;
    let sum = x
        .checked_add(y)
        .and_then(|v| v.checked_add(s))
        .ok_or(MiladyError::MathOverflow)?;
    let four_sy = 4u128
        .checked_mul(s)
        .and_then(|v| v.checked_mul(y))
        .ok_or(MiladyError::MathOverflow)?;
    let discriminant = sum
        .checked_mul(sum)
        .and_then(|v| v.checked_sub(four_sy))
        .ok_or(MiladyError::MathOverflow)?;

    let sqrt_floor = integer_sqrt(discriminant);
    let sqrt_ceil = if sqrt_floor
        .checked_mul(sqrt_floor)
        .ok_or(MiladyError::MathOverflow)?
        == discriminant
    {
        sqrt_floor
    } else {
        sqrt_floor
            .checked_add(1)
            .ok_or(MiladyError::MathOverflow)?
    };

    let gross = sum
        .checked_sub(sqrt_ceil)
        .ok_or(MiladyError::MathOverflow)?
        / 2;

    require!(gross <= y, MiladyError::InsufficientLiquidity);
    u64::try_from(gross).map_err(|_| error!(MiladyError::MathOverflow))
}

fn quote_add_liquidity(
    yes_reserve: u64,
    no_reserve: u64,
    lp_supply: u64,
    amount: u64,
) -> Result<AddLiquidityQuote> {
    if lp_supply == 0 {
        require!(
            yes_reserve == 0 && no_reserve == 0,
            MiladyError::InvalidPoolState
        );
        return Ok(AddLiquidityQuote {
            yes_added: amount,
            no_added: amount,
            excess_yes: 0,
            excess_no: 0,
            lp_shares: amount,
        });
    }

    require!(
        yes_reserve > 0 && no_reserve > 0,
        MiladyError::InvalidPoolState
    );

    if yes_reserve <= no_reserve {
        let yes_added = mul_div_floor(amount, yes_reserve, no_reserve)?;
        let excess_yes = amount
            .checked_sub(yes_added)
            .ok_or(MiladyError::MathOverflow)?;
        let lp_shares = mul_div_floor(amount, lp_supply, no_reserve)?;
        Ok(AddLiquidityQuote {
            yes_added,
            no_added: amount,
            excess_yes,
            excess_no: 0,
            lp_shares,
        })
    } else {
        let no_added = mul_div_floor(amount, no_reserve, yes_reserve)?;
        let excess_no = amount
            .checked_sub(no_added)
            .ok_or(MiladyError::MathOverflow)?;
        let lp_shares = mul_div_floor(amount, lp_supply, yes_reserve)?;
        Ok(AddLiquidityQuote {
            yes_added: amount,
            no_added,
            excess_yes: 0,
            excess_no,
            lp_shares,
        })
    }
}

fn mul_div_floor(a: u64, b: u64, denominator: u64) -> Result<u64> {
    require!(denominator > 0, MiladyError::DivisionByZero);
    let value = (a as u128)
        .checked_mul(b as u128)
        .ok_or(MiladyError::MathOverflow)?
        / denominator as u128;
    u64::try_from(value).map_err(|_| error!(MiladyError::MathOverflow))
}

fn div_ceil_u128(numerator: u128, denominator: u128) -> Result<u128> {
    require!(denominator > 0, MiladyError::DivisionByZero);
    if numerator == 0 {
        return Ok(0);
    }
    Ok((numerator - 1) / denominator + 1)
}

fn integer_sqrt(value: u128) -> u128 {
    if value < 2 {
        return value;
    }

    let mut x0 = value / 2;
    let mut x1 = (x0 + value / x0) / 2;
    while x1 < x0 {
        x0 = x1;
        x1 = (x0 + value / x0) / 2;
    }
    x0
}

fn transfer_from_user<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    let accounts = TransferChecked {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(token_program.key(), accounts),
        amount,
        mint.decimals,
    )
}

fn mint_to_market_signed<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    market: &Account<'info, Market>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    let accounts = MintTo {
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: market.to_account_info(),
    };
    token_interface::mint_to(
        CpiContext::new(token_program.key(), accounts).with_signer(signer_seeds),
        amount,
    )
}

fn transfer_from_market_signed<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    market: &Account<'info, Market>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    let accounts = TransferChecked {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: market.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(token_program.key(), accounts).with_signer(signer_seeds),
        amount,
        mint.decimals,
    )
}

fn burn_from_user<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    let accounts = Burn {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        authority: authority.to_account_info(),
    };
    token_interface::burn(
        CpiContext::new(token_program.key(), accounts),
        amount,
    )
}

fn burn_from_market_signed<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    market: &Account<'info, Market>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    let accounts = Burn {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        authority: market.to_account_info(),
    };
    token_interface::burn(
        CpiContext::new(token_program.key(), accounts).with_signer(signer_seeds),
        amount,
    )
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketStatus {
    Open,
    Closed,
    ResolutionPending,
    Disputed,
    ResolvedYes,
    ResolvedNo,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Side {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct CreateMarketArgs {
    pub market_seed: [u8; 32],
    pub question_hash: [u8; 32],
    pub metadata_hash: [u8; 32],
    pub close_ts: i64,
    pub resolution_ts: i64,
}

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub authority: Pubkey,
    pub config: Pubkey,
    pub collateral_mint: Pubkey,
    pub market_seed: [u8; 32],
    pub question_hash: [u8; 32],
    pub metadata_hash: [u8; 32],
    pub close_ts: i64,
    pub resolution_ts: i64,
    pub status: MarketStatus,
    pub fee_bps: u16,
    pub collateral_vault: Pubkey,
    pub yes_mint: Pubkey,
    pub no_mint: Pubkey,
    pub yes_reserve_vault: Pubkey,
    pub no_reserve_vault: Pubkey,
    pub yes_reserve: u64,
    pub no_reserve: u64,
    pub lp_supply: u64,
    pub volume: u64,
    pub protocol_fees: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserLiquidity {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub shares: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = authority @ MiladyError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,
}

#[derive(Accounts)]
#[instruction(args: CreateMarketArgs)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = collateral_mint
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [b"marketlint-config"],
        bump = marketlint_config.bump
    )]
    pub marketlint_config: Box<Account<'info, MarketLintConfig>>,
    #[account(
        mut,
        seeds = [b"marketlint-cert", args.market_seed.as_ref()],
        bump = marketlint_certification.bump
    )]
    pub marketlint_certification: Box<Account<'info, MarketLintCertification>>,
    #[account(
        init,
        payer = authority,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", config.key().as_ref(), args.market_seed.as_ref()],
        bump
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        init,
        payer = authority,
        token::mint = collateral_mint,
        token::authority = market,
        token::token_program = token_program,
        seeds = [b"collateral-vault", market.key().as_ref()],
        bump
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = authority,
        mint::decimals = collateral_mint.decimals,
        mint::authority = market,
        mint::freeze_authority = market,
        mint::token_program = token_program,
        seeds = [b"yes-mint", market.key().as_ref()],
        bump
    )]
    pub yes_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = authority,
        mint::decimals = collateral_mint.decimals,
        mint::authority = market,
        mint::freeze_authority = market,
        mint::token_program = token_program,
        seeds = [b"no-mint", market.key().as_ref()],
        bump
    )]
    pub no_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = authority,
        token::mint = yes_mint,
        token::authority = market,
        token::token_program = token_program,
        seeds = [b"yes-vault", market.key().as_ref()],
        bump
    )]
    pub yes_reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = authority,
        token::mint = no_mint,
        token::authority = market,
        token::token_program = token_program,
        seeds = [b"no-vault", market.key().as_ref()],
        bump
    )]
    pub no_reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelUnusedMarket<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [b"market", config.key().as_ref(), market.market_seed.as_ref()],
        bump = market.bump,
        has_one = authority @ MiladyError::Unauthorized,
        has_one = collateral_vault,
        has_one = yes_mint,
        has_one = no_mint
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(address = market.collateral_vault)]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = market.yes_mint)]
    pub yes_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = market.no_mint)]
    pub no_mint: Box<InterfaceAccount<'info, Mint>>,
}

#[derive(Accounts)]
pub struct PositionAction<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = collateral_mint
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [b"market", config.key().as_ref(), market.market_seed.as_ref()],
        bump = market.bump,
        has_one = collateral_mint,
        has_one = collateral_vault,
        has_one = yes_mint,
        has_one = no_mint
    )]
    pub market: Box<Account<'info, Market>>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = authority,
        token::token_program = token_program
    )]
    pub user_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = market.collateral_vault,
        token::mint = collateral_mint,
        token::authority = market,
        token::token_program = token_program
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = market.yes_mint)]
    pub yes_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, address = market.no_mint)]
    pub no_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = yes_mint,
        token::authority = authority,
        token::token_program = token_program
    )]
    pub user_yes: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = no_mint,
        token::authority = authority,
        token::token_program = token_program
    )]
    pub user_no: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct LiquidityAction<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = collateral_mint
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [b"market", config.key().as_ref(), market.market_seed.as_ref()],
        bump = market.bump,
        has_one = collateral_mint,
        has_one = collateral_vault,
        has_one = yes_mint,
        has_one = no_mint,
        has_one = yes_reserve_vault,
        has_one = no_reserve_vault
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + UserLiquidity::INIT_SPACE,
        seeds = [b"lp", market.key().as_ref(), authority.key().as_ref()],
        bump
    )]
    pub lp_position: Box<Account<'info, UserLiquidity>>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = authority,
        token::token_program = token_program
    )]
    pub user_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = market.collateral_vault,
        token::mint = collateral_mint,
        token::authority = market,
        token::token_program = token_program
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = market.yes_mint)]
    pub yes_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, address = market.no_mint)]
    pub no_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = market.yes_reserve_vault,
        token::mint = yes_mint,
        token::authority = market,
        token::token_program = token_program
    )]
    pub yes_reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = market.no_reserve_vault,
        token::mint = no_mint,
        token::authority = market,
        token::token_program = token_program
    )]
    pub no_reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = yes_mint,
        token::authority = authority,
        token::token_program = token_program
    )]
    pub user_yes: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = no_mint,
        token::authority = authority,
        token::token_program = token_program
    )]
    pub user_no: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = collateral_mint
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [b"market", config.key().as_ref(), market.market_seed.as_ref()],
        bump = market.bump,
        has_one = collateral_mint,
        has_one = collateral_vault,
        has_one = yes_mint,
        has_one = no_mint,
        has_one = yes_reserve_vault,
        has_one = no_reserve_vault
    )]
    pub market: Box<Account<'info, Market>>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = authority,
        token::token_program = token_program
    )]
    pub user_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = market.collateral_vault,
        token::mint = collateral_mint,
        token::authority = market,
        token::token_program = token_program
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = market.yes_mint)]
    pub yes_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, address = market.no_mint)]
    pub no_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = market.yes_reserve_vault,
        token::mint = yes_mint,
        token::authority = market,
        token::token_program = token_program
    )]
    pub yes_reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = market.no_reserve_vault,
        token::mint = no_mint,
        token::authority = market,
        token::token_program = token_program
    )]
    pub no_reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = yes_mint,
        token::authority = authority,
        token::token_program = token_program
    )]
    pub user_yes: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = no_mint,
        token::authority = authority,
        token::token_program = token_program
    )]
    pub user_no: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Clone, Copy)]
struct AddLiquidityQuote {
    yes_added: u64,
    no_added: u64,
    excess_yes: u64,
    excess_no: u64,
    lp_shares: u64,
}

#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub fee_bps: u16,
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub yes_mint: Pubkey,
    pub no_mint: Pubkey,
    pub close_ts: i64,
}

#[event]
pub struct MarketCancelledByCreator {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub cancelled_at: i64,
}

#[event]
pub struct CompleteSetSplit {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CompleteSetMerged {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct LiquidityAdded {
    pub market: Pubkey,
    pub provider: Pubkey,
    pub collateral_in: u64,
    pub lp_shares: u64,
    pub yes_reserve: u64,
    pub no_reserve: u64,
}

#[event]
pub struct LiquidityRemoved {
    pub market: Pubkey,
    pub provider: Pubkey,
    pub lp_shares: u64,
    pub collateral_out: u64,
    pub yes_out: u64,
    pub no_out: u64,
}

#[event]
pub struct TradeExecuted {
    pub market: Pubkey,
    pub trader: Pubkey,
    pub side: Side,
    pub is_buy: bool,
    pub amount_in: u64,
    pub amount_out: u64,
    pub fee: u64,
    pub yes_reserve: u64,
    pub no_reserve: u64,
}

#[error_code]
pub enum MiladyError {
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Fee exceeds the protocol maximum")]
    FeeTooHigh,
    #[msg("Market close time must be in the future")]
    InvalidCloseTime,
    #[msg("Resolution time must be at or after close time")]
    InvalidResolutionTime,
    #[msg("Market is not open")]
    MarketNotOpen,
    #[msg("Market is already closed")]
    MarketClosed,
    #[msg("Market already has positions, liquidity, volume, or collateral and cannot be creator-cancelled")]
    MarketHasActivity,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Amount is too small after fees")]
    AmountAfterFeeTooSmall,
    #[msg("Pool has no usable liquidity")]
    NoLiquidity,
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
    #[msg("Liquidity amount is too small")]
    LiquidityTooSmall,
    #[msg("Insufficient LP shares")]
    InsufficientLpShares,
    #[msg("Invalid pool state")]
    InvalidPoolState,
    #[msg("Slippage limit exceeded")]
    SlippageExceeded,
    #[msg("Checked arithmetic overflow")]
    MathOverflow,
    #[msg("Division by zero")]
    DivisionByZero,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Limit order price must be between 1 and 9,999 basis points")]
    InvalidOrderPrice,
    #[msg("Limit order amount is too small at the selected price")]
    OrderTooSmall,
    #[msg("Limit order is not active")]
    OrderNotActive,
    #[msg("Fill amount exceeds the order's remaining shares")]
    OrderOverfill,
    #[msg("Order escrow mint does not match the selected side/order kind")]
    InvalidOrderMint,
    #[msg("Order does not belong to this market")]
    InvalidOrderMarket,
    #[msg("Market close timestamp has not been reached")]
    MarketStillOpen,
    #[msg("Market must be closed before resolution")]
    MarketNotClosed,
    #[msg("Resolution proposal is too early")]
    ResolutionTooEarly,
    #[msg("Resolution outcome is invalid")]
    InvalidOutcome,
    #[msg("Resolution is not awaiting challenge")]
    ResolutionNotPending,
    #[msg("Challenge window has already closed")]
    ChallengeWindowClosed,
    #[msg("Challenge window is still open")]
    ChallengeWindowOpen,
    #[msg("Proposer cannot dispute their own proposal")]
    SelfDisputeNotAllowed,
    #[msg("Dispute bond must be greater than or equal to proposal bond")]
    DisputeBondTooSmall,
    #[msg("Challenge/escalation period must be positive")]
    InvalidChallengePeriod,
    #[msg("Resolution party account does not match state")]
    InvalidResolutionParty,
    #[msg("Market is not disputed")]
    MarketNotDisputed,
    #[msg("Escalation window is still open")]
    EscalationWindowOpen,
    #[msg("Market has not finalized to a YES or NO outcome")]
    MarketNotResolved,
    #[msg("Provided outcome mint is not the winning mint")]
    InvalidWinningMint,
    #[msg("Market is not in the cancelled/invalid state")]
    MarketNotCancelled,
    #[msg("Invalid-market refund is below one collateral base unit")]
    RefundTooSmall,
    #[msg("Market collateral vault cannot cover this settlement")]
    InsufficientSettlementCollateral,
    #[msg("33 Beta is paused")]
    BetaPaused,
    #[msg("33 Beta oracle signer is invalid")]
    InvalidBetaOracle,
    #[msg("33 Beta duration must be 5, 10, 15, or 60 minutes")]
    InvalidBetaDuration,
    #[msg("33 Beta price must be positive")]
    InvalidBetaPrice,
    #[msg("33 Beta oracle observation is outside the allowed freshness window")]
    StaleBetaOracle,
    #[msg("33 Beta lock buffer is invalid")]
    InvalidBetaLockBuffer,
    #[msg("33 Beta oracle-delay configuration is invalid")]
    InvalidBetaOracleDelay,
    #[msg("33 Beta round is not open")]
    BetaRoundNotOpen,
    #[msg("33 Beta round is locked")]
    BetaRoundLocked,
    #[msg("33 Beta round is still open")]
    BetaRoundStillOpen,
    #[msg("33 Beta round has already settled")]
    BetaRoundAlreadySettled,
    #[msg("33 Beta round has not ended")]
    BetaRoundNotEnded,
    #[msg("33 Beta round has not settled")]
    BetaRoundNotSettled,
    #[msg("33 Beta position has already been claimed")]
    BetaPositionAlreadyClaimed,
    #[msg("There is nothing to claim")]
    NothingToClaim,
    #[msg("MarketLint certification is disabled")]
    MarketLintDisabled,
    #[msg("MarketLint attestor signer is invalid")]
    InvalidMarketLintAttestor,
    #[msg("MarketLint score or threshold must be between 0 and 100")]
    InvalidMarketLintScore,
    #[msg("MarketLint certification has expired")]
    MarketLintCertificationExpired,
    #[msg("MarketLint certification TTL exceeds protocol maximum")]
    MarketLintCertificationTtlTooLong,
    #[msg("MarketLint certification has already been consumed")]
    MarketLintCertificationConsumed,
    #[msg("MarketLint certification creator does not match market creator")]
    MarketLintCreatorMismatch,
    #[msg("MarketLint certification was issued by a rotated/obsolete attestor")]
    MarketLintAttestorRotated,
    #[msg("MarketLint certification market seed does not match")]
    MarketLintMarketSeedMismatch,
    #[msg("MarketLint certification question hash does not match")]
    MarketLintQuestionHashMismatch,
    #[msg("MarketLint certification metadata hash does not match")]
    MarketLintMetadataHashMismatch,
    #[msg("MarketLint certification close time does not match")]
    MarketLintCloseTimeMismatch,
    #[msg("MarketLint certification resolution time does not match")]
    MarketLintResolutionTimeMismatch,
    #[msg("MarketLint overall score is below protocol threshold")]
    MarketLintScoreTooLow,
    #[msg("MarketLint duplicate probability exceeds protocol threshold")]
    MarketLintDuplicateRiskTooHigh,
    #[msg("MarketLint resolution clarity is below protocol threshold")]
    MarketLintResolutionClarityTooLow,
    #[msg("MarketLint verdict does not satisfy protocol policy")]
    MarketLintVerdictRejected,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buy_quote_moves_price() {
        let out = quote_buy(1_000_000, 1_000_000, 100_000).unwrap();
        assert!(out > 100_000);
        let new_yes = 1_000_000 + 100_000 - out;
        let new_no = 1_000_000 + 100_000;
        assert!((new_yes as u128) * (new_no as u128) >= 1_000_000u128.pow(2));
    }

    #[test]
    fn sell_quote_is_bounded() {
        let out = quote_sell(900_000, 1_100_000, 100_000).unwrap();
        assert!(out > 0);
        assert!(out <= 1_100_000);
        let new_yes = 900_000 + 100_000 - out;
        let new_no = 1_100_000 - out;
        assert!((new_yes as u128) * (new_no as u128) >= 900_000u128 * 1_100_000u128);
    }

    #[test]
    fn balanced_initial_liquidity() {
        let q = quote_add_liquidity(0, 0, 0, 1_000_000).unwrap();
        assert_eq!(q.yes_added, 1_000_000);
        assert_eq!(q.no_added, 1_000_000);
        assert_eq!(q.lp_shares, 1_000_000);
    }

    #[test]
    fn later_liquidity_preserves_ratio() {
        let q = quote_add_liquidity(500_000, 1_000_000, 1_000_000, 100_000).unwrap();
        assert_eq!(q.no_added, 100_000);
        assert_eq!(q.yes_added, 50_000);
        assert_eq!(q.excess_yes, 50_000);
    }

    fn lcg(state: &mut u64) -> u64 {
        *state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        *state
    }

    fn bounded(state: &mut u64, min: u64, max: u64) -> u64 {
        min + (lcg(state) % (max - min + 1))
    }

    #[test]
    fn fuzz_buy_quote_preserves_constant_product() {
        let mut state = 0x33_4d_49_4c_41_44_59u64;

        for _ in 0..20_000 {
            let yes = bounded(&mut state, 10_000, 5_000_000_000);
            let no = bounded(&mut state, 10_000, 5_000_000_000);
            let net_in = bounded(&mut state, 1, 50_000_000);

            let out = quote_buy(yes, no, net_in).unwrap();
            assert!(out > 0);

            let new_yes = yes
                .checked_add(net_in)
                .unwrap()
                .checked_sub(out)
                .unwrap();
            let new_no = no.checked_add(net_in).unwrap();

            assert!(new_yes > 0);
            assert!((new_yes as u128) * (new_no as u128) >= (yes as u128) * (no as u128));
        }
    }

    #[test]
    fn fuzz_sell_quote_never_withdraws_beyond_reserve() {
        let mut state = 0x4d_41_52_4b_45_54_4cu64;

        for _ in 0..20_000 {
            let outcome_reserve = bounded(&mut state, 10_000, 5_000_000_000);
            let other_reserve = bounded(&mut state, 10_000, 5_000_000_000);
            let outcome_in = bounded(&mut state, 1, 50_000_000);

            let out = quote_sell(outcome_reserve, other_reserve, outcome_in).unwrap();
            assert!(out <= other_reserve);

            let new_outcome = outcome_reserve
                .checked_add(outcome_in)
                .unwrap()
                .checked_sub(out)
                .unwrap();
            let new_other = other_reserve.checked_sub(out).unwrap();

            assert!(
                (new_outcome as u128) * (new_other as u128)
                    >= (outcome_reserve as u128) * (other_reserve as u128)
            );
        }
    }

    #[test]
    fn fuzz_fee_is_always_bounded() {
        let mut state = 0x53_45_43_55_52_49_54u64;

        for _ in 0..20_000 {
            let amount = bounded(&mut state, 1, u32::MAX as u64);
            let fee_bps = bounded(&mut state, 0, MAX_FEE_BPS as u64) as u16;
            let fee = fee_amount(amount, fee_bps).unwrap();
            assert!(fee <= amount);
        }
    }

    #[test]
    fn integer_sqrt_is_floor_root() {
        let mut state = 0x46_55_5a_5a_4d_45u64;

        for _ in 0..10_000 {
            let value = bounded(&mut state, 0, u32::MAX as u64) as u128;
            let root = integer_sqrt(value);
            assert!(root * root <= value);
            let next = root + 1;
            assert!(next * next > value);
        }
    }
}
