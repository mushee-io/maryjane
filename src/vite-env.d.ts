/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ADMOB_APP_ID?: string;
  readonly VITE_ADMOB_REWARDED_UNIT_ID?: string;
  readonly VITE_CONFIDENTIAL_MARKETS?: string;
  readonly VITE_ARCIUM_PROGRAM_ID?: string;
  readonly VITE_ARCIUM_CLUSTER_OFFSET?: string;
  readonly VITE_SOLANA_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
