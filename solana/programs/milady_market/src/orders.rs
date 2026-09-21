use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    Market, MarketStatus, MiladyError, ProtocolConfig, Side, BPS_DENOMINATOR,
};

pub const MIN_ORDER_PRICE_BPS: u16 = 1;
pub const MAX_ORDER_PRICE_BPS: u16 = 9_999;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum OrderKind {
    Buy,
    Sell,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum OrderStatus {
    Active,
    Filled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PlaceOrderArgs {
    pub order_seed: [u8; 32],
    pub side: Side,
    pub kind: OrderKind,
    pub price_bps: u16,
    pub shares: u64,
}

#[account]
#[derive(InitSpace)]
pub struct LimitOrder {
    pub maker: Pubkey,
    pub market: Pubkey,
    pub order_seed: [u8; 32],
    pub side: Side,
    pub kind: OrderKind,
    pub price_bps: u16,
    pub original_shares: u64,
    pub remaining_shares: u64,
    pub escrow_mint: Pubkey,
    pub escrow_vault: Pubkey,
    pub created_at: i64,
    pub status: OrderStatus,
    pub bump: u8,
}

pub fn place_order(ctx: Context<PlaceOrder>, args: PlaceOrderArgs) -> Result<()> {
    validate_open_market(&ctx.accounts.config, &ctx.accounts.market)?;
    require!(
        args.price_bps >= MIN_ORDER_PRICE_BPS && args.price_bps <= MAX_ORDER_PRICE_BPS,
        MiladyError::InvalidOrderPrice
    );
    require!(args.shares > 0, MiladyError::ZeroAmount);

    let escrow_amount = match args.kind {
        OrderKind::Buy => {
            let quote = quote_for_shares(args.shares, args.price_bps)?;
            require!(quote > 0, MiladyError::OrderTooSmall);
            quote
        }
        OrderKind::Sell => args.shares,
    };

    transfer_user(
        &ctx.accounts.token_program,
        &ctx.accounts.escrow_mint,
        &ctx.accounts.maker_source,
        &ctx.accounts.escrow_vault,
        &ctx.accounts.maker,
        escrow_amount,
    )?;

    let order = &mut ctx.accounts.order;
    order.maker = ctx.accounts.maker.key();
    order.market = ctx.accounts.market.key();
    order.order_seed = args.order_seed;
    order.side = args.side;
    order.kind = args.kind;
    order.price_bps = args.price_bps;
    order.original_shares = args.shares;
    order.remaining_shares = args.shares;
    order.escrow_mint = ctx.accounts.escrow_mint.key();
    order.escrow_vault = ctx.accounts.escrow_vault.key();
    order.created_at = Clock::get()?.unix_timestamp;
    order.status = OrderStatus::Active;
    order.bump = ctx.bumps.order;

    emit!(LimitOrderPlaced {
        order: order.key(),
        market: order.market,
        maker: order.maker,
        side: order.side,
        kind: order.kind,
        price_bps: order.price_bps,
        shares: order.original_shares,
        escrow_amount,
    });

    Ok(())
}

pub fn fill_order(ctx: Context<FillOrder>, shares: u64) -> Result<()> {
    validate_open_market(&ctx.accounts.config, &ctx.accounts.market)?;
    require!(shares > 0, MiladyError::ZeroAmount);
    require!(
        ctx.accounts.order.status == OrderStatus::Active,
        MiladyError::OrderNotActive
    );
    require!(
        shares <= ctx.accounts.order.remaining_shares,
        MiladyError::OrderOverfill
    );

    let quote = quote_for_shares(shares, ctx.accounts.order.price_bps)?;
    require!(quote > 0, MiladyError::OrderTooSmall);

    let order_market = ctx.accounts.order.market;
    require_keys_eq!(
        order_market,
        ctx.accounts.market.key(),
        MiladyError::InvalidOrderMarket
    );

    match ctx.accounts.order.kind {
        OrderKind::Buy => {
            transfer_user(
                &ctx.accounts.token_program,
                &ctx.accounts.outcome_mint,
                &ctx.accounts.taker_outcome,
                &ctx.accounts.maker_outcome,
                &ctx.accounts.taker,
                shares,
            )?;

            transfer_order_signed(
                &ctx.accounts.token_program,
                &ctx.accounts.collateral_mint,
                &ctx.accounts.escrow_vault,
                &ctx.accounts.taker_collateral,
                &ctx.accounts.order,
                quote,
            )?;
        }
        OrderKind::Sell => {
            transfer_user(
                &ctx.accounts.token_program,
                &ctx.accounts.collateral_mint,
                &ctx.accounts.taker_collateral,
                &ctx.accounts.maker_collateral,
                &ctx.accounts.taker,
                quote,
            )?;

            transfer_order_signed(
                &ctx.accounts.token_program,
                &ctx.accounts.outcome_mint,
                &ctx.accounts.escrow_vault,
                &ctx.accounts.taker_outcome,
                &ctx.accounts.order,
                shares,
            )?;
        }
    }

    let order = &mut ctx.accounts.order;
    order.remaining_shares = order
        .remaining_shares
        .checked_sub(shares)
        .ok_or(MiladyError::MathOverflow)?;
    if order.remaining_shares == 0 {
        order.status = OrderStatus::Filled;
    }

    ctx.accounts.market.volume = ctx
        .accounts
        .market
        .volume
        .checked_add(quote)
        .ok_or(MiladyError::MathOverflow)?;

    emit!(LimitOrderFilled {
        order: order.key(),
        market: order.market,
        maker: order.maker,
        taker: ctx.accounts.taker.key(),
        side: order.side,
        kind: order.kind,
        price_bps: order.price_bps,
        shares,
        quote_amount: quote,
        remaining_shares: order.remaining_shares,
    });

    Ok(())
}

pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
    let balance = ctx.accounts.escrow_vault.amount;

    if balance > 0 {
        transfer_order_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.escrow_mint,
            &ctx.accounts.escrow_vault,
            &ctx.accounts.maker_destination,
            &ctx.accounts.order,
            balance,
        )?;
    }

    close_order_vault_signed(
        &ctx.accounts.token_program,
        &ctx.accounts.escrow_vault,
        &ctx.accounts.maker,
        &ctx.accounts.order,
    )?;

    emit!(LimitOrderCancelled {
        order: ctx.accounts.order.key(),
        market: ctx.accounts.order.market,
        maker: ctx.accounts.maker.key(),
        returned_amount: balance,
        unfilled_shares: ctx.accounts.order.remaining_shares,
    });

    Ok(())
}

pub fn quote_for_shares(shares: u64, price_bps: u16) -> Result<u64> {
    require!(
        price_bps >= MIN_ORDER_PRICE_BPS && price_bps <= MAX_ORDER_PRICE_BPS,
        MiladyError::InvalidOrderPrice
    );

    let quote = (shares as u128)
        .checked_mul(price_bps as u128)
        .ok_or(MiladyError::MathOverflow)?
        / BPS_DENOMINATOR as u128;

    u64::try_from(quote).map_err(|_| error!(MiladyError::MathOverflow))
}

fn validate_open_market(config: &ProtocolConfig, market: &Market) -> Result<()> {
    require!(!config.paused, MiladyError::ProtocolPaused);
    require!(market.status == MarketStatus::Open, MiladyError::MarketNotOpen);
    require!(
        Clock::get()?.unix_timestamp < market.close_ts,
        MiladyError::MarketClosed
    );
    Ok(())
}

fn expected_outcome_mint(market: &Market, side: Side) -> Pubkey {
    match side {
        Side::Yes => market.yes_mint,
        Side::No => market.no_mint,
    }
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

fn transfer_order_signed<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    order: &Account<'info, LimitOrder>,
    amount: u64,
) -> Result<()> {
    let market_key = order.market;
    let maker_key = order.maker;
    let bump = [order.bump];
    let seeds: &[&[u8]] = &[
        b"order",
        market_key.as_ref(),
        maker_key.as_ref(),
        order.order_seed.as_ref(),
        &bump,
    ];
    let signer: &[&[&[u8]]] = &[seeds];

    let cpi = TransferChecked {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: order.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(token_program.key(), cpi).with_signer(signer),
        amount,
        mint.decimals,
    )
}

fn close_order_vault_signed<'info>(
    token_program: &Interface<'info, TokenInterface>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    maker: &Signer<'info>,
    order: &Account<'info, LimitOrder>,
) -> Result<()> {
    let market_key = order.market;
    let maker_key = order.maker;
    let bump = [order.bump];
    let seeds: &[&[u8]] = &[
        b"order",
        market_key.as_ref(),
        maker_key.as_ref(),
        order.order_seed.as_ref(),
        &bump,
    ];
    let signer: &[&[&[u8]]] = &[seeds];

    let cpi = CloseAccount {
        account: vault.to_account_info(),
        destination: maker.to_account_info(),
        authority: order.to_account_info(),
    };
    token_interface::close_account(
        CpiContext::new(token_program.key(), cpi).with_signer(signer),
    )
}

#[derive(Accounts)]
#[instruction(args: PlaceOrderArgs)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        seeds = [b"market", config.key().as_ref(), market.market_seed.as_ref()],
        bump = market.bump,
        has_one = collateral_mint,
        has_one = yes_mint,
        has_one = no_mint
    )]
    pub market: Account<'info, Market>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(address = market.yes_mint)]
    pub yes_mint: InterfaceAccount<'info, Mint>,
    #[account(address = market.no_mint)]
    pub no_mint: InterfaceAccount<'info, Mint>,
    #[account(
        constraint =
            (args.kind == OrderKind::Buy && escrow_mint.key() == collateral_mint.key()) ||
            (args.kind == OrderKind::Sell && args.side == Side::Yes && escrow_mint.key() == yes_mint.key()) ||
            (args.kind == OrderKind::Sell && args.side == Side::No && escrow_mint.key() == no_mint.key())
            @ MiladyError::InvalidOrderMint
    )]
    pub escrow_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = escrow_mint,
        token::authority = maker,
        token::token_program = token_program
    )]
    pub maker_source: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = maker,
        space = 8 + LimitOrder::INIT_SPACE,
        seeds = [
            b"order",
            market.key().as_ref(),
            maker.key().as_ref(),
            args.order_seed.as_ref()
        ],
        bump
    )]
    pub order: Account<'info, LimitOrder>,
    #[account(
        init,
        payer = maker,
        token::mint = escrow_mint,
        token::authority = order,
        token::token_program = token_program,
        seeds = [b"order-vault", order.key().as_ref()],
        bump
    )]
    pub escrow_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FillOrder<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        seeds = [b"market", config.key().as_ref(), market.market_seed.as_ref()],
        bump = market.bump,
        has_one = collateral_mint
    )]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [
            b"order",
            market.key().as_ref(),
            order.maker.as_ref(),
            order.order_seed.as_ref()
        ],
        bump = order.bump,
        has_one = market,
        has_one = escrow_vault
    )]
    pub order: Account<'info, LimitOrder>,
    /// CHECK: constrained to the maker stored in the order.
    #[account(address = order.maker)]
    pub maker: UncheckedAccount<'info>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(
        constraint = outcome_mint.key() == expected_outcome_mint(&market, order.side)
            @ MiladyError::InvalidOrderMint
    )]
    pub outcome_mint: InterfaceAccount<'info, Mint>,
    #[account(address = order.escrow_mint)]
    pub escrow_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        address = order.escrow_vault,
        token::mint = escrow_mint,
        token::authority = order,
        token::token_program = token_program
    )]
    pub escrow_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = taker,
        token::token_program = token_program
    )]
    pub taker_collateral: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = outcome_mint,
        token::authority = taker,
        token::token_program = token_program
    )]
    pub taker_outcome: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = maker,
        token::token_program = token_program
    )]
    pub maker_collateral: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = outcome_mint,
        token::authority = maker,
        token::token_program = token_program
    )]
    pub maker_outcome: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    #[account(
        mut,
        close = maker,
        has_one = maker,
        has_one = escrow_vault
    )]
    pub order: Account<'info, LimitOrder>,
    #[account(address = order.escrow_mint)]
    pub escrow_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        address = order.escrow_vault,
        token::mint = escrow_mint,
        token::authority = order,
        token::token_program = token_program
    )]
    pub escrow_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = escrow_mint,
        token::authority = maker,
        token::token_program = token_program
    )]
    pub maker_destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct LimitOrderPlaced {
    pub order: Pubkey,
    pub market: Pubkey,
    pub maker: Pubkey,
    pub side: Side,
    pub kind: OrderKind,
    pub price_bps: u16,
    pub shares: u64,
    pub escrow_amount: u64,
}

#[event]
pub struct LimitOrderFilled {
    pub order: Pubkey,
    pub market: Pubkey,
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub side: Side,
    pub kind: OrderKind,
    pub price_bps: u16,
    pub shares: u64,
    pub quote_amount: u64,
    pub remaining_shares: u64,
}

#[event]
pub struct LimitOrderCancelled {
    pub order: Pubkey,
    pub market: Pubkey,
    pub maker: Pubkey,
    pub returned_amount: u64,
    pub unfilled_shares: u64,
}
