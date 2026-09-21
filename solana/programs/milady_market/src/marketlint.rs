use anchor_lang::prelude::*;

use crate::{MiladyError, ProtocolConfig};

pub const MARKETLINT_MAX_TTL_SECS: i64 = 7 * 24 * 60 * 60;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketLintVerdict {
    Green,
    Yellow,
    Red,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct CertifyMarketArgs {
    pub market_seed: [u8; 32],
    pub creator: Pubkey,
    pub question_hash: [u8; 32],
    pub metadata_hash: [u8; 32],
    pub spec_hash: [u8; 32],
    pub report_hash: [u8; 32],
    pub source_hash: [u8; 32],
    pub close_ts: i64,
    pub resolution_ts: i64,
    pub overall_score: u8,
    pub verdict: MarketLintVerdict,
    pub ambiguity_score: u8,
    pub duplicate_probability: u8,
    pub resolution_clarity_score: u8,
    pub expires_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct MarketLintConfig {
    pub authority: Pubkey,
    pub attestor: Pubkey,
    pub min_score: u8,
    pub max_duplicate_probability: u8,
    pub min_resolution_clarity_score: u8,
    pub require_green: bool,
    pub enabled: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MarketLintCertification {
    pub market_seed: [u8; 32],
    pub creator: Pubkey,
    pub attestor: Pubkey,
    pub question_hash: [u8; 32],
    pub metadata_hash: [u8; 32],
    pub spec_hash: [u8; 32],
    pub report_hash: [u8; 32],
    pub source_hash: [u8; 32],
    pub close_ts: i64,
    pub resolution_ts: i64,
    pub overall_score: u8,
    pub verdict: MarketLintVerdict,
    pub ambiguity_score: u8,
    pub duplicate_probability: u8,
    pub resolution_clarity_score: u8,
    pub issued_at: i64,
    pub expires_at: i64,
    pub consumed: bool,
    pub market: Pubkey,
    pub bump: u8,
}

pub fn initialize_marketlint_config(
    ctx: Context<InitializeMarketLintConfig>,
    attestor: Pubkey,
    min_score: u8,
    max_duplicate_probability: u8,
    min_resolution_clarity_score: u8,
    require_green: bool,
) -> Result<()> {
    validate_thresholds(
        attestor,
        min_score,
        max_duplicate_probability,
        min_resolution_clarity_score,
    )?;

    let config = &mut ctx.accounts.marketlint_config;
    config.authority = ctx.accounts.authority.key();
    config.attestor = attestor;
    config.min_score = min_score;
    config.max_duplicate_probability = max_duplicate_probability;
    config.min_resolution_clarity_score = min_resolution_clarity_score;
    config.require_green = require_green;
    config.enabled = true;
    config.bump = ctx.bumps.marketlint_config;

    emit!(MarketLintConfigInitialized {
        authority: config.authority,
        attestor,
        min_score,
        max_duplicate_probability,
        min_resolution_clarity_score,
        require_green,
    });

    Ok(())
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
    validate_thresholds(
        attestor,
        min_score,
        max_duplicate_probability,
        min_resolution_clarity_score,
    )?;

    let config = &mut ctx.accounts.marketlint_config;
    config.attestor = attestor;
    config.min_score = min_score;
    config.max_duplicate_probability = max_duplicate_probability;
    config.min_resolution_clarity_score = min_resolution_clarity_score;
    config.require_green = require_green;
    config.enabled = enabled;

    emit!(MarketLintConfigUpdated {
        authority: config.authority,
        attestor,
        min_score,
        max_duplicate_probability,
        min_resolution_clarity_score,
        require_green,
        enabled,
    });

    Ok(())
}

pub fn certify_market(ctx: Context<CertifyMarket>, args: CertifyMarketArgs) -> Result<()> {
    require!(
        ctx.accounts.marketlint_config.enabled,
        MiladyError::MarketLintDisabled
    );
    require_keys_eq!(
        ctx.accounts.attestor.key(),
        ctx.accounts.marketlint_config.attestor,
        MiladyError::InvalidMarketLintAttestor
    );
    require!(
        args.overall_score <= 100
            && args.ambiguity_score <= 100
            && args.duplicate_probability <= 100
            && args.resolution_clarity_score <= 100,
        MiladyError::InvalidMarketLintScore
    );
    require!(
        args.overall_score >= ctx.accounts.marketlint_config.min_score,
        MiladyError::MarketLintScoreTooLow
    );
    require!(
        args.duplicate_probability
            <= ctx.accounts.marketlint_config.max_duplicate_probability,
        MiladyError::MarketLintDuplicateRiskTooHigh
    );
    require!(
        args.resolution_clarity_score
            >= ctx.accounts.marketlint_config.min_resolution_clarity_score,
        MiladyError::MarketLintResolutionClarityTooLow
    );
    if ctx.accounts.marketlint_config.require_green {
        require!(
            args.verdict == MarketLintVerdict::Green,
            MiladyError::MarketLintVerdictRejected
        );
    }

    let now = Clock::get()?.unix_timestamp;
    require!(args.close_ts > now, MiladyError::InvalidCloseTime);
    require!(
        args.resolution_ts >= args.close_ts,
        MiladyError::InvalidResolutionTime
    );
    require!(args.expires_at > now, MiladyError::MarketLintCertificationExpired);
    require!(
        args.expires_at
            .checked_sub(now)
            .ok_or(MiladyError::MathOverflow)?
            <= MARKETLINT_MAX_TTL_SECS,
        MiladyError::MarketLintCertificationTtlTooLong
    );

    let certification = &mut ctx.accounts.certification;
    require!(
        certification.creator == Pubkey::default() || !certification.consumed,
        MiladyError::MarketLintCertificationConsumed
    );

    certification.market_seed = args.market_seed;
    certification.creator = args.creator;
    certification.attestor = ctx.accounts.attestor.key();
    certification.question_hash = args.question_hash;
    certification.metadata_hash = args.metadata_hash;
    certification.spec_hash = args.spec_hash;
    certification.report_hash = args.report_hash;
    certification.source_hash = args.source_hash;
    certification.close_ts = args.close_ts;
    certification.resolution_ts = args.resolution_ts;
    certification.overall_score = args.overall_score;
    certification.verdict = args.verdict;
    certification.ambiguity_score = args.ambiguity_score;
    certification.duplicate_probability = args.duplicate_probability;
    certification.resolution_clarity_score = args.resolution_clarity_score;
    certification.issued_at = now;
    certification.expires_at = args.expires_at;
    certification.consumed = false;
    certification.market = Pubkey::default();
    certification.bump = ctx.bumps.certification;

    emit!(MarketLintCertificationIssued {
        certification: certification.key(),
        creator: certification.creator,
        attestor: certification.attestor,
        market_seed: certification.market_seed,
        report_hash: certification.report_hash,
        spec_hash: certification.spec_hash,
        source_hash: certification.source_hash,
        close_ts: certification.close_ts,
        resolution_ts: certification.resolution_ts,
        overall_score: certification.overall_score,
        verdict: certification.verdict,
        duplicate_probability: certification.duplicate_probability,
        resolution_clarity_score: certification.resolution_clarity_score,
        expires_at: certification.expires_at,
    });

    Ok(())
}

pub fn validate_certification_for_market(
    config: &Account<MarketLintConfig>,
    certification: &Account<MarketLintCertification>,
    creator: Pubkey,
    market_seed: [u8; 32],
    question_hash: [u8; 32],
    metadata_hash: [u8; 32],
    close_ts: i64,
    resolution_ts: i64,
) -> Result<()> {
    require!(config.enabled, MiladyError::MarketLintDisabled);
    require!(!certification.consumed, MiladyError::MarketLintCertificationConsumed);
    require_keys_eq!(
        certification.creator,
        creator,
        MiladyError::MarketLintCreatorMismatch
    );
    require_keys_eq!(
        certification.attestor,
        config.attestor,
        MiladyError::MarketLintAttestorRotated
    );
    require!(
        certification.market_seed == market_seed,
        MiladyError::MarketLintMarketSeedMismatch
    );
    require!(
        certification.question_hash == question_hash,
        MiladyError::MarketLintQuestionHashMismatch
    );
    require!(
        certification.metadata_hash == metadata_hash,
        MiladyError::MarketLintMetadataHashMismatch
    );
    require!(
        certification.close_ts == close_ts,
        MiladyError::MarketLintCloseTimeMismatch
    );
    require!(
        certification.resolution_ts == resolution_ts,
        MiladyError::MarketLintResolutionTimeMismatch
    );
    require!(
        certification.expires_at >= Clock::get()?.unix_timestamp,
        MiladyError::MarketLintCertificationExpired
    );
    require!(
        certification.overall_score >= config.min_score,
        MiladyError::MarketLintScoreTooLow
    );
    require!(
        certification.duplicate_probability <= config.max_duplicate_probability,
        MiladyError::MarketLintDuplicateRiskTooHigh
    );
    require!(
        certification.resolution_clarity_score >= config.min_resolution_clarity_score,
        MiladyError::MarketLintResolutionClarityTooLow
    );
    if config.require_green {
        require!(
            certification.verdict == MarketLintVerdict::Green,
            MiladyError::MarketLintVerdictRejected
        );
    }

    Ok(())
}

fn validate_thresholds(
    attestor: Pubkey,
    min_score: u8,
    max_duplicate_probability: u8,
    min_resolution_clarity_score: u8,
) -> Result<()> {
    require!(attestor != Pubkey::default(), MiladyError::InvalidMarketLintAttestor);
    require!(
        min_score <= 100
            && max_duplicate_probability <= 100
            && min_resolution_clarity_score <= 100,
        MiladyError::InvalidMarketLintScore
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeMarketLintConfig<'info> {
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
        space = 8 + MarketLintConfig::INIT_SPACE,
        seeds = [b"marketlint-config"],
        bump
    )]
    pub marketlint_config: Account<'info, MarketLintConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMarketLintConfig<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"marketlint-config"],
        bump = marketlint_config.bump,
        has_one = authority @ MiladyError::Unauthorized
    )]
    pub marketlint_config: Account<'info, MarketLintConfig>,
}

#[derive(Accounts)]
#[instruction(args: CertifyMarketArgs)]
pub struct CertifyMarket<'info> {
    #[account(mut)]
    pub attestor: Signer<'info>,
    #[account(
        seeds = [b"marketlint-config"],
        bump = marketlint_config.bump
    )]
    pub marketlint_config: Account<'info, MarketLintConfig>,
    #[account(
        init_if_needed,
        payer = attestor,
        space = 8 + MarketLintCertification::INIT_SPACE,
        seeds = [b"marketlint-cert", args.market_seed.as_ref()],
        bump
    )]
    pub certification: Account<'info, MarketLintCertification>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct MarketLintConfigInitialized {
    pub authority: Pubkey,
    pub attestor: Pubkey,
    pub min_score: u8,
    pub max_duplicate_probability: u8,
    pub min_resolution_clarity_score: u8,
    pub require_green: bool,
}

#[event]
pub struct MarketLintConfigUpdated {
    pub authority: Pubkey,
    pub attestor: Pubkey,
    pub min_score: u8,
    pub max_duplicate_probability: u8,
    pub min_resolution_clarity_score: u8,
    pub require_green: bool,
    pub enabled: bool,
}

#[event]
pub struct MarketLintCertificationIssued {
    pub certification: Pubkey,
    pub creator: Pubkey,
    pub attestor: Pubkey,
    pub market_seed: [u8; 32],
    pub report_hash: [u8; 32],
    pub spec_hash: [u8; 32],
    pub source_hash: [u8; 32],
    pub close_ts: i64,
    pub resolution_ts: i64,
    pub overall_score: u8,
    pub verdict: MarketLintVerdict,
    pub duplicate_probability: u8,
    pub resolution_clarity_score: u8,
    pub expires_at: i64,
}

#[event]
pub struct MarketLintCertificationConsumed {
    pub certification: Pubkey,
    pub market: Pubkey,
    pub report_hash: [u8; 32],
    pub spec_hash: [u8; 32],
    pub overall_score: u8,
    pub verdict: MarketLintVerdict,
}
