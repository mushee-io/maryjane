use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{fee_amount, MiladyError, ProtocolConfig};

pub const BETA_MIN_DURATION_SECS: i64 = 300;
pub const BETA_MAX_DURATION_SECS: i64 = 3_600;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BetaSide {
    Up,
    Down,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BetaRoundStatus {
    Open,
    Locked,
    Settled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BetaOutcome {
    Unresolved,
    Up,
    Down,
    Push,
}

#[account]
#[derive(InitSpace)]
pub struct BetaConfig {
    pub authority: Pubkey,
    pub oracle: Pubkey,
    pub lock_buffer_secs: i64,
    pub max_oracle_delay_secs: i64,
    pub fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BetaRound {
    pub asset_hash: [u8; 32],
    pub round_id: u64,
    pub collateral_mint: Pubkey,
    pub vault: Pubkey,
    pub start_price: i64,
    pub end_price: i64,
    pub price_exponent: i32,
    pub start_observed_ts: i64,
    pub end_observed_ts: i64,
    pub open_observation_hash: [u8; 32],
    pub close_observation_hash: [u8; 32],
    pub open_ts: i64,
    pub lock_ts: i64,
    pub close_ts: i64,
    pub up_pool: u64,
    pub down_pool: u64,
    pub protocol_fees: u64,
    pub outcome: BetaOutcome,
    pub status: BetaRoundStatus,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BetaPosition {
    pub owner: Pubkey,
    pub round: Pubkey,
    pub up_stake: u64,
    pub down_stake: u64,
    pub collateral_paid: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct OpenBetaRoundArgs {
    pub asset_hash: [u8; 32],
    pub round_id: u64,
    pub duration_secs: i64,
    pub start_price: i64,
    pub price_exponent: i32,
    pub observed_ts: i64,
    pub observation_hash: [u8; 32],
}

pub fn initialize_beta_config(
    ctx: Context<InitializeBetaConfig>,
    oracle: Pubkey,
    lock_buffer_secs: i64,
    max_oracle_delay_secs: i64,
    fee_bps: u16,
) -> Result<()> {
    require!(oracle != Pubkey::default(), MiladyError::InvalidBetaOracle);
    validate_beta_config(lock_buffer_secs, max_oracle_delay_secs, fee_bps)?;

    let config = &mut ctx.accounts.beta_config;
    config.authority = ctx.accounts.authority.key();
    config.oracle = oracle;
    config.lock_buffer_secs = lock_buffer_secs;
    config.max_oracle_delay_secs = max_oracle_delay_secs;
    config.fee_bps = fee_bps;
    config.paused = false;
    config.bump = ctx.bumps.beta_config;

    emit!(BetaConfigInitialized {
        authority: config.authority,
        oracle,
        lock_buffer_secs,
        max_oracle_delay_secs,
        fee_bps,
    });
    Ok(())
}

pub fn update_beta_config(
    ctx: Context<UpdateBetaConfig>,
    oracle: Pubkey,
    lock_buffer_secs: i64,
    max_oracle_delay_secs: i64,
    fee_bps: u16,
    paused: bool,
) -> Result<()> {
    require!(oracle != Pubkey::default(), MiladyError::InvalidBetaOracle);
    validate_beta_config(lock_buffer_secs, max_oracle_delay_secs, fee_bps)?;

    let config = &mut ctx.accounts.beta_config;
    config.oracle = oracle;
    config.lock_buffer_secs = lock_buffer_secs;
    config.max_oracle_delay_secs = max_oracle_delay_secs;
    config.fee_bps = fee_bps;
    config.paused = paused;
    Ok(())
}

pub fn open_beta_round(
    ctx: Context<OpenBetaRound>,
    args: OpenBetaRoundArgs,
) -> Result<()> {
    require!(!ctx.accounts.beta_config.paused, MiladyError::BetaPaused);
    require!(
        ctx.accounts.oracle.key() == ctx.accounts.beta_config.oracle,
        MiladyError::InvalidBetaOracle
    );
    require!(
        matches!(args.duration_secs, 300 | 600 | 900 | 3_600),
        MiladyError::InvalidBetaDuration
    );
    require!(args.start_price > 0, MiladyError::InvalidBetaPrice);

    let now = Clock::get()?.unix_timestamp;
    require!(
        args.observed_ts <= now &&
            now
                .checked_sub(args.observed_ts)
                .ok_or(MiladyError::MathOverflow)?
                <= ctx.accounts.beta_config.max_oracle_delay_secs,
        MiladyError::StaleBetaOracle
    );

    let close_ts = now
        .checked_add(args.duration_secs)
        .ok_or(MiladyError::MathOverflow)?;
    let lock_ts = close_ts
        .checked_sub(ctx.accounts.beta_config.lock_buffer_secs)
        .ok_or(MiladyError::MathOverflow)?;
    require!(lock_ts > now, MiladyError::InvalidBetaLockBuffer);

    let round = &mut ctx.accounts.round;
    round.asset_hash = args.asset_hash;
    round.round_id = args.round_id;
    round.collateral_mint = ctx.accounts.collateral_mint.key();
    round.vault = ctx.accounts.round_vault.key();
    round.start_price = args.start_price;
    round.end_price = 0;
    round.price_exponent = args.price_exponent;
    round.start_observed_ts = args.observed_ts;
    round.end_observed_ts = 0;
    round.open_observation_hash = args.observation_hash;
    round.close_observation_hash = [0; 32];
    round.open_ts = now;
    round.lock_ts = lock_ts;
    round.close_ts = close_ts;
    round.up_pool = 0;
    round.down_pool = 0;
    round.protocol_fees = 0;
    round.outcome = BetaOutcome::Unresolved;
    round.status = BetaRoundStatus::Open;
    round.bump = ctx.bumps.round;

    emit!(BetaRoundOpened {
        round: round.key(),
        asset_hash: round.asset_hash,
        round_id: round.round_id,
        start_price: round.start_price,
        price_exponent: round.price_exponent,
        open_ts: round.open_ts,
        lock_ts: round.lock_ts,
        close_ts: round.close_ts,
        observation_hash: round.open_observation_hash,
    });
    Ok(())
}

pub fn enter_beta_round(
    ctx: Context<EnterBetaRound>,
    side: BetaSide,
    collateral_in: u64,
) -> Result<()> {
    require!(!ctx.accounts.beta_config.paused, MiladyError::BetaPaused);
    require!(collateral_in > 0, MiladyError::ZeroAmount);
    require!(
        ctx.accounts.round.status == BetaRoundStatus::Open,
        MiladyError::BetaRoundNotOpen
    );
    require!(
        Clock::get()?.unix_timestamp < ctx.accounts.round.lock_ts,
        MiladyError::BetaRoundLocked
    );

    let fee = fee_amount(collateral_in, ctx.accounts.beta_config.fee_bps)?;
    let net_stake = collateral_in
        .checked_sub(fee)
        .ok_or(MiladyError::MathOverflow)?;
    require!(net_stake > 0, MiladyError::OrderTooSmall);

    transfer_user(
        &ctx.accounts.token_program,
        &ctx.accounts.collateral_mint,
        &ctx.accounts.user_collateral,
        &ctx.accounts.round_vault,
        &ctx.accounts.owner,
        collateral_in,
    )?;

    let round = &mut ctx.accounts.round;
    match side {
        BetaSide::Up => {
            round.up_pool = round
                .up_pool
                .checked_add(net_stake)
                .ok_or(MiladyError::MathOverflow)?;
        }
        BetaSide::Down => {
            round.down_pool = round
                .down_pool
                .checked_add(net_stake)
                .ok_or(MiladyError::MathOverflow)?;
        }
    }
    round.protocol_fees = round
        .protocol_fees
        .checked_add(fee)
        .ok_or(MiladyError::MathOverflow)?;

    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.owner = ctx.accounts.owner.key();
        position.round = round.key();
        position.bump = ctx.bumps.position;
    }
    require!(!position.claimed, MiladyError::BetaPositionAlreadyClaimed);

    match side {
        BetaSide::Up => {
            position.up_stake = position
                .up_stake
                .checked_add(net_stake)
                .ok_or(MiladyError::MathOverflow)?;
        }
        BetaSide::Down => {
            position.down_stake = position
                .down_stake
                .checked_add(net_stake)
                .ok_or(MiladyError::MathOverflow)?;
        }
    }

    emit!(BetaPositionEntered {
        round: round.key(),
        owner: ctx.accounts.owner.key(),
        side,
        collateral_in,
        net_stake,
        fee,
        up_pool: round.up_pool,
        down_pool: round.down_pool,
    });
    Ok(())
}

pub fn lock_beta_round(ctx: Context<LockBetaRound>) -> Result<()> {
    require!(
        ctx.accounts.round.status == BetaRoundStatus::Open,
        MiladyError::BetaRoundNotOpen
    );
    require!(
        Clock::get()?.unix_timestamp >= ctx.accounts.round.lock_ts,
        MiladyError::BetaRoundStillOpen
    );

    ctx.accounts.round.status = BetaRoundStatus::Locked;

    emit!(BetaRoundLockedEvent {
        round: ctx.accounts.round.key(),
        locked_at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn settle_beta_round(
    ctx: Context<SettleBetaRound>,
    end_price: i64,
    observed_ts: i64,
    observation_hash: [u8; 32],
) -> Result<()> {
    require!(
        ctx.accounts.oracle.key() == ctx.accounts.beta_config.oracle,
        MiladyError::InvalidBetaOracle
    );
    require!(end_price > 0, MiladyError::InvalidBetaPrice);
    require!(
        ctx.accounts.round.status == BetaRoundStatus::Open ||
            ctx.accounts.round.status == BetaRoundStatus::Locked,
        MiladyError::BetaRoundAlreadySettled
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now >= ctx.accounts.round.close_ts, MiladyError::BetaRoundNotEnded);
    require!(
        observed_ts <= now &&
            observed_ts >= ctx.accounts.round.close_ts &&
            observed_ts
                .checked_sub(ctx.accounts.round.close_ts)
                .ok_or(MiladyError::MathOverflow)?
                <= ctx.accounts.beta_config.max_oracle_delay_secs,
        MiladyError::StaleBetaOracle
    );

    let mut outcome = if end_price > ctx.accounts.round.start_price {
        BetaOutcome::Up
    } else if end_price < ctx.accounts.round.start_price {
        BetaOutcome::Down
    } else {
        BetaOutcome::Push
    };

    let winning_pool = match outcome {
        BetaOutcome::Up => ctx.accounts.round.up_pool,
        BetaOutcome::Down => ctx.accounts.round.down_pool,
        BetaOutcome::Push | BetaOutcome::Unresolved => 0,
    };

    if outcome != BetaOutcome::Push && winning_pool == 0 {
        outcome = BetaOutcome::Push;
    }

    let round = &mut ctx.accounts.round;
    round.end_price = end_price;
    round.end_observed_ts = observed_ts;
    round.close_observation_hash = observation_hash;
    round.outcome = outcome;
    round.status = BetaRoundStatus::Settled;

    emit!(BetaRoundSettled {
        round: round.key(),
        start_price: round.start_price,
        end_price,
        outcome,
        observed_ts,
        observation_hash,
        up_pool: round.up_pool,
        down_pool: round.down_pool,
    });
    Ok(())
}

pub fn claim_beta_round(ctx: Context<ClaimBetaRound>) -> Result<()> {
    require!(
        ctx.accounts.round.status == BetaRoundStatus::Settled,
        MiladyError::BetaRoundNotSettled
    );
    require!(!ctx.accounts.position.claimed, MiladyError::BetaPositionAlreadyClaimed);

    let position = &ctx.accounts.position;
    let total_pool = ctx
        .accounts
        .round
        .up_pool
        .checked_add(ctx.accounts.round.down_pool)
        .ok_or(MiladyError::MathOverflow)?;

    let payout = match ctx.accounts.round.outcome {
        BetaOutcome::Up => pari_mutuel_payout(
            position.up_stake,
            ctx.accounts.round.up_pool,
            total_pool,
        )?,
        BetaOutcome::Down => pari_mutuel_payout(
            position.down_stake,
            ctx.accounts.round.down_pool,
            total_pool,
        )?,
        BetaOutcome::Push => position
            .up_stake
            .checked_add(position.down_stake)
            .ok_or(MiladyError::MathOverflow)?,
        BetaOutcome::Unresolved => return err!(MiladyError::BetaRoundNotSettled),
    };

    require!(payout > 0, MiladyError::NothingToClaim);
    require!(
        ctx.accounts.round_vault.amount >= payout,
        MiladyError::InsufficientSettlementCollateral
    );

    transfer_round_signed(
        &ctx.accounts.token_program,
        &ctx.accounts.collateral_mint,
        &ctx.accounts.round_vault,
        &ctx.accounts.user_collateral,
        &ctx.accounts.round,
        payout,
    )?;

    let position = &mut ctx.accounts.position;
    position.collateral_paid = payout;
    position.claimed = true;

    emit!(BetaRoundClaimed {
        round: ctx.accounts.round.key(),
        owner: ctx.accounts.owner.key(),
        outcome: ctx.accounts.round.outcome,
        up_stake: position.up_stake,
        down_stake: position.down_stake,
        collateral_paid: payout,
    });
    Ok(())
}

pub fn sweep_beta_fees(ctx: Context<SweepBetaFees>) -> Result<()> {
    require!(
        ctx.accounts.round.status == BetaRoundStatus::Settled,
        MiladyError::BetaRoundNotSettled
    );

    let amount = ctx.accounts.round.protocol_fees;
    require!(amount > 0, MiladyError::NothingToClaim);
    require!(
        ctx.accounts.round_vault.amount >= amount,
        MiladyError::InsufficientSettlementCollateral
    );

    transfer_round_signed(
        &ctx.accounts.token_program,
        &ctx.accounts.collateral_mint,
        &ctx.accounts.round_vault,
        &ctx.accounts.fee_destination,
        &ctx.accounts.round,
        amount,
    )?;

    ctx.accounts.round.protocol_fees = 0;

    emit!(BetaFeesSwept {
        round: ctx.accounts.round.key(),
        authority: ctx.accounts.authority.key(),
        amount,
    });
    Ok(())
}

pub fn beta_implied_up_bps(up_pool: u64, down_pool: u64) -> Result<u64> {
    let total = up_pool
        .checked_add(down_pool)
        .ok_or(MiladyError::MathOverflow)?;
    if total == 0 {
        return Ok(5_000);
    }

    let value = (up_pool as u128)
        .checked_mul(10_000u128)
        .ok_or(MiladyError::MathOverflow)?
        / total as u128;

    u64::try_from(value).map_err(|_| error!(MiladyError::MathOverflow))
}

pub fn pari_mutuel_payout(
    user_winning_stake: u64,
    winning_pool: u64,
    total_pool: u64,
) -> Result<u64> {
    if user_winning_stake == 0 {
        return Ok(0);
    }
    require!(winning_pool > 0, MiladyError::DivisionByZero);

    let value = (user_winning_stake as u128)
        .checked_mul(total_pool as u128)
        .ok_or(MiladyError::MathOverflow)?
        / winning_pool as u128;

    u64::try_from(value).map_err(|_| error!(MiladyError::MathOverflow))
}

fn validate_beta_config(
    lock_buffer_secs: i64,
    max_oracle_delay_secs: i64,
    fee_bps: u16,
) -> Result<()> {
    require!(
        lock_buffer_secs > 0 && lock_buffer_secs < BETA_MIN_DURATION_SECS,
        MiladyError::InvalidBetaLockBuffer
    );
    require!(
        max_oracle_delay_secs > 0 && max_oracle_delay_secs <= BETA_MAX_DURATION_SECS,
        MiladyError::InvalidBetaOracleDelay
    );
    require!(fee_bps <= 500, MiladyError::FeeTooHigh);
    Ok(())
}

fn transfer_user<'info>(
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

fn transfer_round_signed<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    round: &Account<'info, BetaRound>,
    amount: u64,
) -> Result<()> {
    let asset_hash = round.asset_hash;
    let round_id = round.round_id.to_le_bytes();
    let bump = [round.bump];
    let seeds: &[&[u8]] = &[
        b"beta-round",
        asset_hash.as_ref(),
        round_id.as_ref(),
        &bump,
    ];
    let signer: &[&[&[u8]]] = &[seeds];

    let accounts = TransferChecked {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: round.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(token_program.key(), accounts).with_signer(signer),
        amount,
        mint.decimals,
    )
}

#[derive(Accounts)]
pub struct InitializeBetaConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = protocol_config.bump,
        has_one = authority @ MiladyError::Unauthorized
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = authority,
        space = 8 + BetaConfig::INIT_SPACE,
        seeds = [b"beta-config"],
        bump
    )]
    pub beta_config: Account<'info, BetaConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateBetaConfig<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"beta-config"],
        bump = beta_config.bump,
        has_one = authority @ MiladyError::Unauthorized
    )]
    pub beta_config: Account<'info, BetaConfig>,
}

#[derive(Accounts)]
#[instruction(args: OpenBetaRoundArgs)]
pub struct OpenBetaRound<'info> {
    #[account(mut)]
    pub oracle: Signer<'info>,
    #[account(
        seeds = [b"beta-config"],
        bump = beta_config.bump
    )]
    pub beta_config: Account<'info, BetaConfig>,
    #[account(
        seeds = [b"config"],
        bump = protocol_config.bump,
        has_one = collateral_mint
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = oracle,
        space = 8 + BetaRound::INIT_SPACE,
        seeds = [
            b"beta-round",
            args.asset_hash.as_ref(),
            args.round_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub round: Account<'info, BetaRound>,
    #[account(
        init,
        payer = oracle,
        token::mint = collateral_mint,
        token::authority = round,
        token::token_program = token_program,
        seeds = [b"beta-vault", round.key().as_ref()],
        bump
    )]
    pub round_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EnterBetaRound<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"beta-config"],
        bump = beta_config.bump
    )]
    pub beta_config: Account<'info, BetaConfig>,
    #[account(
        seeds = [b"config"],
        bump = protocol_config.bump,
        has_one = collateral_mint
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [
            b"beta-round",
            round.asset_hash.as_ref(),
            round.round_id.to_le_bytes().as_ref()
        ],
        bump = round.bump,
        has_one = collateral_mint
    )]
    pub round: Account<'info, BetaRound>,
    #[account(
        mut,
        address = round.vault,
        token::mint = collateral_mint,
        token::authority = round,
        token::token_program = token_program
    )]
    pub round_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = owner,
        token::token_program = token_program
    )]
    pub user_collateral: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + BetaPosition::INIT_SPACE,
        seeds = [b"beta-position", round.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub position: Account<'info, BetaPosition>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LockBetaRound<'info> {
    #[account(
        mut,
        seeds = [
            b"beta-round",
            round.asset_hash.as_ref(),
            round.round_id.to_le_bytes().as_ref()
        ],
        bump = round.bump
    )]
    pub round: Account<'info, BetaRound>,
}

#[derive(Accounts)]
pub struct SettleBetaRound<'info> {
    pub oracle: Signer<'info>,
    #[account(
        seeds = [b"beta-config"],
        bump = beta_config.bump
    )]
    pub beta_config: Account<'info, BetaConfig>,
    #[account(
        mut,
        seeds = [
            b"beta-round",
            round.asset_hash.as_ref(),
            round.round_id.to_le_bytes().as_ref()
        ],
        bump = round.bump
    )]
    pub round: Account<'info, BetaRound>,
}

#[derive(Accounts)]
pub struct ClaimBetaRound<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = protocol_config.bump,
        has_one = collateral_mint
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(
        seeds = [
            b"beta-round",
            round.asset_hash.as_ref(),
            round.round_id.to_le_bytes().as_ref()
        ],
        bump = round.bump,
        has_one = collateral_mint
    )]
    pub round: Account<'info, BetaRound>,
    #[account(
        mut,
        address = round.vault,
        token::mint = collateral_mint,
        token::authority = round,
        token::token_program = token_program
    )]
    pub round_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"beta-position", round.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner,
        has_one = round
    )]
    pub position: Account<'info, BetaPosition>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = owner,
        token::token_program = token_program
    )]
    pub user_collateral: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SweepBetaFees<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"beta-config"],
        bump = beta_config.bump,
        has_one = authority @ MiladyError::Unauthorized
    )]
    pub beta_config: Account<'info, BetaConfig>,
    #[account(
        seeds = [b"config"],
        bump = protocol_config.bump,
        has_one = collateral_mint
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [
            b"beta-round",
            round.asset_hash.as_ref(),
            round.round_id.to_le_bytes().as_ref()
        ],
        bump = round.bump,
        has_one = collateral_mint
    )]
    pub round: Account<'info, BetaRound>,
    #[account(
        mut,
        address = round.vault,
        token::mint = collateral_mint,
        token::authority = round,
        token::token_program = token_program
    )]
    pub round_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::token_program = token_program
    )]
    pub fee_destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct BetaConfigInitialized {
    pub authority: Pubkey,
    pub oracle: Pubkey,
    pub lock_buffer_secs: i64,
    pub max_oracle_delay_secs: i64,
    pub fee_bps: u16,
}

#[event]
pub struct BetaRoundOpened {
    pub round: Pubkey,
    pub asset_hash: [u8; 32],
    pub round_id: u64,
    pub start_price: i64,
    pub price_exponent: i32,
    pub open_ts: i64,
    pub lock_ts: i64,
    pub close_ts: i64,
    pub observation_hash: [u8; 32],
}

#[event]
pub struct BetaPositionEntered {
    pub round: Pubkey,
    pub owner: Pubkey,
    pub side: BetaSide,
    pub collateral_in: u64,
    pub net_stake: u64,
    pub fee: u64,
    pub up_pool: u64,
    pub down_pool: u64,
}

#[event]
pub struct BetaRoundLockedEvent {
    pub round: Pubkey,
    pub locked_at: i64,
}

#[event]
pub struct BetaRoundSettled {
    pub round: Pubkey,
    pub start_price: i64,
    pub end_price: i64,
    pub outcome: BetaOutcome,
    pub observed_ts: i64,
    pub observation_hash: [u8; 32],
    pub up_pool: u64,
    pub down_pool: u64,
}

#[event]
pub struct BetaFeesSwept {
    pub round: Pubkey,
    pub authority: Pubkey,
    pub amount: u64,
}

#[event]
pub struct BetaRoundClaimed {
    pub round: Pubkey,
    pub owner: Pubkey,
    pub outcome: BetaOutcome,
    pub up_stake: u64,
    pub down_stake: u64,
    pub collateral_paid: u64,
}
