//! Mary Jane confidential prediction-order rail powered by Arcium.
//!
//! This program deliberately lives beside the existing public prediction-market
//! program. It does not change Mary Jane's public order book or settlement.
//!
//! Privacy boundary for v1:
//! - encrypted in MPC: side, buy/sell direction, limit price, order size
//! - public by design: public market address, signer wallet, tx timing/fees,
//!   computation existence, aggregate YES/NO pressure snapshots
//! - not private yet: SPL token balances, settlement/redemption, sender identity
//!
//! Encrypted state layout:
//! 8 discriminator + 1 bump + 32 public market + 32 authority + 16 state nonce
//! = 89 byte offset, followed by 3 x 32-byte Arcium ciphertexts.

use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

const COMP_DEF_OFFSET_INIT_CONFIDENTIAL_STATE: u32 =
    comp_def_offset("init_confidential_state");
const COMP_DEF_OFFSET_APPLY_PRIVATE_ORDER: u32 =
    comp_def_offset("apply_private_order");
const COMP_DEF_OFFSET_REVEAL_AGGREGATE: u32 =
    comp_def_offset("reveal_aggregate");

const ENCRYPTED_STATE_OFFSET: u32 = 89;
const ENCRYPTED_STATE_SIZE: u32 = 32 * 3;

declare_id!("DGcYT9EVrrwMGEnUcYiPUhrfzvGBjNFZ7t619BWWPn99");

#[arcium_program]
pub mod maryjane_confidential {
    use super::*;

    pub fn init_confidential_state_comp_def(
        ctx: Context<InitConfidentialStateCompDef>,
    ) -> Result<()> {
        init_computation_def(ctx.accounts, None)?;
        Ok(())
    }

    pub fn init_apply_private_order_comp_def(
        ctx: Context<InitApplyPrivateOrderCompDef>,
    ) -> Result<()> {
        init_computation_def(ctx.accounts, None)?;
        Ok(())
    }

    pub fn init_reveal_aggregate_comp_def(
        ctx: Context<InitRevealAggregateCompDef>,
    ) -> Result<()> {
        init_computation_def(ctx.accounts, None)?;
        Ok(())
    }

    /// Creates encrypted Arcium state for one already-existing public Mary Jane market.
    pub fn create_confidential_market(
        ctx: Context<CreateConfidentialMarket>,
        computation_offset: u64,
        public_market: Pubkey,
    ) -> Result<()> {
        let confidential_market = &mut ctx.accounts.confidential_market;
        confidential_market.bump = ctx.bumps.confidential_market;
        confidential_market.public_market = public_market;
        confidential_market.authority = ctx.accounts.authority.key();
        confidential_market.state_nonce = 0;
        confidential_market.encrypted_state = [[0u8; 32]; 3];
        confidential_market.public_yes_bps = 5_000;
        confidential_market.order_count = 0;
        confidential_market.last_snapshot_ts = 0;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            ArgBuilder::new().build(),
            vec![InitConfidentialStateCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.confidential_market.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_confidential_state")]
    pub fn init_confidential_state_callback(
        ctx: Context<InitConfidentialStateCallback>,
        output: SignedComputationOutputs<InitConfidentialStateOutput>,
    ) -> Result<()> {
        let state = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(InitConfidentialStateOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let confidential_market = &mut ctx.accounts.confidential_market;
        confidential_market.encrypted_state = state.ciphertexts;
        confidential_market.state_nonce = state.nonce;

        emit!(ConfidentialMarketCreated {
            confidential_market: confidential_market.key(),
            public_market: confidential_market.public_market,
            authority: confidential_market.authority,
        });

        Ok(())
    }

    /// Queues one encrypted order. The transaction signer remains public, but the
    /// side/direction/price/size never appear in plaintext instruction data.
    pub fn submit_private_order(
        ctx: Context<SubmitPrivateOrder>,
        computation_offset: u64,
        encrypted_side: [u8; 32],
        encrypted_kind: [u8; 32],
        encrypted_price_bps: [u8; 32],
        encrypted_shares: [u8; 32],
        client_pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let state_nonce = ctx.accounts.confidential_market.state_nonce;
        let args = ArgBuilder::new()
            .x25519_pubkey(client_pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(encrypted_side)
            .encrypted_u64(encrypted_kind)
            .encrypted_u64(encrypted_price_bps)
            .encrypted_u64(encrypted_shares)
            .plaintext_u128(state_nonce)
            .account(
                ctx.accounts.confidential_market.key(),
                ENCRYPTED_STATE_OFFSET,
                ENCRYPTED_STATE_SIZE,
            )
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![ApplyPrivateOrderCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.confidential_market.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
            0,
        )?;

        emit!(ConfidentialOrderQueued {
            confidential_market: ctx.accounts.confidential_market.key(),
            public_market: ctx.accounts.confidential_market.public_market,
            trader: ctx.accounts.trader.key(),
            computation_offset,
        });

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "apply_private_order")]
    pub fn apply_private_order_callback(
        ctx: Context<ApplyPrivateOrderCallback>,
        output: SignedComputationOutputs<ApplyPrivateOrderOutput>,
    ) -> Result<()> {
        let state = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(ApplyPrivateOrderOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let confidential_market = &mut ctx.accounts.confidential_market;
        confidential_market.encrypted_state = state.ciphertexts;
        confidential_market.state_nonce = state.nonce;
        confidential_market.order_count = confidential_market
            .order_count
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;

        emit!(ConfidentialOrderFinalized {
            confidential_market: confidential_market.key(),
            public_market: confidential_market.public_market,
            order_count: confidential_market.order_count,
        });

        Ok(())
    }

    /// Anyone may pay to refresh the public aggregate snapshot. The computation
    /// reveals only aggregate pressure + count, never individual orders.
    pub fn refresh_public_snapshot(
        ctx: Context<RefreshPublicSnapshot>,
        computation_offset: u64,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let state_nonce = ctx.accounts.confidential_market.state_nonce;
        let args = ArgBuilder::new()
            .plaintext_u128(state_nonce)
            .account(
                ctx.accounts.confidential_market.key(),
                ENCRYPTED_STATE_OFFSET,
                ENCRYPTED_STATE_SIZE,
            )
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![RevealAggregateCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.confidential_market.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "reveal_aggregate")]
    pub fn reveal_aggregate_callback(
        ctx: Context<RevealAggregateCallback>,
        output: SignedComputationOutputs<RevealAggregateOutput>,
    ) -> Result<()> {
        let (yes_pressure, no_pressure, order_count) = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(RevealAggregateOutput {
                field_0:
                    RevealAggregateOutputStruct0 {
                        field_0: yes_pressure,
                        field_1: no_pressure,
                        field_2: order_count,
                    },
            }) => (yes_pressure, no_pressure, order_count),
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let total = yes_pressure
            .checked_add(no_pressure)
            .ok_or(ErrorCode::MathOverflow)?;
        let yes_bps = if total == 0 {
            5_000
        } else {
            (((yes_pressure as u128) * 10_000u128) / (total as u128)) as u16
        };

        let confidential_market = &mut ctx.accounts.confidential_market;
        confidential_market.public_yes_bps = yes_bps;
        confidential_market.order_count = order_count;
        confidential_market.last_snapshot_ts = Clock::get()?.unix_timestamp;

        emit!(ConfidentialSnapshotPublished {
            confidential_market: confidential_market.key(),
            public_market: confidential_market.public_market,
            yes_bps,
            order_count,
            snapshot_ts: confidential_market.last_snapshot_ts,
        });

        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct ConfidentialMarket {
    pub bump: u8,
    pub public_market: Pubkey,
    pub authority: Pubkey,
    pub state_nonce: u128,
    pub encrypted_state: [[u8; 32]; 3],
    pub public_yes_bps: u16,
    pub order_count: u64,
    pub last_snapshot_ts: i64,
}

#[queue_computation_accounts("init_confidential_state", authority)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, public_market: Pubkey)]
pub struct CreateConfidentialMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + ConfidentialMarket::INIT_SPACE,
        seeds = [b"confidential-market", public_market.as_ref()],
        bump,
    )]
    pub confidential_market: Box<Account<'info, ConfidentialMarket>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = authority,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account))]
    /// CHECK: checked by Arcium.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account))]
    /// CHECK: checked by Arcium.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account))]
    /// CHECK: checked by Arcium.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_CONFIDENTIAL_STATE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("init_confidential_state")]
#[derive(Accounts)]
pub struct InitConfidentialStateCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_CONFIDENTIAL_STATE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: constrained by Arcium callback verification.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: instructions sysvar address constrained above.
    pub instructions_sysvar: UncheckedAccount<'info>,
    #[account(mut)]
    pub confidential_market: Account<'info, ConfidentialMarket>,
}

#[queue_computation_accounts("apply_private_order", trader)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct SubmitPrivateOrder<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(mut)]
    pub confidential_market: Box<Account<'info, ConfidentialMarket>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = trader,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account))]
    /// CHECK: checked by Arcium.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account))]
    /// CHECK: checked by Arcium.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account))]
    /// CHECK: checked by Arcium.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_APPLY_PRIVATE_ORDER))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("apply_private_order")]
#[derive(Accounts)]
pub struct ApplyPrivateOrderCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_APPLY_PRIVATE_ORDER))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: constrained by Arcium callback verification.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: instructions sysvar address constrained above.
    pub instructions_sysvar: UncheckedAccount<'info>,
    #[account(mut)]
    pub confidential_market: Account<'info, ConfidentialMarket>,
}

#[queue_computation_accounts("reveal_aggregate", keeper)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RefreshPublicSnapshot<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(mut)]
    pub confidential_market: Box<Account<'info, ConfidentialMarket>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = keeper,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account))]
    /// CHECK: checked by Arcium.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account))]
    /// CHECK: checked by Arcium.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account))]
    /// CHECK: checked by Arcium.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_AGGREGATE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("reveal_aggregate")]
#[derive(Accounts)]
pub struct RevealAggregateCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_AGGREGATE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: constrained by Arcium callback verification.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: instructions sysvar address constrained above.
    pub instructions_sysvar: UncheckedAccount<'info>,
    #[account(mut)]
    pub confidential_market: Account<'info, ConfidentialMarket>,
}

#[init_computation_definition_accounts("init_confidential_state", payer)]
#[derive(Accounts)]
pub struct InitConfidentialStateCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: checked by Arcium.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by Arcium.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lookup table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("apply_private_order", payer)]
#[derive(Accounts)]
pub struct InitApplyPrivateOrderCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: checked by Arcium.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by Arcium.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lookup table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("reveal_aggregate", payer)]
#[derive(Accounts)]
pub struct InitRevealAggregateCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: checked by Arcium.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by Arcium.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lookup table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct ConfidentialMarketCreated {
    pub confidential_market: Pubkey,
    pub public_market: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct ConfidentialOrderQueued {
    pub confidential_market: Pubkey,
    pub public_market: Pubkey,
    pub trader: Pubkey,
    pub computation_offset: u64,
}

#[event]
pub struct ConfidentialOrderFinalized {
    pub confidential_market: Pubkey,
    pub public_market: Pubkey,
    pub order_count: u64,
}

#[event]
pub struct ConfidentialSnapshotPublished {
    pub confidential_market: Pubkey,
    pub public_market: Pubkey,
    pub yes_bps: u16,
    pub order_count: u64,
    pub snapshot_ts: i64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Arcium computation was aborted")]
    AbortedComputation,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
