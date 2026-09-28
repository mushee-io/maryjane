import { AnchorProvider } from "@anchor-lang/core";
import {
  RescueCipher,
  getMXEPublicKey,
  x25519,
} from "@arcium-hq/client";
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

const DEFAULT_RPC = "https://api.devnet.solana.com";

export type ConfidentialOrderInput = {
  wallet: string;
  market: string;
  side: "YES" | "NO";
  kind: "BUY" | "SELL";
  priceBps: number;
  sharesBaseUnits: string;
};

export type ConfidentialOrderEnvelope = {
  version: 1;
  network: "solana-devnet";
  market: string;
  trader: string;
  programId: string;
  clusterOffset: number;
  computationOffset: string;
  nonceU128: string;
  clientPublicKey: number[];
  ciphertext: {
    side: number[];
    kind: number[];
    priceBps: number[];
    sharesBaseUnits: number[];
  };
  disclosure: {
    public: string[];
    encrypted: string[];
    deferred: string[];
  };
};

export type ConfidentialRuntimeStatus = {
  enabled: boolean;
  configured: boolean;
  programId: string;
  clusterOffset: number | null;
  reason: string;
};

function env(name: keyof ImportMetaEnv) {
  return String(import.meta.env[name] || "").trim();
}

function littleEndianToBigInt(bytes: Uint8Array) {
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value;
}

function randomBytes(length: number) {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

function computationOffsetString(bytes: Uint8Array) {
  return littleEndianToBigInt(bytes).toString();
}

function injectedWallet(expectedAddress: string) {
  const wallet = (window as any).solana;
  if (!wallet?.publicKey || !wallet?.signTransaction) {
    throw new Error("Connect a compatible Solana wallet before using confidential orders.");
  }
  if (wallet.publicKey.toString() !== expectedAddress) {
    throw new Error("The connected wallet changed. Reconnect and retry.");
  }
  return wallet;
}

function anchorWallet(expectedAddress: string) {
  const injected = injectedWallet(expectedAddress);
  return {
    publicKey: new PublicKey(expectedAddress),
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> =>
      injected.signTransaction(tx),
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
      if (injected.signAllTransactions) return injected.signAllTransactions(txs);
      const signed: T[] = [];
      for (const tx of txs) signed.push(await injected.signTransaction(tx));
      return signed;
    },
  };
}

export function confidentialRuntimeStatus(): ConfidentialRuntimeStatus {
  const enabled = env("VITE_CONFIDENTIAL_MARKETS") === "true";
  const programId = env("VITE_ARCIUM_PROGRAM_ID");
  const clusterText = env("VITE_ARCIUM_CLUSTER_OFFSET");
  const clusterOffset = /^\d+$/.test(clusterText) ? Number(clusterText) : null;

  if (!enabled) {
    return {
      enabled: false,
      configured: false,
      programId,
      clusterOffset,
      reason: "Confidential markets are behind VITE_CONFIDENTIAL_MARKETS.",
    };
  }

  if (!programId || clusterOffset == null) {
    return {
      enabled: true,
      configured: false,
      programId,
      clusterOffset,
      reason: "Arcium program ID or cluster offset is not configured yet.",
    };
  }

  try {
    new PublicKey(programId);
  } catch {
    return {
      enabled: true,
      configured: false,
      programId,
      clusterOffset,
      reason: "VITE_ARCIUM_PROGRAM_ID is not a valid Solana public key.",
    };
  }

  return {
    enabled: true,
    configured: true,
    programId,
    clusterOffset,
    reason: "",
  };
}

async function getMxeKeyWithRetry(
  provider: AnchorProvider,
  programId: PublicKey,
  retries = 12,
) {
  let last: unknown = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const key = await getMXEPublicKey(provider, programId);
      if (key) return key;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    last
      ? `Unable to read the Arcium MXE public key: ${String((last as any)?.message || last)}`
      : "Arcium MXE public key is not available yet.",
  );
}

/**
 * Encrypts an order in-browser against the configured Arcium MXE.
 *
 * Plaintext order fields never leave this function. The returned envelope contains
 * only ciphertext plus data that is intentionally public for routing/computation.
 *
 * This does NOT claim private SPL balances or private settlement. Those require a
 * separate confidential collateral/position state and are deliberately deferred.
 */
export async function encryptConfidentialOrder(
  input: ConfidentialOrderInput,
): Promise<ConfidentialOrderEnvelope> {
  const runtime = confidentialRuntimeStatus();
  if (!runtime.enabled) throw new Error(runtime.reason);
  if (!runtime.configured || runtime.clusterOffset == null) {
    throw new Error(runtime.reason || "Arcium is not configured.");
  }

  if (!Number.isInteger(input.priceBps) || input.priceBps <= 0 || input.priceBps >= 10_000) {
    throw new Error("Confidential limit price must be between 1 and 9,999 bps.");
  }

  const shares = BigInt(input.sharesBaseUnits);
  if (shares <= 0n) throw new Error("Confidential order size must be positive.");

  const rpc = env("VITE_SOLANA_RPC_URL") || DEFAULT_RPC;
  const connection = new Connection(rpc, "confirmed");
  const provider = new AnchorProvider(
    connection,
    anchorWallet(input.wallet) as any,
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );

  const programId = new PublicKey(runtime.programId);
  const mxePublicKey = await getMxeKeyWithRetry(provider, programId);

  const clientPrivateKey = x25519.utils.randomSecretKey();
  const clientPublicKey = x25519.getPublicKey(clientPrivateKey);
  const sharedSecret = x25519.getSharedSecret(clientPrivateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  const nonce = randomBytes(16);
  const computationOffsetBytes = randomBytes(8);

  const sideCode = input.side === "YES" ? 1n : 2n;
  const kindCode = input.kind === "BUY" ? 1n : 2n;
  const plaintext = [
    sideCode,
    kindCode,
    BigInt(input.priceBps),
    shares,
  ];
  const ciphertext = cipher.encrypt(plaintext, nonce);

  // Never persist or return clientPrivateKey/sharedSecret.
  clientPrivateKey.fill(0);

  return {
    version: 1,
    network: "solana-devnet",
    market: input.market,
    trader: input.wallet,
    programId: runtime.programId,
    clusterOffset: runtime.clusterOffset,
    computationOffset: computationOffsetString(computationOffsetBytes),
    nonceU128: littleEndianToBigInt(nonce).toString(),
    clientPublicKey: Array.from(clientPublicKey),
    ciphertext: {
      side: Array.from(ciphertext[0]),
      kind: Array.from(ciphertext[1]),
      priceBps: Array.from(ciphertext[2]),
      sharesBaseUnits: Array.from(ciphertext[3]),
    },
    disclosure: {
      public: [
        "market address",
        "signing wallet address",
        "transaction timing and fees",
        "computation existence",
        "aggregate probability snapshots after Arcium finalization",
      ],
      encrypted: [
        "YES/NO side",
        "BUY/SELL direction",
        "limit price",
        "order size",
      ],
      deferred: [
        "private USDG and outcome-token balances",
        "private settlement and redemption",
        "sender anonymity / relayed submission",
        "full confidential matching book",
      ],
    },
  };
}
