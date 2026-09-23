import { Buffer } from "buffer";
import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Banknote,
  CircleDollarSign,
  Gauge,
  Landmark,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

const RPC_URL = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("BS3vTdhrkK5zHchx92PFGeodckt1dLzf7i9uJyEsmZst");
const PROTOCOL = new PublicKey("ACszf63tCaLrk11goAU4FLsZyuXq1xznbHsS4SMmSvWc");
const USDG_MINT = new PublicKey("H9fWLuVzqjWjkFjsZ8hSYUb3fGGofa4XHtwCSxQbP9PS");
const LENDING_POOL = new PublicKey("Gkxt6cQjhrqD6CoXLC3TabNxPB1fDYfru1xsTPD1rsru");
const LIQUIDITY_VAULT = new PublicKey("77SvAEarM7aXgvN2TV8Hw4Nd4Dy4oQ3Brv9TM2y9HUPN");
const SOL_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

function instructionDisc(hex: string) {
  return Buffer.from(hex, "hex");
}
function u64(value: bigint) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}
function parseAmount(value: string) {
  const text = value.trim();
  if (!/^\\d+(?:\\.\\d{0,6})?$/.test(text)) {
    throw new Error("Amount must be a positive number with at most 6 decimals");
  }
  const [whole, frac = ""] = text.split(".");
  const raw = BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  if (raw <= 0n) throw new Error("Amount must be greater than zero");
  return raw;
}
function formatRaw(value: bigint) {
  return Number(value) / 1_000_000;
}
function deriveCredit(owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("credit"), owner.toBuffer()],
    PROGRAM_ID,
  )[0];
}
function deriveSupplier(owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("supplier"), LENDING_POOL.toBuffer(), owner.toBuffer()],
    PROGRAM_ID,
  )[0];
}
function deriveVault(credit: PublicKey, market: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), credit.toBuffer(), market.toBuffer()],
    PROGRAM_ID,
  )[0];
}
function deriveFaucet(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("faucet"), mint.toBuffer()],
    PROGRAM_ID,
  )[0];
}
function deriveClaim(owner: PublicKey, mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), owner.toBuffer(), mint.toBuffer()],
    PROGRAM_ID,
  )[0];
}
async function rawTokenBalance(connection: Connection, address: PublicKey) {
  try {
    return BigInt((await connection.getTokenAccountBalance(address, "confirmed")).value.amount);
  } catch {
    return 0n;
  }
}
function decodeCredit(data: Buffer | null) {
  if (!data || data.length < 76) return null;
  let offset = 40;
  const debt = data.readBigUInt64LE(offset);
  offset = 72;
  const count = data.readUInt32LE(offset);
  offset += 4 + count * 40;
  if (offset + 32 > data.length) {
    return { debt, collateralValue: 0n, borrowLimit: 0n, liquidationCapacity: 0n, health: 0n };
  }
  const collateralValue = data.readBigUInt64LE(offset); offset += 8;
  const borrowLimit = data.readBigUInt64LE(offset); offset += 8;
  const liquidationCapacity = data.readBigUInt64LE(offset); offset += 8;
  const health = data.readBigUInt64LE(offset);
  return { debt, collateralValue, borrowLimit, liquidationCapacity, health };
}
function decodeSupplier(data: Buffer | null) {
  if (!data || data.length < 80) return 0n;
  return data.readBigUInt64LE(72);
}
async function findSolxMarket(connection: Connection) {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, "confirmed");
  for (const row of accounts) {
    const data = Buffer.from(row.account.data);
    if (data.length < 150) continue;
    const symbol = data.subarray(72, 80).toString("utf8").replace(/\\0+$/g, "");
    if (symbol !== "SOLx") continue;
    return {
      address: row.pubkey,
      mint: new PublicKey(data.subarray(40, 72)),
      ltvBps: data.readUInt16LE(113),
      liquidationThresholdBps: data.readUInt16LE(115),
    };
  }
  throw new Error("SOLx market is not initialized on Devnet");
}
async function fetchPythSol() {
  const response = await fetch("/api/pyth-sol", { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      configured: response.status !== 503,
      price: null as number | null,
      updateData: null as string[] | null,
      error: data?.error || "Pyth unavailable",
    };
  }
  return {
    configured: true,
    price: Number(data.price),
    updateData: data.updateData as string[],
    error: "",
  };
}

type MiladyState = {
  network: string;
  programId: string;
  programLive: boolean;
  protocol: string;
  usdgMint: string;
  lendingPool: string;
  liquidityVault: string;
  poolUsdg: number;
  solx: {
    market: string;
    mint: string;
    ltvBps: number;
    liquidationThresholdBps: number;
    walletBalance?: number;
    deposited?: number;
  };
  oracle: {
    price: number | null;
    configured: boolean;
  };
  wallet?: {
    address: string;
    sol: number;
    usdg: number;
    credit: string;
    creditExists: boolean;
    supplier: string;
    suppliedUsdg: number;
  };
  credit?: {
    debt: number;
    collateralValue: number;
    borrowLimit: number;
    availableToBorrow: number;
    liquidationCapacity: number;
    healthFactor: number | null;
  };
};

function provider() {
  return (window as any).solana;
}

function short(value: string, left = 6, right = 5) {
  return value.length > left + right + 1
    ? `${value.slice(0, left)}…${value.slice(-right)}`
    : value;
}

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 2 : 4,
  }).format(value);
}

function qty(value: number | null | undefined, digits = 4) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function FortyFourMiladyScreen() {
  const [wallet, setWallet] = useState("");
  const [state, setState] = useState<MiladyState | null>(null);
  const [mode, setMode] = useState<"BORROW" | "SUPPLY">("BORROW");
  const [depositAmount, setDepositAmount] = useState("10");
  const [borrowAmount, setBorrowAmount] = useState("100");
  const [supplyAmount, setSupplyAmount] = useState("100");
  const [repayAmount, setRepayAmount] = useState("100");
  const [withdrawAmount, setWithdrawAmount] = useState("1");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastSignature, setLastSignature] = useState("");

  const loadState = async (walletAddress = wallet) => {
    const url = walletAddress
      ? `/api/v1/44-milady/state?wallet=${encodeURIComponent(walletAddress)}`
      : "/api/v1/44-milady/state";
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || "Unable to load 44 Milady state");
    setState(data);
    return data as MiladyState;
  };

  const connect = async () => {
    const p = provider();
    if (!p?.connect) {
      setError("A Solana wallet such as Phantom is required.");
      return;
    }
    setError("");
    const result = await p.connect();
    const address = result.publicKey.toString();
    setWallet(address);
    await loadState(address);
  };

  const refresh = async () => {
    setBusy("refresh");
    try {
      setError("");
      await loadState();
    } catch (e: any) {
      setError(e?.message || "Refresh failed");
    } finally {
      setBusy("");
    }
  };

  const signAndSendLegacy = async (transactionBase64: string) => {
    const p = provider();
    if (!p?.signTransaction) throw new Error("Connected wallet does not support transaction signing");
    const connection = new Connection(RPC_URL, "confirmed");
    const tx = Transaction.from(decodeBase64(transactionBase64));
    const signed = await p.signTransaction(tx);
    const signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(signature, "confirmed");
    return signature;
  };

  const sendAction = async (action: string, amount?: string) => {
    if (!wallet) return connect();
    setBusy(action);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/v1/44-milady/build-transaction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, action, amount }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Unable to build transaction");
      const signature = await signAndSendLegacy(data.transactionBase64);
      setLastSignature(signature);
      setMessage(`${action} confirmed on Solana Devnet`);
      await loadState(wallet);
    } catch (e: any) {
      setError(e?.message || "Transaction failed");
    } finally {
      setBusy("");
    }
  };

  const borrow = async () => {
    if (!wallet) return connect();
    setBusy("borrow");
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/v1/44-milady/build-borrow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, amount: borrowAmount }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Unable to prepare Pyth-backed borrow");

      const p = provider();
      if (!p?.signTransaction) throw new Error("Connected wallet does not support transaction signing");

      const connection = new Connection(RPC_URL, "confirmed");
      const walletKey = new PublicKey(wallet);
      const anchorWallet = {
        publicKey: walletKey,
        signTransaction: (tx: any) => p.signTransaction(tx),
        signAllTransactions: async (txs: any[]) => {
          if (p.signAllTransactions) return p.signAllTransactions(txs);
          const signed = [];
          for (const tx of txs) signed.push(await p.signTransaction(tx));
          return signed;
        },
      } as any;

      const receiver = new PythSolanaReceiver({
        connection,
        wallet: anchorWallet,
      });
      const builder = receiver.newTransactionBuilder({
        closeUpdateAccounts: true,
      });

      await builder.addPostPriceUpdates(data.updateData as string[]);

      const accounts = data.accounts;
      const feedId = String(data.feedId);
      const borrowRaw = BigInt(String(data.amountBaseUnits));

      const amountBytes = new Uint8Array(8);
      new DataView(amountBytes.buffer).setBigUint64(0, borrowRaw, true);
      const discriminator = Uint8Array.from([0xf9, 0x98, 0xa2, 0x93, 0xf2, 0x25, 0x9a, 0x22]);
      const instructionData = new Uint8Array(16);
      instructionData.set(discriminator, 0);
      instructionData.set(amountBytes, 8);

      await builder.addPriceConsumerInstructions(async (getPriceUpdateAccount) => {
        const pythAccount = getPriceUpdateAccount(feedId);
        const borrowerUsdg = new PublicKey(accounts.borrowerUsdgAccount);
        const usdgMint = new PublicKey(accounts.usdgMint);

        return [
          {
            instruction: createAssociatedTokenAccountIdempotentInstruction(
              walletKey,
              borrowerUsdg,
              walletKey,
              usdgMint,
            ),
            signers: [],
          },
          {
            instruction: new TransactionInstruction({
              programId: new PublicKey(accounts.programId),
              keys: [
                { pubkey: walletKey, isSigner: true, isWritable: true },
                { pubkey: new PublicKey(accounts.protocol), isSigner: false, isWritable: false },
                { pubkey: new PublicKey(accounts.credit), isSigner: false, isWritable: true },
                { pubkey: new PublicKey(accounts.lendingPool), isSigner: false, isWritable: true },
                { pubkey: usdgMint, isSigner: false, isWritable: false },
                { pubkey: borrowerUsdg, isSigner: false, isWritable: true },
                { pubkey: new PublicKey(accounts.liquidityVault), isSigner: false, isWritable: true },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: new PublicKey(accounts.solxMarket), isSigner: false, isWritable: false },
                { pubkey: pythAccount, isSigner: false, isWritable: false },
              ],
              data: Buffer.from(instructionData),
            }),
            signers: [],
          },
        ];
      });

      const built = await builder.buildVersionedTransactions({
        computeUnitPriceMicroLamports: 1_000,
        tightComputeBudget: true,
      });

      let finalSignature = "";
      for (const item of built as any[]) {
        const tx = item.tx;
        const signers = item.signers || [];
        if (signers.length) {
          if (tx instanceof VersionedTransaction) tx.sign(signers);
          else for (const signer of signers) tx.partialSign(signer);
        }

        const signed = await p.signTransaction(tx);
        const signature = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });
        await connection.confirmTransaction(signature, "confirmed");
        finalSignature = signature;
      }

      setLastSignature(finalSignature);
      setMessage(`Borrowed ${borrowAmount} USDG against live Pyth SOL/USD collateral`);
      await loadState(wallet);
    } catch (e: any) {
      setError(e?.message || "Borrow failed");
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    loadState("").catch(() => undefined);
    const p = provider();
    if (p?.publicKey) {
      const address = p.publicKey.toString();
      setWallet(address);
      loadState(address).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!wallet) return;
    const id = window.setInterval(() => {
      loadState(wallet).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(id);
  }, [wallet]);

  const credit = state?.credit;
  const walletState = state?.wallet;
  const solx = state?.solx;
  const programState = state?.programLive ? "Live on Devnet" : "Checking Devnet";
  const health = useMemo(() => {
    if (!credit) return "—";
    if (credit.healthFactor == null) return "No debt";
    return `${credit.healthFactor.toFixed(2)}×`;
  }, [credit]);

  const canTransact = Boolean(wallet && state?.programLive && walletState?.creditExists);
  const canBorrow = Boolean(canTransact && state?.oracle.configured && state?.oracle.price != null && (solx?.deposited || 0) > 0);
  const canWithdrawCollateral = Boolean(canTransact && (credit?.debt || 0) === 0 && (solx?.deposited || 0) > 0);

  const statCards = [
    ["Collateral value", money(credit?.collateralValue), Landmark],
    ["Available to borrow", money(credit?.availableToBorrow), Banknote],
    ["Debt", credit ? `${qty(credit.debt, 2)} USDG` : "—", CircleDollarSign],
    ["Health factor", health, Gauge],
  ] as const;

  return (
    <div className="min-h-screen bg-[#060606] text-[#f5f5ef]">
      <header className="sticky top-0 z-40 border-b border-white/[.08] bg-[#060606]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center gap-5 px-5 py-4">
          <a href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#b7ff3c] text-sm font-black text-black">M</div>
            <span className="text-lg font-semibold">Mary Jane</span>
          </a>
          <nav className="hidden items-center gap-1 lg:flex">
            <a href="/" className="rounded-full px-4 py-2 text-sm text-white/45">Markets</a>
            <a href="/portfolio" className="rounded-full px-4 py-2 text-sm text-white/45">Portfolio</a>
            <a href="/create" className="rounded-full px-4 py-2 text-sm text-white/45">Create</a>
            <a href="/analytics" className="rounded-full px-4 py-2 text-sm text-white/45">Analytics</a>
            <a href="/44-milady" className="rounded-full bg-[#b7ff3c]/10 px-4 py-2 text-sm font-semibold text-[#caff75]">44 Milady</a>
          </nav>
          <button onClick={connect} className="ml-auto flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black">
            <Wallet className="h-4 w-4" />
            {wallet ? short(wallet) : "Connect wallet"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-10">
        <section className="overflow-hidden rounded-[32px] border border-white/[.08] bg-[radial-gradient(circle_at_top_right,rgba(183,255,60,.12),transparent_35%),#0a0a0a] p-6 md:p-9">
          <div className="flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-4xl">
              <div className="text-xs font-semibold uppercase tracking-[.2em] text-[#b7ff3c]">Solana collateralized credit · live Devnet</div>
              <h1 className="mt-4 text-5xl font-semibold tracking-[-.06em] md:text-7xl">44 Milady</h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-white/45 md:text-lg">
                Supply USDG liquidity, deposit SOLx collateral, price it with live Pyth SOL/USD, borrow against it, then repay and withdraw without selling the collateral.
              </p>
            </div>
            <div className="min-w-[310px] rounded-2xl border border-white/[.08] bg-black/35 p-4">
              <div className="flex items-center justify-between text-xs text-white/35"><span>Protocol</span><span className={state?.programLive ? "text-emerald-300" : "text-amber-200"}>{programState}</span></div>
              <div className="mt-3 flex items-center justify-between text-xs text-white/35"><span>Program</span><span className="font-mono text-white/65">{state?.programId ? short(state.programId, 7, 6) : "…"}</span></div>
              <div className="mt-3 flex items-center justify-between text-xs text-white/35"><span>Network</span><span className="text-white/65">Solana Devnet</span></div>
              <div className="mt-3 flex items-center justify-between text-xs text-white/35"><span>Pyth SOL/USD</span><span className={state?.oracle.price != null ? "text-[#caff75]" : "text-amber-200"}>{state?.oracle.price != null ? money(state.oracle.price) : state?.oracle.configured ? "Unavailable" : "API key required"}</span></div>
            </div>
          </div>
        </section>

        {(message || error) && (
          <section className={`mt-4 rounded-2xl border p-4 text-sm ${error ? "border-red-400/20 bg-red-400/5 text-red-200" : "border-emerald-400/20 bg-emerald-400/5 text-emerald-200"}`}>
            {error || message}
            {lastSignature && (
              <a className="ml-3 underline underline-offset-4" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${lastSignature}?cluster=devnet`}>
                Explorer
              </a>
            )}
          </section>
        )}

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {statCards.map(([label, value, Icon]) => (
            <div key={label} className="rounded-2xl border border-white/[.07] bg-white/[.02] p-5">
              <div className="flex items-center justify-between"><span className="text-[10px] uppercase tracking-[.13em] text-white/25">{label}</span><Icon className="h-4 w-4 text-white/20" /></div>
              <div className="mt-3 text-2xl font-semibold">{value}</div>
              <div className="mt-2 text-[10px] text-white/20">{state?.oracle.price != null ? "Live Pyth + on-chain state" : "On-chain snapshot"}</div>
            </div>
          ))}
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
          <div className="rounded-[28px] border border-white/[.08] bg-[#0a0a0a] p-5 md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[.16em] text-[#b7ff3c]">Credit terminal</div>
                <h2 className="mt-2 text-2xl font-semibold">{mode === "BORROW" ? "Borrow against SOLx" : "Supply USDG liquidity"}</h2>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-xl bg-white/[.04] p-1">
                  {(["BORROW", "SUPPLY"] as const).map((value) => (
                    <button key={value} onClick={() => setMode(value)} className={`rounded-lg px-4 py-2 text-xs font-semibold ${mode === value ? "bg-white text-black" : "text-white/35"}`}>
                      {value === "BORROW" ? "Borrow" : "Supply USDG"}
                    </button>
                  ))}
                </div>
                <button onClick={refresh} disabled={busy === "refresh"} className="rounded-xl border border-white/[.08] p-2.5 text-white/45">
                  <RefreshCw className={`h-4 w-4 ${busy === "refresh" ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {!walletState?.creditExists && wallet && (
              <div className="mt-5 rounded-2xl border border-[#b7ff3c]/20 bg-[#b7ff3c]/5 p-4">
                <div className="text-sm font-semibold">Initialize your credit account</div>
                <div className="mt-1 text-xs text-white/35">One small Devnet transaction creates your 44 Milady credit PDA.</div>
                <button disabled={Boolean(busy)} onClick={() => sendAction("initializeCredit")} className="mt-3 rounded-xl bg-[#b7ff3c] px-4 py-2.5 text-xs font-semibold text-black">
                  {busy === "initializeCredit" ? "Initializing…" : "Initialize credit account"}
                </button>
              </div>
            )}

            {mode === "BORROW" ? (
              <>
                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-white/[.08] bg-black/35 p-3">
                    <div className="text-xs text-white/35">Collateral</div>
                    <div className="mt-2 flex items-center justify-between"><strong>SOLx</strong><span className="text-xs text-[#caff75]">Pyth SOL/USD</span></div>
                    <div className="mt-2 text-[10px] text-white/25">Wallet {qty(solx?.walletBalance)} · Deposited {qty(solx?.deposited)}</div>
                  </div>
                  <label className="text-xs text-white/35">Deposit SOLx
                    <input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} inputMode="decimal" className="mt-2 w-full rounded-xl border border-white/[.08] bg-black/35 p-3 text-white outline-none" />
                  </label>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button disabled={Boolean(busy) || !walletState?.creditExists} onClick={() => sendAction("deposit", depositAmount)} className="rounded-xl bg-white py-3 text-sm font-semibold text-black disabled:opacity-35">
                    {busy === "deposit" ? "Depositing…" : "Deposit SOLx"}
                  </button>
                  <button disabled={Boolean(busy)} onClick={() => sendAction("claimSolx")} className="rounded-xl border border-white/[.1] py-3 text-sm font-semibold text-white/70 disabled:opacity-35">
                    {busy === "claimSolx" ? "Claiming…" : "Get test SOLx"}
                  </button>
                </div>

                <label className="mt-5 block text-xs text-white/35">Borrow USDG
                  <input value={borrowAmount} onChange={(e) => setBorrowAmount(e.target.value)} inputMode="decimal" className="mt-2 w-full rounded-xl border border-white/[.08] bg-black/35 p-3 text-lg text-white outline-none" />
                </label>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Max LTV</div><div className="mt-1 font-semibold">{solx ? solx.ltvBps / 100 : 70}%</div></div>
                  <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Liquidation</div><div className="mt-1 font-semibold">{solx ? solx.liquidationThresholdBps / 100 : 80}%</div></div>
                  <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Oracle</div><div className="mt-1 font-semibold">Pyth</div></div>
                </div>
                <button disabled={Boolean(busy) || !canBorrow} onClick={borrow} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#b7ff3c] py-4 text-sm font-semibold text-black disabled:opacity-35">
                  {busy === "borrow" ? "Posting Pyth + borrowing…" : <>Borrow USDG <ArrowRight className="h-4 w-4" /></>}
                </button>
                {!state?.oracle.configured && <p className="mt-3 text-[10px] text-amber-200/70">Borrow requires PYTH_API_KEY on the Mary Jane server. Supply, deposit and repay still use direct Devnet transactions.</p>}
              </>
            ) : (
              <>
                <label className="mt-6 block text-xs text-white/35">USDG amount
                  <input value={supplyAmount} onChange={(e) => setSupplyAmount(e.target.value)} inputMode="decimal" className="mt-2 w-full rounded-xl border border-white/[.08] bg-black/35 p-3 text-lg text-white outline-none" />
                </label>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Wallet</div><div className="mt-1 font-semibold">{qty(walletState?.usdg, 2)} USDG</div></div>
                  <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Your supply</div><div className="mt-1 font-semibold">{qty(walletState?.suppliedUsdg, 2)}</div></div>
                  <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Pool</div><div className="mt-1 font-semibold">{qty(state?.poolUsdg, 2)}</div></div>
                </div>
                <div className="mt-5 grid gap-2 sm:grid-cols-3">
                  <button disabled={Boolean(busy) || !canTransact} onClick={() => sendAction("supply", supplyAmount)} className="rounded-xl bg-white py-3 text-sm font-semibold text-black disabled:opacity-35">{busy === "supply" ? "Supplying…" : "Supply USDG"}</button>
                  <button disabled={Boolean(busy) || !canTransact || (walletState?.suppliedUsdg || 0) <= 0} onClick={() => sendAction("withdrawSupply", supplyAmount)} className="rounded-xl border border-white/[.1] py-3 text-sm font-semibold disabled:opacity-35">{busy === "withdrawSupply" ? "Withdrawing…" : "Withdraw supply"}</button>
                  <button disabled={Boolean(busy)} onClick={() => sendAction("claimUsdg")} className="rounded-xl border border-[#b7ff3c]/20 py-3 text-sm font-semibold text-[#caff75] disabled:opacity-35">{busy === "claimUsdg" ? "Claiming…" : "Get test USDG"}</button>
                </div>
              </>
            )}
          </div>

          <div className="space-y-5">
            <div className="rounded-[28px] border border-white/[.08] bg-[#0a0a0a] p-5">
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#b7ff3c]" /><h3 className="font-semibold">Your 44 Milady account</h3></div>
              {!wallet ? (
                <div className="mt-5 text-sm text-white/35">Connect a Solana wallet to use the live Devnet protocol.</div>
              ) : (
                <div className="mt-5 space-y-3 text-xs">
                  <div className="flex justify-between gap-4"><span className="text-white/30">Wallet</span><span className="font-mono text-white/65">{short(wallet)}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-white/30">Devnet SOL</span><span>{qty(walletState?.sol)}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-white/30">USDG</span><span>{qty(walletState?.usdg, 2)}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-white/30">SOLx deposited</span><span>{qty(solx?.deposited)}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-white/30">Credit account</span><span className={walletState?.creditExists ? "text-emerald-300" : "text-white/50"}>{walletState?.creditExists ? "Initialized" : "Not initialized"}</span></div>
                  {walletState?.credit && <div className="break-all rounded-xl bg-white/[.025] p-3 font-mono text-[10px] text-white/30">{walletState.credit}</div>}
                </div>
              )}

              {walletState?.creditExists && (
                <div className="mt-5 border-t border-white/[.06] pt-5">
                  <div className="text-[10px] uppercase tracking-[.14em] text-white/25">Repay & withdraw</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <input value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} inputMode="decimal" placeholder="USDG" className="rounded-xl border border-white/[.08] bg-black/35 p-3 text-xs outline-none" />
                    <button disabled={Boolean(busy) || (credit?.debt || 0) <= 0} onClick={() => sendAction("repay", repayAmount)} className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-35">{busy === "repay" ? "Repaying…" : "Repay USDG"}</button>
                  </div>
                  <button disabled={Boolean(busy) || (credit?.debt || 0) <= 0} onClick={() => sendAction("repayMax")} className="mt-2 w-full rounded-xl border border-white/[.08] py-2.5 text-xs font-semibold disabled:opacity-35">{busy === "repayMax" ? "Repaying…" : "Repay full debt"}</button>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <input value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} inputMode="decimal" placeholder="SOLx" className="rounded-xl border border-white/[.08] bg-black/35 p-3 text-xs outline-none" />
                    <button disabled={Boolean(busy) || !canWithdrawCollateral} onClick={() => sendAction("withdrawCollateral", withdrawAmount)} className="rounded-xl border border-[#b7ff3c]/20 px-3 py-2 text-xs font-semibold text-[#caff75] disabled:opacity-35">{busy === "withdrawCollateral" ? "Withdrawing…" : "Withdraw SOLx"}</button>
                  </div>
                  {(credit?.debt || 0) > 0 && <p className="mt-2 text-[10px] text-white/25">Repay debt first before collateral withdrawal.</p>}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-white/[.08] bg-[#0a0a0a] p-5">
              <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-[#b7ff3c]" /><h3 className="font-semibold">Live protocol flow</h3></div>
              <div className="mt-5 space-y-3">
                {[
                  ["Supply USDG liquidity", (state?.poolUsdg || 0) > 0],
                  ["Deposit SOLx collateral", (solx?.deposited || 0) > 0],
                  ["Read fresh Pyth SOL/USD", state?.oracle.price != null],
                  ["Calculate LTV + health", Boolean(credit)],
                  ["Borrow USDG", (credit?.debt || 0) > 0],
                  ["Repay + withdraw", true],
                ].map(([label, ok], index) => (
                  <div key={String(label)} className="flex items-center gap-3 text-xs text-white/45">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] ${ok ? "bg-[#b7ff3c]/15 text-[#caff75]" : "bg-white/[.05] text-white/35"}`}>{index + 1}</span>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-[28px] border border-white/[.08] bg-[#0a0a0a] p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div><div className="text-xs uppercase tracking-[.16em] text-white/25">Collateral market</div><h2 className="mt-2 text-2xl font-semibold">SOLx risk configuration</h2></div>
            <div className="text-xs text-white/25">Real Pyth SOL/USD · on-chain limits</div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-white/[.07] p-4"><div className="text-[10px] text-white/25">Market</div><div className="mt-2 font-semibold">SOLx / USDG</div></div>
            <div className="rounded-2xl border border-white/[.07] p-4"><div className="text-[10px] text-white/25">LTV</div><div className="mt-2 font-semibold">{solx ? solx.ltvBps / 100 : 70}%</div></div>
            <div className="rounded-2xl border border-white/[.07] p-4"><div className="text-[10px] text-white/25">Liquidation threshold</div><div className="mt-2 font-semibold">{solx ? solx.liquidationThresholdBps / 100 : 80}%</div></div>
            <div className="rounded-2xl border border-white/[.07] p-4"><div className="text-[10px] text-white/25">Oracle</div><div className="mt-2 font-semibold text-[#caff75]">Pyth SOL/USD</div></div>
          </div>
          <div className="mt-4 grid gap-2 text-[10px] text-white/25 md:grid-cols-3">
            <div className="break-all rounded-xl bg-white/[.02] p-3">Program: {state?.programId || "…"}</div>
            <div className="break-all rounded-xl bg-white/[.02] p-3">SOLx market: {solx?.market || "…"}</div>
            <div className="break-all rounded-xl bg-white/[.02] p-3">USDG mint: {state?.usdgMint || "…"}</div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default FortyFourMiladyScreen;
