use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{Market, MarketStatus, MiladyError, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Outcome {
    Unresolved,
    Yes,
    No,
    Invalid,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct ResolutionProposalArgs {
    pub outcome: Outcome,
    pub evidence_hash: [u8; 32],
    pub source_hash: [u8; 32],
    pub observation_hash: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct ResolutionConfig {
    pub authority: Pubkey,
    pub proposal_bond: u64,
    pub dispute_bond: u64,
    pub challenge_period_secs: i64,
    pub escalation_period_secs: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ResolutionState {
    pub market: Pubkey,
    pub proposer: Pubkey,
    pub challenger: Pubkey,
    pub proposed_outcome: Outcome,
    pub final_outcome: Outcome,
    pub evidence_hash: [u8; 32],
    pub source_hash: [u8; 32],
    pub observation_hash: [u8; 32],
    pub dispute_evidence_hash: [u8; 32],
    pub adjudication_hash: [u8; 32],
    pub proposed_at: i64,
    pub challenge_deadline: i64,
    pub escalation_deadline: i64,
    pub proposal_bond: u64,
    pub dispute_bond: u64,
    pub bond_vault: Pubkey,
    pub bump: u8,
}

pub fn initialize_resolution_config(
    ctx: Context<InitializeResolutionConfig>,
    proposal_bond: u64,
    dispute_bond: u64,
    challenge_period_secs: i64,
    escalation_period_secs: i64,
) -> Result<()> {
    require!(proposal_bond > 0, MiladyError::ZeroAmount);
    require!(dispute_bond >= proposal_bond, MiladyError::DisputeBondTooSmall);
    require!(challenge_period_secs > 0, MiladyError::InvalidChallengePeriod);
    require!(
        escalation_period_secs > 0,
        MiladyError::InvalidChallengePeriod
    );

    let state = &mut ctx.accounts.resolution_config;
    state.authority = ctx.accounts.authority.key();
    state.proposal_bond = proposal_bond;
    state.dispute_bond = dispute_bond;
    state.challenge_period_secs = challenge_period_secs;
    state.escalation_period_secs = escalation_period_secs;
    state.bump = ctx.bumps.resolution_config;

    emit!(ResolutionConfigInitialized {
        authority: state.authority,
        proposal_bond,
        dispute_bond,
        challenge_period_secs,
        escalation_period_secs,
    });
    Ok(())
}

pub fn update_resolution_config(
    ctx: Context<UpdateResolutionConfig>,
    proposal_bond: u64,
    dispute_bond: u64,
    challenge_period_secs: i64,
    escalation_period_secs: i64,
) -> Result<()> {
    require!(proposal_bond > 0, MiladyError::ZeroAmount);
    require!(dispute_bond >= proposal_bond, MiladyError::DisputeBondTooSmall);
    require!(challenge_period_secs > 0, MiladyError::InvalidChallengePeriod);
    require!(
        escalation_period_secs > 0,
        MiladyError::InvalidChallengePeriod
    );

    let state = &mut ctx.accounts.resolution_config;
    state.proposal_bond = proposal_bond;
    state.dispute_bond = dispute_bond;
    state.challenge_period_secs = challenge_period_secs;
    state.escalation_period_secs = escalation_period_secs;
    Ok(())
}

pub fn close_market(ctx: Context<CloseMarket>) -> Result<()> {
    require!(
        ctx.accounts.market.status == MarketStatus::Open,
        MiladyError::MarketNotOpen
    );
    require!(
        Clock::get()?.unix_timestamp >= ctx.accounts.market.close_ts,
        MiladyError::MarketStillOpen
    );

    ctx.accounts.market.status = MarketStatus::Closed;

    emit!(MarketClosedForResolution {
        market: ctx.accounts.market.key(),
        closed_at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn propose_resolution(
    ctx: Context<ProposeResolution>,
    args: ResolutionProposalArgs,
) -> Result<()> {
    require!(
        args.outcome != Outcome::Unresolved,
        MiladyError::InvalidOutcome
    );
    require!(
        ctx.accounts.market.status == MarketStatus::Closed,
        MiladyError::MarketNotClosed
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ctx.accounts.market.resolution_ts,
        MiladyError::ResolutionTooEarly
    );

    transfer_user(
        &ctx.accounts.token_program,
        &ctx.accounts.collateral_mint,
        &ctx.accounts.proposer_collateral,
        &ctx.accounts.bond_vault,
        &ctx.accounts.proposer,
        ctx.accounts.resolution_config.proposal_bond,
    )?;

    let state = &mut ctx.accounts.resolution_state;
    state.market = ctx.accounts.market.key();
    state.proposer = ctx.accounts.proposer.key();
    state.challenger = Pubkey::default();
    state.proposed_outcome = args.outcome;
    state.final_outcome = Outcome::Unresolved;
    state.evidence_hash = args.evidence_hash;
    state.source_hash = args.source_hash;
    state.observation_hash = args.observation_hash;
    state.dispute_evidence_hash = [0; 32];
    state.adjudication_hash = [0; 32];
    state.proposed_at = now;
    state.challenge_deadline = now
        .checked_add(ctx.accounts.resolution_config.challenge_period_secs)
        .ok_or(MiladyError::MathOverflow)?;
    state.escalation_deadline = 0;
    state.proposal_bond = ctx.accounts.resolution_config.proposal_bond;
    state.dispute_bond = 0;
    state.bond_vault = ctx.accounts.bond_vault.key();
    state.bump = ctx.bumps.resolution_state;

    ctx.accounts.market.status = MarketStatus::ResolutionPending;

    emit!(ResolutionProposed {
        market: state.market,
        proposer: state.proposer,
        outcome: state.proposed_outcome,
        evidence_hash: state.evidence_hash,
        source_hash: state.source_hash,
        observation_hash: state.observation_hash,
        challenge_deadline: state.challenge_deadline,
        bond: state.proposal_bond,
    });

    Ok(())
}

pub fn dispute_resolution(
    ctx: Context<DisputeResolution>,
    dispute_evidence_hash: [u8; 32],
) -> Result<()> {
    require!(
        ctx.accounts.market.status == MarketStatus::ResolutionPending,
        MiladyError::ResolutionNotPending
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now < ctx.accounts.resolution_state.challenge_deadline,
        MiladyError::ChallengeWindowClosed
    );
    require!(
        ctx.accounts.challenger.key() != ctx.accounts.resolution_state.proposer,
        MiladyError::SelfDisputeNotAllowed
    );

    transfer_user(
        &ctx.accounts.token_program,
        &ctx.accounts.collateral_mint,
        &ctx.accounts.challenger_collateral,
        &ctx.accounts.bond_vault,
        &ctx.accounts.challenger,
        ctx.accounts.resolution_config.dispute_bond,
    )?;

    let state = &mut ctx.accounts.resolution_state;
    state.challenger = ctx.accounts.challenger.key();
    state.dispute_bond = ctx.accounts.resolution_config.dispute_bond;
    state.dispute_evidence_hash = dispute_evidence_hash;
    state.escalation_deadline = now
        .checked_add(ctx.accounts.resolution_config.escalation_period_secs)
        .ok_or(MiladyError::MathOverflow)?;

    ctx.accounts.market.status = MarketStatus::Disputed;

    emit!(ResolutionDisputed {
        market: state.market,
        challenger: state.challenger,
        dispute_evidence_hash,
        escalation_deadline: state.escalation_deadline,
        bond: state.dispute_bond,
    });

    Ok(())
}

pub fn finalize_uncontested(ctx: Context<FinalizeUncontested>) -> Result<()> {
    require!(
        ctx.accounts.market.status == MarketStatus::ResolutionPending,
        MiladyError::ResolutionNotPending
    );
    require!(
        Clock::get()?.unix_timestamp >= ctx.accounts.resolution_state.challenge_deadline,
        MiladyError::ChallengeWindowOpen
    );

    require_keys_eq!(
        ctx.accounts.proposer.key(),
        ctx.accounts.resolution_state.proposer,
        MiladyError::InvalidResolutionParty
    );

    let payout = ctx.accounts.bond_vault.amount;
    if payout > 0 {
        transfer_resolution_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.collateral_mint,
            &ctx.accounts.bond_vault,
            &ctx.accounts.proposer_collateral,
            &ctx.accounts.resolution_state,
            payout,
        )?;
    }

    let outcome = ctx.accounts.resolution_state.proposed_outcome;
    set_final_outcome(&mut ctx.accounts.market, &mut ctx.accounts.resolution_state, outcome)?;

    emit!(ResolutionFinalized {
        market: ctx.accounts.market.key(),
        outcome,
        winner: ctx.accounts.proposer.key(),
        bond_payout: payout,
        adjudication_hash: [0; 32],
    });

    Ok(())
}

pub fn resolve_dispute(
    ctx: Context<ResolveDispute>,
    final_outcome: Outcome,
    adjudication_hash: [u8; 32],
) -> Result<()> {
    require!(
        final_outcome != Outcome::Unresolved,
        MiladyError::InvalidOutcome
    );
    require!(
        ctx.accounts.market.status == MarketStatus::Disputed,
        MiladyError::MarketNotDisputed
    );
    require_keys_eq!(
        ctx.accounts.proposer.key(),
        ctx.accounts.resolution_state.proposer,
        MiladyError::InvalidResolutionParty
    );
    require_keys_eq!(
        ctx.accounts.challenger.key(),
        ctx.accounts.resolution_state.challenger,
        MiladyError::InvalidResolutionParty
    );

    let proposer_wins = final_outcome == ctx.accounts.resolution_state.proposed_outcome;
    let payout = ctx.accounts.bond_vault.amount;

    if payout > 0 {
        if proposer_wins {
            transfer_resolution_signed(
                &ctx.accounts.token_program,
                &ctx.accounts.collateral_mint,
                &ctx.accounts.bond_vault,
                &ctx.accounts.proposer_collateral,
                &ctx.accounts.resolution_state,
                payout,
            )?;
        } else {
            transfer_resolution_signed(
                &ctx.accounts.token_program,
                &ctx.accounts.collateral_mint,
                &ctx.accounts.bond_vault,
                &ctx.accounts.challenger_collateral,
                &ctx.accounts.resolution_state,
                payout,
            )?;
        }
    }

    ctx.accounts.resolution_state.adjudication_hash = adjudication_hash;
    set_final_outcome(
        &mut ctx.accounts.market,
        &mut ctx.accounts.resolution_state,
        final_outcome,
    )?;

    emit!(ResolutionFinalized {
        market: ctx.accounts.market.key(),
        outcome: final_outcome,
        winner: if proposer_wins {
            ctx.accounts.proposer.key()
        } else {
            ctx.accounts.challenger.key()
        },
        bond_payout: payout,
        adjudication_hash,
    });

    Ok(())
}

pub fn cancel_stalled_dispute(ctx: Context<CancelStalledDispute>) -> Result<()> {
    require!(
        ctx.accounts.market.status == MarketStatus::Disputed,
        MiladyError::MarketNotDisputed
    );
    require!(
        Clock::get()?.unix_timestamp >= ctx.accounts.resolution_state.escalation_deadline,
        MiladyError::EscalationWindowOpen
    );
    require_keys_eq!(
        ctx.accounts.proposer.key(),
        ctx.accounts.resolution_state.proposer,
        MiladyError::InvalidResolutionParty
    );
    require_keys_eq!(
        ctx.accounts.challenger.key(),
        ctx.accounts.resolution_state.challenger,
        MiladyError::InvalidResolutionParty
    );

    let proposal_refund = ctx.accounts.resolution_state.proposal_bond;
    let dispute_refund = ctx.accounts.resolution_state.dispute_bond;

    if proposal_refund > 0 {
        transfer_resolution_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.collateral_mint,
            &ctx.accounts.bond_vault,
            &ctx.accounts.proposer_collateral,
            &ctx.accounts.resolution_state,
            proposal_refund,
        )?;
    }

    if dispute_refund > 0 {
        transfer_resolution_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.collateral_mint,
            &ctx.accounts.bond_vault,
            &ctx.accounts.challenger_collateral,
            &ctx.accounts.resolution_state,
            dispute_refund,
        )?;
    }

    set_final_outcome(
        &mut ctx.accounts.market,
        &mut ctx.accounts.resolution_state,
        Outcome::Invalid,
    )?;

    emit!(ResolutionTimedOut {
        market: ctx.accounts.market.key(),
        proposal_refund,
        dispute_refund,
    });

    Ok(())
}

fn set_final_outcome(
    market: &mut Account<Market>,
    state: &mut Account<ResolutionState>,
    outcome: Outcome,
) -> Result<()> {
    state.final_outcome = outcome;
    market.status = match outcome {
        Outcome::Yes => MarketStatus::ResolvedYes,
        Outcome::No => MarketStatus::ResolvedNo,
        Outcome::Invalid => MarketStatus::Cancelled,
        Outcome::Unresolved => return err!(MiladyError::InvalidOutcome),
    };
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
    let cpi = TransferChecked {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(token_program.key(), cpi),
        amount,
        mint.decimals,
    )
}

fn transfer_resolution_signed<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    state: &Account<'info, ResolutionState>,
    amount: u64,
) -> Result<()> {
    let market_key = state.market;
    let bump = [state.bump];
    let seeds: &[&[u8]] = &[b"resolution", market_key.as_ref(), &bump];
    let signer: &[&[&[u8]]] = &[seeds];

    let cpi = TransferChecked {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: state.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(token_program.key(), cpi).with_signer(signer),
        amount,
        mint.decimals,
    )
}

#[derive(Accounts)]
pub struct InitializeResolutionConfig<'info> {
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
        space = 8 + ResolutionConfig::INIT_SPACE,
        seeds = [b"resolution-config"],
        bump
    )]
    pub resolution_config: Account<'info, ResolutionConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateResolutionConfig<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"resolution-config"],
        bump = resolution_config.bump,
        has_one = authority @ MiladyError::Unauthorized
    )]
    pub resolution_config: Account<'info, ResolutionConfig>,
}

#[derive(Accounts)]
pub struct CloseMarket<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        seeds = [b"market", config.key().as_ref(), market.market_seed.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ProposeResolution<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(seeds = [b"config"], bump = protocol_config.bump)]
    pub protocol_config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [b"resolution-config"],
        bump = resolution_config.bump
    )]
    pub resolution_config: Box<Account<'info, ResolutionConfig>>,
    #[account(
        mut,
        seeds = [
            b"market",
            protocol_config.key().as_ref(),
            market.market_seed.as_ref()
        ],
        bump = market.bump,
        has_one = collateral_mint
    )]
    pub market: Box<Account<'info, Market>>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = proposer,
        token::token_program = token_program
    )]
    pub proposer_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = proposer,
        space = 8 + ResolutionState::INIT_SPACE,
        seeds = [b"resolution", market.key().as_ref()],
        bump
    )]
    pub resolution_state: Box<Account<'info, ResolutionState>>,
    #[account(
        init,
        payer = proposer,
        token::mint = collateral_mint,
        token::authority = resolution_state,
        token::token_program = token_program,
        seeds = [b"resolution-bond", market.key().as_ref()],
        bump
    )]
    pub bond_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DisputeResolution<'info> {
    #[account(mut)]
    pub challenger: Signer<'info>,
    #[account(seeds = [b"config"], bump = protocol_config.bump)]
    pub protocol_config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [b"resolution-config"],
        bump = resolution_config.bump
    )]
    pub resolution_config: Box<Account<'info, ResolutionConfig>>,
    #[account(
        mut,
        seeds = [
            b"market",
            protocol_config.key().as_ref(),
            market.market_seed.as_ref()
        ],
        bump = market.bump,
        has_one = collateral_mint
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        seeds = [b"resolution", market.key().as_ref()],
        bump = resolution_state.bump,
        has_one = market,
        has_one = bond_vault
    )]
    pub resolution_state: Box<Account<'info, ResolutionState>>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = challenger,
        token::token_program = token_program
    )]
    pub challenger_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = resolution_state.bond_vault,
        token::mint = collateral_mint,
        token::authority = resolution_state,
        token::token_program = token_program
    )]
    pub bond_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct FinalizeUncontested<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = protocol_config.bump)]
    pub protocol_config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [
            b"market",
            protocol_config.key().as_ref(),
            market.market_seed.as_ref()
        ],
        bump = market.bump,
        has_one = collateral_mint
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        seeds = [b"resolution", market.key().as_ref()],
        bump = resolution_state.bump,
        has_one = market,
        has_one = bond_vault
    )]
    pub resolution_state: Box<Account<'info, ResolutionState>>,
    /// CHECK: constrained to proposer stored in state.
    #[account(address = resolution_state.proposer)]
    pub proposer: UncheckedAccount<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = proposer,
        token::token_program = token_program
    )]
    pub proposer_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = resolution_state.bond_vault,
        token::mint = collateral_mint,
        token::authority = resolution_state,
        token::token_program = token_program
    )]
    pub bond_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CancelStalledDispute<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = protocol_config.bump)]
    pub protocol_config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [
            b"market",
            protocol_config.key().as_ref(),
            market.market_seed.as_ref()
        ],
        bump = market.bump,
        has_one = collateral_mint
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        seeds = [b"resolution", market.key().as_ref()],
        bump = resolution_state.bump,
        has_one = market,
        has_one = bond_vault
    )]
    pub resolution_state: Box<Account<'info, ResolutionState>>,
    /// CHECK: constrained to state.
    #[account(address = resolution_state.proposer)]
    pub proposer: UncheckedAccount<'info>,
    /// CHECK: constrained to state.
    #[account(address = resolution_state.challenger)]
    pub challenger: UncheckedAccount<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = proposer,
        token::token_program = token_program
    )]
    pub proposer_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = challenger,
        token::token_program = token_program
    )]
    pub challenger_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = resolution_state.bond_vault,
        token::mint = collateral_mint,
        token::authority = resolution_state,
        token::token_program = token_program
    )]
    pub bond_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"resolution-config"],
        bump = resolution_config.bump,
        has_one = authority @ MiladyError::Unauthorized
    )]
    pub resolution_config: Box<Account<'info, ResolutionConfig>>,
    #[account(seeds = [b"config"], bump = protocol_config.bump)]
    pub protocol_config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [
            b"market",
            protocol_config.key().as_ref(),
            market.market_seed.as_ref()
        ],
        bump = market.bump,
        has_one = collateral_mint
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        seeds = [b"resolution", market.key().as_ref()],
        bump = resolution_state.bump,
        has_one = market,
        has_one = bond_vault
    )]
    pub resolution_state: Box<Account<'info, ResolutionState>>,
    /// CHECK: constrained to state.
    #[account(address = resolution_state.proposer)]
    pub proposer: UncheckedAccount<'info>,
    /// CHECK: constrained to state.
    #[account(address = resolution_state.challenger)]
    pub challenger: UncheckedAccount<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = proposer,
        token::token_program = token_program
    )]
    pub proposer_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = challenger,
        token::token_program = token_program
    )]
    pub challenger_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = resolution_state.bond_vault,
        token::mint = collateral_mint,
        token::authority = resolution_state,
        token::token_program = token_program
    )]
    pub bond_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct ResolutionConfigInitialized {
    pub authority: Pubkey,
    pub proposal_bond: u64,
    pub dispute_bond: u64,
    pub challenge_period_secs: i64,
    pub escalation_period_secs: i64,
}

#[event]
pub struct MarketClosedForResolution {
    pub market: Pubkey,
    pub closed_at: i64,
}

#[event]
pub struct ResolutionProposed {
    pub market: Pubkey,
    pub proposer: Pubkey,
    pub outcome: Outcome,
    pub evidence_hash: [u8; 32],
    pub source_hash: [u8; 32],
    pub observation_hash: [u8; 32],
    pub challenge_deadline: i64,
    pub bond: u64,
}

#[event]
pub struct ResolutionDisputed {
    pub market: Pubkey,
    pub challenger: Pubkey,
    pub dispute_evidence_hash: [u8; 32],
    pub escalation_deadline: i64,
    pub bond: u64,
}

#[event]
pub struct ResolutionTimedOut {
    pub market: Pubkey,
    pub proposal_refund: u64,
    pub dispute_refund: u64,
}

#[event]
pub struct ResolutionFinalized {
    pub market: Pubkey,
    pub outcome: Outcome,
    pub winner: Pubkey,
    pub bond_payout: u64,
    pub adjudication_hash: [u8; 32],
}
