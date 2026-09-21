use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{Market, MarketStatus, MiladyError, ProtocolConfig};

#[account]
#[derive(InitSpace)]
pub struct SettlementReceipt {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub winning_tokens_burned: u64,
    pub invalid_yes_burned: u64,
    pub invalid_no_burned: u64,
    pub collateral_paid: u64,
    pub last_claim_ts: i64,
    pub bump: u8,
}

pub fn redeem_winnings(ctx: Context<RedeemWinnings>, amount: u64) -> Result<()> {
    require!(amount > 0, MiladyError::ZeroAmount);

    let winning_mint = match ctx.accounts.market.status {
        MarketStatus::ResolvedYes => ctx.accounts.market.yes_mint,
        MarketStatus::ResolvedNo => ctx.accounts.market.no_mint,
        _ => return err!(MiladyError::MarketNotResolved),
    };

    require_keys_eq!(
        ctx.accounts.winning_mint.key(),
        winning_mint,
        MiladyError::InvalidWinningMint
    );

    require!(
        ctx.accounts.collateral_vault.amount >= amount,
        MiladyError::InsufficientSettlementCollateral
    );

    burn_user(
        &ctx.accounts.token_program,
        &ctx.accounts.winning_mint,
        &ctx.accounts.user_winning,
        &ctx.accounts.owner,
        amount,
    )?;

    transfer_market_collateral(
        &ctx.accounts.token_program,
        &ctx.accounts.collateral_mint,
        &ctx.accounts.collateral_vault,
        &ctx.accounts.user_collateral,
        &ctx.accounts.market,
        &ctx.accounts.config,
        amount,
    )?;

    let receipt = &mut ctx.accounts.receipt;
    initialize_receipt_if_needed(
        receipt,
        ctx.accounts.owner.key(),
        ctx.accounts.market.key(),
        ctx.bumps.receipt,
    );

    receipt.winning_tokens_burned = receipt
        .winning_tokens_burned
        .checked_add(amount)
        .ok_or(MiladyError::MathOverflow)?;
    receipt.collateral_paid = receipt
        .collateral_paid
        .checked_add(amount)
        .ok_or(MiladyError::MathOverflow)?;
    receipt.last_claim_ts = Clock::get()?.unix_timestamp;

    emit!(WinningsRedeemed {
        market: ctx.accounts.market.key(),
        owner: ctx.accounts.owner.key(),
        winning_mint,
        tokens_burned: amount,
        collateral_paid: amount,
    });

    Ok(())
}

pub fn refund_invalid(
    ctx: Context<RefundInvalid>,
    yes_amount: u64,
    no_amount: u64,
) -> Result<()> {
    require!(
        yes_amount > 0 || no_amount > 0,
        MiladyError::ZeroAmount
    );
    require!(
        ctx.accounts.market.status == MarketStatus::Cancelled,
        MiladyError::MarketNotCancelled
    );

    if yes_amount > 0 {
        burn_user(
            &ctx.accounts.token_program,
            &ctx.accounts.yes_mint,
            &ctx.accounts.user_yes,
            &ctx.accounts.owner,
            yes_amount,
        )?;
    }

    if no_amount > 0 {
        burn_user(
            &ctx.accounts.token_program,
            &ctx.accounts.no_mint,
            &ctx.accounts.user_no,
            &ctx.accounts.owner,
            no_amount,
        )?;
    }

    let total_tokens = yes_amount
        .checked_add(no_amount)
        .ok_or(MiladyError::MathOverflow)?;
    let collateral_paid = total_tokens / 2;

    require!(collateral_paid > 0, MiladyError::RefundTooSmall);

    require!(
        ctx.accounts.collateral_vault.amount >= collateral_paid,
        MiladyError::InsufficientSettlementCollateral
    );

    transfer_market_collateral(
        &ctx.accounts.token_program,
        &ctx.accounts.collateral_mint,
        &ctx.accounts.collateral_vault,
        &ctx.accounts.user_collateral,
        &ctx.accounts.market,
        &ctx.accounts.config,
        collateral_paid,
    )?;

    let receipt = &mut ctx.accounts.receipt;
    initialize_receipt_if_needed(
        receipt,
        ctx.accounts.owner.key(),
        ctx.accounts.market.key(),
        ctx.bumps.receipt,
    );

    receipt.invalid_yes_burned = receipt
        .invalid_yes_burned
        .checked_add(yes_amount)
        .ok_or(MiladyError::MathOverflow)?;
    receipt.invalid_no_burned = receipt
        .invalid_no_burned
        .checked_add(no_amount)
        .ok_or(MiladyError::MathOverflow)?;
    receipt.collateral_paid = receipt
        .collateral_paid
        .checked_add(collateral_paid)
        .ok_or(MiladyError::MathOverflow)?;
    receipt.last_claim_ts = Clock::get()?.unix_timestamp;

    emit!(InvalidMarketRefunded {
        market: ctx.accounts.market.key(),
        owner: ctx.accounts.owner.key(),
        yes_burned: yes_amount,
        no_burned: no_amount,
        collateral_paid,
    });

    Ok(())
}

fn initialize_receipt_if_needed(
    receipt: &mut Account<SettlementReceipt>,
    owner: Pubkey,
    market: Pubkey,
    bump: u8,
) {
    if receipt.owner == Pubkey::default() {
        receipt.owner = owner;
        receipt.market = market;
        receipt.bump = bump;
    }
}

fn burn_user<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    owner: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    let cpi = Burn {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        authority: owner.to_account_info(),
    };
    token_interface::burn(
        CpiContext::new(token_program.key(), cpi),
        amount,
    )
}

fn transfer_market_collateral<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    market: &Account<'info, Market>,
    config: &Account<'info, ProtocolConfig>,
    amount: u64,
) -> Result<()> {
    let config_key = config.key();
    let market_seed = market.market_seed;
    let bump = [market.bump];
    let seeds: &[&[u8]] = &[
        b"market",
        config_key.as_ref(),
        market_seed.as_ref(),
        &bump,
    ];
    let signer: &[&[&[u8]]] = &[seeds];

    let cpi = TransferChecked {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: market.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(token_program.key(), cpi).with_signer(signer),
        amount,
        mint.decimals,
    )
}

#[derive(Accounts)]
pub struct RedeemWinnings<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
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
        has_one = collateral_vault
    )]
    pub market: Box<Account<'info, Market>>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = market.collateral_vault,
        token::mint = collateral_mint,
        token::authority = market,
        token::token_program = token_program
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        constraint =
            winning_mint.key() == market.yes_mint ||
            winning_mint.key() == market.no_mint
            @ MiladyError::InvalidWinningMint
    )]
    pub winning_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = winning_mint,
        token::authority = owner,
        token::token_program = token_program
    )]
    pub user_winning: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = owner,
        token::token_program = token_program
    )]
    pub user_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + SettlementReceipt::INIT_SPACE,
        seeds = [b"settlement", market.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub receipt: Box<Account<'info, SettlementReceipt>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundInvalid<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
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
        token::authority = owner,
        token::token_program = token_program
    )]
    pub user_yes: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = no_mint,
        token::authority = owner,
        token::token_program = token_program
    )]
    pub user_no: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = owner,
        token::token_program = token_program
    )]
    pub user_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + SettlementReceipt::INIT_SPACE,
        seeds = [b"settlement", market.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub receipt: Box<Account<'info, SettlementReceipt>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct WinningsRedeemed {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub winning_mint: Pubkey,
    pub tokens_burned: u64,
    pub collateral_paid: u64,
}

#[event]
pub struct InvalidMarketRefunded {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub yes_burned: u64,
    pub no_burned: u64,
    pub collateral_paid: u64,
}
