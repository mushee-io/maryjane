export type ShutterNetwork = "chiado" | "gnosis";

export type ConfidentialMarketSide = "YES" | "NO";
export type ConfidentialMarketAction = "BUY" | "SELL";

export type ShutterMarketIntent = {
  version: 1;
  chain: "solana";
  market: string;
  trader: string;
  side: ConfidentialMarketSide;
  action: ConfidentialMarketAction;
  priceBps: number;
  sharesBaseUnits: string;
  nonce: string;
  createdAt: number;
  expiresAt?: number;
};

export type ShutterTimeIdentity = {
  eon: number;
  eonKey: string;
  identity: string;
  identityPrefix: string;
  epochId?: string;
  decryptionTimestamp: number;
};

export type ShutterEncryptionData = {
  eon: number;
  eonKey: string;
  identity: string;
  identityPrefix: string;
  epochId?: string;
};

export type ShutterDecryptionKey = {
  identity: string;
  decryptionKey: string;
};

export type ConfidentialMarketEnvelope = {
  version: 1;
  scheme: "shutter-threshold-encryption";
  sourceChain: "solana";
  market: string;
  revealAt: number;
  identity: string;
  identityPrefix: string;
  eon: number;
  ciphertext: string;
  commitmentHash: string;
  createdAt: number;
};
