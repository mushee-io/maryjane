import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BarChart3, Trash2, Wallet } from "lucide-react";
import { Connection, Transaction } from "@solana/web3.js";

type Market = {
  title: string;
  description?: string;
  category: string;
  nativeAddress?: string;
  nativeMarketSeed?: string;
  closesAt?: string;
  status?: string;
  coverImageUrl?: string;
  metadataUrl?: string;
  outcomes: Array<{ id?: string; label: string; probability: number; imageUrl?: string }>;
};

type BookOrder = {
  order: string;
  maker: string;
  side: "YES" | "NO";
  kind: "BUY" | "SELL";
  priceBps: number;
  originalShares: string;
  remainingShares: string;
  createdAt: number;
};

type Trade = {
  signature: string;
  side: "YES" | "NO";
  priceBps: number;
  yesPriceBps: number;
  shares: string;
  quoteAmount: string;
  blockTime: number;
};

type TraderState = {
  collateral: { symbol: "USDG"; mint: string; amount: string; decimals: number; uiAmount: number; ata: string };
  yes: { symbol: "YES"; mint: string; amount: string; decimals: number; uiAmount: number; ata: string };
  no: { symbol: "NO"; mint: string; amount: string; decimals: number; uiAmount: number; ata: string };
  sol: { lamports: number; uiAmount: number };
};

type NativeState = {
  market: {
    address: string;
    marketSeed: string;
    closeTs: number;
    resolutionTs: number;
    status: string;
    feeBps: number;
    reserveYesBps: number;
    totalVolumeBaseUnits: string;
  };
  book: {
    yes: { bids: BookOrder[]; asks: BookOrder[]; bestBidBps: number | null; bestAskBps: number | null };
    no: { bids: BookOrder[]; asks: BookOrder[]; bestBidBps: number | null; bestAskBps: number | null };
    lastMatchedYesBps: number | null;
    lastMatchedAt: number | null;
    volume24hBaseUnits: string;
    totalMatchedVolumeBaseUnits: string;
    tradeCount: number;
    traderCount: number;
    activeOrderCount: number;
  };
  recentTrades: Trade[];
  updatedAt: number;
};

function provider() { return (window as any).solana; }
function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function jsonOrThrow(response: Response) {
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`API ${response.status}: ${text.slice(0, 160)}`); }
  if (!response.ok) throw new Error(data?.error || "Request failed");
  return data;
}
async function signBuiltTransaction(transactionBase64: string, lastValidBlockHeight?: number) {
  const wallet = provider();
  if (!wallet?.signAndSendTransaction) throw new Error("Connect a compatible Solana wallet first.");
  const tx = Transaction.from(fromBase64(transactionBase64));
  const result = await wallet.signAndSendTransaction(tx);
  const signature = typeof result === "string" ? result : result.signature;

  if (tx.recentBlockhash && lastValidBlockHeight) {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: tx.recentBlockhash,
      lastValidBlockHeight,
    }, "confirmed");

    if (confirmation.value.err) {
      let detail = "";
      try {
        const parsed = await connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        const logs = parsed?.meta?.logMessages || [];
        const useful = logs.filter((line) =>
          /error|failed|insufficient|custom program error/i.test(line)
        ).slice(-3);
        detail = useful.length ? ` · ${useful.join(" · ")}` : "";
      } catch {}
      throw new Error(`Transaction failed on Solana${detail}`);
    }
  }

  return signature;
}
function short(value: string, left = 7, right = 6) {
  return value.length > left + right + 1 ? `${value.slice(0, left)}…${value.slice(-right)}` : value;
}
function usdBase(value?: string) {
  const amount = Number(value || 0) / 1e6;
  return `$${new Intl.NumberFormat("en", { notation: amount >= 1000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(amount)}`;
}
function when(ts?: number) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function ago(ts?: number | null) {
  if (!ts) return "—";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const CANCELLED_MARKET_PREFIX = "maryjane:cancelled-market:";
function markMarketCancelledInApp(address: string) {
  if (!address) return;
  localStorage.setItem(
    `${CANCELLED_MARKET_PREFIX}${address}`,
    JSON.stringify({ cancelledAt: Date.now() }),
  );
  window.dispatchEvent(
    new CustomEvent("maryjane:market-cancelled", { detail: { address } }),
  );
}

function PriceHistory({ trades, fallback }: { trades: Trade[]; fallback: number }) {
  const values = [...trades].reverse().slice(-24).map((trade) => trade.yesPriceBps);
  if (values.length < 2) {
    return (
      <div className="flex h-36 items-center justify-center rounded-2xl border border-dashed border-white/[.08] bg-white/[.015] text-xs text-white/25">
        Price history begins after the first matched trades.
      </div>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(100, max - min);
  const points = values.map((value, index) =>
    `${(index / (values.length - 1)) * 100},${90 - ((value - (min - span * .1)) / (span * 1.2)) * 80}`
  ).join(" ");
  return (
    <div className="relative h-36 rounded-2xl border border-white/[.07] bg-white/[.015] p-3">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" className="text-[#b7ff3c]" />
      </svg>
      <span className="absolute right-4 top-3 text-xs font-semibold text-[#b7ff3c]">
        {((values.at(-1) ?? fallback) / 100).toFixed(1)}%
      </span>
    </div>
  );
}

export default function NativeMarketTerminal({
  market,
  wallet,
  onConnect,
  onClose,
}: {
  market: Market;
  wallet: string;
  onConnect: () => Promise<void>;
  onClose: () => void;
}) {
  const [state, setState] = useState<NativeState | null>(null);
  const [traderState, setTraderState] = useState<TraderState | null>(null);
  const [error, setError] = useState("");
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [kind, setKind] = useState<"BUY" | "SELL">("BUY");
  const [price, setPrice] = useState("50");
  const [shares, setShares] = useState("1");
  const [completeSetAmount, setCompleteSetAmount] = useState("10");
  const [resolutionState, setResolutionState] = useState<any>(null);
  const [resolutionOutcome, setResolutionOutcome] = useState<"YES"|"NO"|"INVALID">("YES");
  const [resolutionEvidence, setResolutionEvidence] = useState("");
  const [resolutionSource, setResolutionSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const address = market.nativeAddress || "";
  const load = async () => {
    if (!address) return;
    try {
      const response = await fetch(`/api/native-market-state?address=${encodeURIComponent(address)}`, { cache: "no-store" });
      const data = await jsonOrThrow(response);
      setState(data);
      setError("");
    } catch (err: any) {
      setError(err?.message || "Unable to load live market state");
    }
  };

  const loadResolution = async () => {
    if (!address) return;
    try {
      const response = await fetch(`/api/market-action?market=${encodeURIComponent(address)}`, { cache: "no-store" });
      const data = await jsonOrThrow(response);
      setResolutionState(data);
    } catch {
      setResolutionState(null);
    }
  };

  const loadTrader = async () => {
    if (!address || !wallet) {
      setTraderState(null);
      return;
    }
    try {
      const response = await fetch(
        `/api/trader-state?market=${encodeURIComponent(address)}&wallet=${encodeURIComponent(wallet)}`,
        { cache: "no-store" },
      );
      const data = await jsonOrThrow(response);
      setTraderState(data);
    } catch {
      setTraderState(null);
    }
  };

  useEffect(() => {
    void load();
    void loadResolution();
    const timer = window.setInterval(() => {
      void load();
      void loadResolution();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [address]);

  useEffect(() => {
    void loadTrader();
    const timer = window.setInterval(() => void loadTrader(), 5_000);
    return () => window.clearInterval(timer);
  }, [address, wallet]);

  const yesOutcome = market.outcomes.find((outcome) => outcome.id === "yes") || market.outcomes.find((outcome) => outcome.label === "YES") || market.outcomes[0];
  const noOutcome = market.outcomes.find((outcome) => outcome.id === "no") || market.outcomes.find((outcome) => outcome.label === "NO") || market.outcomes[1];
  const yesLabel = yesOutcome?.label || "YES";
  const noLabel = noOutcome?.label || "NO";
  const labelFor = (value: "YES" | "NO") => value === "YES" ? yesLabel : noLabel;
  const imageFor = (value: "YES" | "NO") => value === "YES" ? yesOutcome?.imageUrl : noOutcome?.imageUrl;
  const fallbackYes = Math.round((yesOutcome?.probability ?? .5) * 10_000);
  const yesBps = state?.book.lastMatchedYesBps ?? state?.market.reserveYesBps ?? fallbackYes;
  const selectedBps = side === "YES" ? yesBps : 10_000 - yesBps;
  const book = state?.book[side.toLowerCase() as "yes" | "no"];
  const spread = book?.bestBidBps != null && book?.bestAskBps != null ? book.bestAskBps - book.bestBidBps : null;
  const estimatedCost = (Number(shares) || 0) * (Number(price) || 0) / 100;
  const potentialPayout = Number(shares) || 0;
  const maxProfit = kind === "BUY" ? Math.max(0, potentialPayout - estimatedCost) : estimatedCost;
  const impliedProbability = Math.min(99.99, Math.max(0.01, Number(price) || 0));
  const selectedOutcomeBalance = side === "YES" ? traderState?.yes.uiAmount : traderState?.no.uiAmount;
  const availableForOrder = kind === "BUY" ? traderState?.collateral.uiAmount : selectedOutcomeBalance;
  const requiredForOrder = kind === "BUY" ? estimatedCost : (Number(shares) || 0);
  const insufficientBalance = Boolean(
    wallet &&
    traderState &&
    Number.isFinite(requiredForOrder) &&
    requiredForOrder > 0 &&
    (availableForOrder ?? 0) + 1e-9 < requiredForOrder
  );
  const connectedIsCreator = Boolean(
    wallet &&
    resolutionState?.market?.authority &&
    wallet === resolutionState.market.authority
  );
  const canCreatorCancel = connectedIsCreator && (state?.market.status || market.status || "OPEN") === "OPEN";

  useEffect(() => {
    setPrice((selectedBps / 100).toFixed(0));
  }, [side, state?.book.lastMatchedYesBps]);

  const stats = useMemo(() => [
    ["Best bid", state?.book.yes.bestBidBps != null ? `${(state.book.yes.bestBidBps / 100).toFixed(2)}¢` : "—"],
    ["Best ask", state?.book.yes.bestAskBps != null ? `${(state.book.yes.bestAskBps / 100).toFixed(2)}¢` : "—"],
    ["Spread", state?.book.yes.bestBidBps != null && state?.book.yes.bestAskBps != null ? `${((state.book.yes.bestAskBps - state.book.yes.bestBidBps) / 100).toFixed(2)}¢` : "—"],
    ["24h volume", usdBase(state?.book.volume24hBaseUnits)],
    ["Trades", state?.book.tradeCount ?? 0],
    ["Traders", state?.book.traderCount ?? 0],
  ], [state]);

  const placeOrder = async () => {
    if (!market.nativeAddress) return;
    if (!wallet) { await onConnect(); return; }
    const px = Number(price);
    const qty = Number(shares);
    if (!Number.isFinite(px) || px <= 0 || px >= 100) return setNotice("Price must be between 0.01¢ and 99.99¢.");
    if (!Number.isFinite(qty) || qty <= 0) return setNotice("Enter a positive share amount.");

    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/order-place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          market: market.nativeAddress,
          side,
          kind,
          priceBps: Math.round(px * 100),
          sharesBaseUnits: String(Math.round(qty * 1e6)),
        }),
      });
      const data = await jsonOrThrow(response);
      setNotice("Waiting for Solana confirmation…");
      const signature = await signBuiltTransaction(data.transactionBase64, data.lastValidBlockHeight);
      setNotice(`Confirmed on Solana · ${short(signature)}`);
      await Promise.all([load(), loadTrader()]);
    } catch (err: any) {
      const message = err?.message || String(err || "");
      setNotice(message === "Unexpected error" ? "Wallet rejected the transaction. Check Devnet SOL balance and retry." : message || "Unable to place order");
    } finally {
      setBusy(false);
    }
  };

  const cancelOrder = async (order: BookOrder) => {
    if (!wallet) { await onConnect(); return; }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/order-cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, order: order.order }),
      });
      const data = await jsonOrThrow(response);
      setNotice("Waiting for Solana confirmation…");
      const signature = await signBuiltTransaction(data.transactionBase64, data.lastValidBlockHeight);
      setNotice(`Cancelled · ${short(signature)}`);
      await Promise.all([load(), loadTrader()]);
    } catch (err: any) {
      setNotice(err?.message || "Unable to cancel order");
    } finally {
      setBusy(false);
    }
  };

  const takeOrder = async (order: BookOrder) => {
    if (!wallet) { await onConnect(); return; }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/order-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, order: order.order, sharesBaseUnits: order.remainingShares }),
      });
      const data = await jsonOrThrow(response);
      setNotice("Waiting for Solana confirmation…");
      const signature = await signBuiltTransaction(data.transactionBase64, data.lastValidBlockHeight);
      setNotice(`Matched · ${short(signature)}`);
      await Promise.all([load(), loadTrader()]);
    } catch (err: any) {
      setNotice(err?.message || "Unable to fill order");
    } finally {
      setBusy(false);
    }
  };

  const executeMarketAction = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!market.nativeAddress) return;
    if (!wallet) { await onConnect(); return; }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/market-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, wallet, market: market.nativeAddress, ...extra }),
      });
      const data = await jsonOrThrow(response);
      setNotice("Waiting for Solana confirmation…");
      const signature = await signBuiltTransaction(data.transactionBase64, data.lastValidBlockHeight);
      const labels: Record<string,string> = {
        CANCEL_MARKET: "Market cancelled",
        CLOSE: "Market closed",
        PROPOSE: "Resolution proposed",
        DISPUTE: "Resolution disputed",
        FINALIZE: "Resolution finalized",
        RESOLVE_DISPUTE: "Dispute adjudicated",
        CANCEL_STALLED: "Stalled dispute cancelled",
        REDEEM: "Winnings redeemed",
        REFUND: "Refund claimed",
      };
      setNotice(`${labels[action] || "Market updated"} · ${short(signature)}`);
      await Promise.all([load(), loadTrader(), loadResolution()]);
    } catch (err: any) {
      const message = err?.message || String(err || "");
      if (
        action === "CANCEL_MARKET" &&
        /InstructionFallbackNotFound|Fallback functions are not supported|custom program error:\s*0x65/i.test(message)
      ) {
        markMarketCancelledInApp(market.nativeAddress || "");
        setNotice("Market cancelled in Mary Jane.");
        window.setTimeout(() => onClose(), 250);
      } else {
        setNotice(message || "Unable to execute market action");
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelCreatedMarket = async () => {
    if (!wallet) {
      await onConnect();
      return;
    }
    if (!connectedIsCreator) {
      setNotice("Only the wallet that created this market can cancel it.");
      return;
    }
    if ((state?.market.status || market.status || "OPEN") !== "OPEN") {
      setNotice("Only an OPEN market can be cancelled by its creator.");
      return;
    }

    const confirmed = window.confirm(
      "Cancel this market?\n\nMary Jane will remove this unused market from the active app immediately. The legacy Devnet account remains on-chain as a test record until the program is upgraded."
    );
    if (!confirmed) return;

    await executeMarketAction("CANCEL_MARKET");
  };

  const completeSetAction = async (action: "SPLIT" | "MERGE") => {
    if (!market.nativeAddress) return;
    if (!wallet) { await onConnect(); return; }

    const amount = Number(completeSetAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice("Enter a positive complete-set amount.");
      return;
    }
    const decimals = traderState?.collateral.decimals ?? 6;
    const scale = 10 ** decimals;
    const amountBaseUnits = String(Math.round(amount * scale));

    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/complete-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          market: market.nativeAddress,
          action,
          amountBaseUnits,
        }),
      });
      const data = await jsonOrThrow(response);
      setNotice(action === "SPLIT" ? "Creating YES + NO shares…" : "Merging YES + NO back to USDG…");
      const signature = await signBuiltTransaction(data.transactionBase64, data.lastValidBlockHeight);
      setNotice(
        action === "SPLIT"
          ? `Created ${amount.toFixed(2)} ${yesLabel} + ${amount.toFixed(2)} ${noLabel} · ${short(signature)}`
          : `Merged ${amount.toFixed(2)} complete sets · ${short(signature)}`
      );
      await Promise.all([load(), loadTrader()]);
    } catch (err: any) {
      setNotice(err?.message || `Unable to ${action.toLowerCase()} complete set`);
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#050505] text-[#f5f5ef]">
      <div className="sticky top-0 z-20 border-b border-white/[.08] bg-[#050505]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1450px] items-center gap-3 px-5 py-4">
          <button onClick={onClose} className="rounded-xl border border-white/[.08] px-3 py-2 text-sm text-white/55 hover:text-white">← Markets</button>
          <span className="rounded-full bg-[#b7ff3c]/12 px-2.5 py-1 text-[10px] font-semibold tracking-[.12em] text-[#caff75]">MARY JANE</span>
          <span className="text-xs text-white/25">{market.category}</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[.06] px-3 py-1.5 text-xs text-emerald-300">
              {state?.market.status || market.status || "OPEN"} · DEVNET
            </span>
            {canCreatorCancel && (
              <button
                onClick={() => void cancelCreatedMarket()}
                disabled={busy}
                title="Cancel an unused market created by this wallet"
                className="flex items-center gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[.08] px-3 py-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-400/[.14] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Cancel market
              </button>
            )}
            <button onClick={onConnect} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black">
              <Wallet className="h-3.5 w-3.5" />{wallet ? short(wallet, 4, 4) : "Connect"}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1450px] gap-6 px-5 py-7 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0">
          <div className="flex flex-col gap-5 border-b border-white/[.07] pb-7 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl">
              <div className="text-xs uppercase tracking-[.18em] text-white/25">Native prediction market</div>
              {market.coverImageUrl && <img src={market.coverImageUrl} alt="" className="mb-5 h-40 w-full max-w-4xl rounded-3xl border border-white/[.08] object-cover md:h-52" />}
              <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-[-.045em] md:text-5xl">{market.title}</h1>
              {(yesOutcome?.imageUrl || noOutcome?.imageUrl || yesLabel !== "YES" || noLabel !== "NO") && (
                <div className="mt-5 grid max-w-2xl grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="flex items-center gap-3 rounded-2xl border border-emerald-300/15 bg-emerald-300/[.05] p-3">
                    {yesOutcome?.imageUrl && <img src={yesOutcome.imageUrl} alt="" className="h-11 w-11 rounded-full border border-white/10 bg-white object-cover" />}
                    <div className="min-w-0"><div className="truncate text-sm font-semibold">{yesLabel}</div><div className="mt-1 text-xs text-emerald-300">{(yesBps/100).toFixed(1)}%</div></div>
                  </div>
                  <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-white/20">vs</div>
                  <div className="flex items-center justify-end gap-3 rounded-2xl border border-rose-300/15 bg-rose-300/[.05] p-3 text-right">
                    <div className="min-w-0"><div className="truncate text-sm font-semibold">{noLabel}</div><div className="mt-1 text-xs text-rose-300">{((10000-yesBps)/100).toFixed(1)}%</div></div>
                    {noOutcome?.imageUrl && <img src={noOutcome.imageUrl} alt="" className="h-11 w-11 rounded-full border border-white/10 bg-white object-cover" />}
                  </div>
                </div>
              )}
              {market.description && <p className="mt-4 max-w-3xl text-sm leading-6 text-white/38">{market.description}</p>}
            </div>
            <div className="shrink-0 lg:text-right">
              <div className="text-xs text-white/30">{yesLabel} probability</div>
              <div className="mt-1 text-5xl font-semibold tracking-[-.05em]">{(yesBps / 100).toFixed(1)}%</div>
              <div className="mt-2 text-xs text-white/30">{state?.book.lastMatchedYesBps != null ? "Last matched price" : "Indicative until first match"}</div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-6">
            {stats.map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl border border-white/[.07] bg-white/[.018] p-3">
                <div className="text-[10px] uppercase tracking-wider text-white/25">{label}</div>
                <div className="mt-2 text-sm font-semibold">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4" />{yesLabel} probability</div>
              <div className="text-xs text-white/28">{state?.book.lastMatchedAt ? ago(state.book.lastMatchedAt) : "No matches yet"}</div>
            </div>
            <PriceHistory trades={state?.recentTrades || []} fallback={yesBps} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
            <div className="rounded-3xl border border-white/[.08] bg-white/[.018] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">Order book</div>
                  <div className="mt-1 text-xs text-white/28">Real resting orders · click a row to take it</div>
                </div>
                <div className="flex rounded-xl bg-white/[.04] p-1">
                  {(["YES", "NO"] as const).map((value) => (
                    <button key={value} onClick={() => setSide(value)} className={`rounded-lg px-4 py-1.5 text-xs font-semibold ${side === value ? value === "YES" ? "bg-emerald-300 text-black" : "bg-rose-300 text-black" : "text-white/35"}`}>{labelFor(value)}</button>
                  ))}
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <div className="mb-2 flex justify-between text-[10px] uppercase tracking-wider text-white/25"><span>Bids</span><span>Shares</span></div>
                  {(book?.bids || []).slice(0, 10).map((order) => (
                    <button key={order.order} onClick={() => void (wallet && order.maker === wallet ? cancelOrder(order) : takeOrder(order))} className="mb-1 flex w-full justify-between rounded-lg bg-emerald-400/[.06] px-3 py-2 text-xs hover:bg-emerald-400/[.12]">
                      <span className="text-emerald-300">{(order.priceBps / 100).toFixed(2)}¢</span>
                      <span className="flex items-center gap-2 text-white/38"><span>{(Number(order.remainingShares) / 1e6).toFixed(2)}</span>{wallet && order.maker === wallet && <span className="rounded bg-white/[.08] px-1.5 py-0.5 text-[9px] text-white/55">CANCEL</span>}</span>
                    </button>
                  ))}
                  {!book?.bids.length && <div className="py-8 text-center text-xs text-white/22">No bids</div>}
                </div>
                <div>
                  <div className="mb-2 flex justify-between text-[10px] uppercase tracking-wider text-white/25"><span>Asks</span><span>Shares</span></div>
                  {(book?.asks || []).slice(0, 10).map((order) => (
                    <button key={order.order} onClick={() => void (wallet && order.maker === wallet ? cancelOrder(order) : takeOrder(order))} className="mb-1 flex w-full justify-between rounded-lg bg-rose-400/[.06] px-3 py-2 text-xs hover:bg-rose-400/[.12]">
                      <span className="text-rose-300">{(order.priceBps / 100).toFixed(2)}¢</span>
                      <span className="flex items-center gap-2 text-white/38"><span>{(Number(order.remainingShares) / 1e6).toFixed(2)}</span>{wallet && order.maker === wallet && <span className="rounded bg-white/[.08] px-1.5 py-0.5 text-[9px] text-white/55">CANCEL</span>}</span>
                    </button>
                  ))}
                  {!book?.asks.length && <div className="py-8 text-center text-xs text-white/22">No asks</div>}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/[.06] pt-4 text-xs text-white/28">
                <span>{state?.book.activeOrderCount ?? 0} resting orders</span>
                <span>{spread != null ? `Spread ${(spread / 100).toFixed(2)}¢` : "Waiting for two-sided depth"}</span>
              </div>
            </div>

            <div className="rounded-3xl border border-white/[.08] bg-white/[.018] p-5">
              <div className="text-lg font-semibold">Recent trades</div>
              <div className="mt-1 text-xs text-white/28">Onchain matched fills</div>
              <div className="mt-5">
                <div className="grid grid-cols-[1fr_.8fr_.8fr] border-b border-white/[.06] pb-2 text-[10px] uppercase tracking-wider text-white/22">
                  <span>Price</span><span>Shares</span><span className="text-right">Time</span>
                </div>
                {(state?.recentTrades || []).slice(0, 12).map((trade, index) => (
                  <div key={`${trade.signature}-${index}`} className="grid grid-cols-[1fr_.8fr_.8fr] border-b border-white/[.04] py-2.5 text-xs">
                    <span className={trade.side === "YES" ? "text-emerald-300" : "text-rose-300"}>{(trade.yesPriceBps / 100).toFixed(2)}¢ {yesLabel}</span>
                    <span className="text-white/45">{(Number(trade.shares) / 1e6).toFixed(2)}</span>
                    <span className="text-right text-white/28">{ago(trade.blockTime)}</span>
                  </div>
                ))}
                {!state?.recentTrades.length && <div className="py-12 text-center text-xs text-white/25">No matched trades yet. The first fill will print here.</div>}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-white/[.08] bg-white/[.018] p-5">
            <div className="grid gap-5 md:grid-cols-4">
              <div><div className="text-[10px] uppercase tracking-wider text-white/22">Closes</div><div className="mt-2 text-sm">{when(state?.market.closeTs)}</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-white/22">Resolves</div><div className="mt-2 text-sm">{when(state?.market.resolutionTs)}</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-white/22">Fee</div><div className="mt-2 text-sm">{state?.market.feeBps != null ? `${(state.market.feeBps / 100).toFixed(2)}%` : "—"}</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-white/22">Total volume</div><div className="mt-2 text-sm">{usdBase(state?.market.totalVolumeBaseUnits)}</div></div>
            </div>
            <a href={`https://explorer.solana.com/address/${market.nativeAddress}?cluster=devnet`} target="_blank" rel="noreferrer" className="mt-5 flex items-center gap-2 text-xs text-white/35 hover:text-white">
              View market account on Solana <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="mt-6 rounded-3xl border border-white/[.08] bg-white/[.018] p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[.16em] text-[#b7ff3c]">Resolution & settlement</div>
                <div className="mt-2 text-xl font-semibold">Market lifecycle</div>
                <div className="mt-1 text-xs text-white/28">Close, resolve, challenge and settle directly through the deployed Mary Jane program.</div>
              </div>
              <div className="rounded-full border border-white/[.08] px-3 py-1.5 text-xs text-white/45">
                {state?.market.status || market.status || "OPEN"}
              </div>
            </div>

            {(() => {
              const status = state?.market.status || market.status || "OPEN";
              const now = Math.floor(Date.now() / 1000);
              const closeTs = state?.market.closeTs || 0;
              const resolutionTs = state?.market.resolutionTs || 0;
              const config = resolutionState?.resolutionConfig;
              const resolution = resolutionState?.resolution;
              const proposedLabel = resolution?.proposedOutcome === "YES" ? yesLabel : resolution?.proposedOutcome === "NO" ? noLabel : resolution?.proposedOutcome || "—";
              const proposalBond = Number(config?.proposalBond || 0) / 1e6;
              const disputeBond = Number(config?.disputeBond || 0) / 1e6;
              const winningBalance = status === "RESOLVED_YES" ? (traderState?.yes.uiAmount || 0) : status === "RESOLVED_NO" ? (traderState?.no.uiAmount || 0) : 0;
              const refundEstimate = status === "CANCELLED" ? ((traderState?.yes.uiAmount || 0) + (traderState?.no.uiAmount || 0)) / 2 : 0;

              if (status === "OPEN") return (
                <div className="mt-5 rounded-2xl border border-white/[.06] bg-black/20 p-4">
                  {now < closeTs ? (
                    <div className="text-sm text-white/45">Trading remains open until <span className="text-white/75">{when(closeTs)}</span>.</div>
                  ) : (
                    <><div className="text-sm text-white/50">Trading time has elapsed. Close the market to begin resolution.</div><button onClick={() => void executeMarketAction("CLOSE")} disabled={busy || !wallet} className="mt-4 rounded-xl bg-white px-4 py-3 text-xs font-semibold text-black disabled:opacity-35">{wallet ? "Close market on Solana" : "Connect to close"}</button></>
                  )}
                </div>
              );

              if (status === "CLOSED") return (
                <div className="mt-5">
                  {now < resolutionTs ? <div className="rounded-2xl border border-white/[.06] bg-black/20 p-4 text-sm text-white/45">Resolution proposals open at <span className="text-white/75">{when(resolutionTs)}</span>.</div> : <>
                    <div className="text-xs text-white/35">Propose the final outcome · bond {proposalBond.toFixed(2)} USDG</div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {(["YES","NO","INVALID"] as const).map(value => <button key={value} onClick={() => setResolutionOutcome(value)} className={`rounded-xl border px-3 py-3 text-xs font-semibold ${resolutionOutcome===value?"border-[#b7ff3c]/40 bg-[#b7ff3c]/10 text-[#caff75]":"border-white/[.07] text-white/40"}`}>{value==="YES"?yesLabel:value==="NO"?noLabel:"Invalid"}</button>)}
                    </div>
                    <input value={resolutionSource} onChange={e=>setResolutionSource(e.target.value)} placeholder="Official source or oracle observation" className="mt-3 w-full rounded-xl border border-white/[.08] bg-black/30 p-3 text-sm outline-none"/>
                    <textarea value={resolutionEvidence} onChange={e=>setResolutionEvidence(e.target.value)} placeholder="Evidence / explanation for this resolution" rows={3} className="mt-2 w-full rounded-xl border border-white/[.08] bg-black/30 p-3 text-sm outline-none"/>
                    <button onClick={() => void executeMarketAction("PROPOSE",{outcome:resolutionOutcome,source:resolutionSource,evidence:resolutionEvidence,observation:resolutionSource})} disabled={busy || !wallet || !resolutionEvidence.trim() || !resolutionSource.trim()} className="mt-3 w-full rounded-xl bg-[#b7ff3c] py-3 text-sm font-semibold text-black disabled:opacity-35">Propose {resolutionOutcome==="YES"?yesLabel:resolutionOutcome==="NO"?noLabel:"Invalid"}</button>
                  </>}
                </div>
              );

              if (status === "RESOLUTION_PENDING") return (
                <div className="mt-5 rounded-2xl border border-white/[.06] bg-black/20 p-4">
                  <div className="flex justify-between gap-4 text-sm"><span className="text-white/35">Proposed outcome</span><span className="font-semibold">{proposedLabel}</span></div>
                  <div className="mt-2 flex justify-between gap-4 text-xs"><span className="text-white/30">Challenge deadline</span><span className="text-white/55">{when(resolution?.challengeDeadline)}</span></div>
                  {now < Number(resolution?.challengeDeadline||0) ? <>
                    <textarea value={resolutionEvidence} onChange={e=>setResolutionEvidence(e.target.value)} placeholder="Evidence for a dispute" rows={2} className="mt-4 w-full rounded-xl border border-white/[.08] bg-black/30 p-3 text-sm outline-none"/>
                    <button onClick={() => void executeMarketAction("DISPUTE",{evidence:resolutionEvidence})} disabled={busy || !wallet || !resolutionEvidence.trim() || wallet===resolution?.proposer} className="mt-2 w-full rounded-xl border border-rose-300/20 bg-rose-300/[.07] py-3 text-sm font-semibold text-rose-200 disabled:opacity-30">Dispute · bond {disputeBond.toFixed(2)} USDG</button>
                  </> : <button onClick={() => void executeMarketAction("FINALIZE")} disabled={busy || !wallet} className="mt-4 w-full rounded-xl bg-[#b7ff3c] py-3 text-sm font-semibold text-black disabled:opacity-35">Finalize uncontested resolution</button>}
                </div>
              );

              if (status === "DISPUTED") return (
                <div className="mt-5 rounded-2xl border border-rose-300/15 bg-rose-300/[.04] p-4">
                  <div className="text-sm font-semibold text-rose-200">Resolution disputed</div>
                  <div className="mt-2 text-xs text-white/35">Escalation deadline {when(resolution?.escalationDeadline)}</div>
                  {wallet && wallet === config?.authority && <><div className="mt-4 grid grid-cols-3 gap-2">{(["YES","NO","INVALID"] as const).map(value=><button key={value} onClick={()=>setResolutionOutcome(value)} className={`rounded-lg border px-2 py-2 text-[10px] ${resolutionOutcome===value?"border-white/30 bg-white/[.08]":"border-white/[.07]"}`}>{value==="YES"?yesLabel:value==="NO"?noLabel:"Invalid"}</button>)}</div><button onClick={()=>void executeMarketAction("RESOLVE_DISPUTE",{outcome:resolutionOutcome,adjudication:resolutionEvidence||"Mary Jane adjudication"})} disabled={busy} className="mt-2 w-full rounded-xl bg-white py-3 text-sm font-semibold text-black">Adjudicate dispute</button></>}
                  {now >= Number(resolution?.escalationDeadline||0) && <button onClick={()=>void executeMarketAction("CANCEL_STALLED")} disabled={busy || !wallet} className="mt-3 w-full rounded-xl border border-white/[.1] py-3 text-xs text-white/55">Cancel stalled dispute as invalid</button>}
                </div>
              );

              if (status === "RESOLVED_YES" || status === "RESOLVED_NO") return (
                <div className="mt-5 rounded-2xl border border-emerald-300/15 bg-emerald-300/[.05] p-4">
                  <div className="text-sm font-semibold text-emerald-200">Resolved: {status==="RESOLVED_YES"?yesLabel:noLabel}</div>
                  <div className="mt-2 text-xs text-white/40">{winningBalance > 0 ? `${winningBalance.toFixed(2)} winning shares are claimable for ${winningBalance.toFixed(2)} USDG.` : "This wallet has no winning shares to redeem."}</div>
                  {winningBalance>0&&<button onClick={()=>void executeMarketAction("REDEEM")} disabled={busy || !wallet} className="mt-4 w-full rounded-xl bg-[#b7ff3c] py-3 text-sm font-semibold text-black">Redeem {winningBalance.toFixed(2)} USDG</button>}
                </div>
              );

              if (status === "CANCELLED") return (
                <div className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-300/[.05] p-4">
                  <div className="text-sm font-semibold text-amber-200">Market resolved invalid</div>
                  <div className="mt-2 text-xs text-white/40">Outcome shares can be refunded at the protocol's invalid-market settlement rate. Estimated claim: {refundEstimate.toFixed(2)} USDG.</div>
                  {refundEstimate>0&&<button onClick={()=>void executeMarketAction("REFUND")} disabled={busy || !wallet} className="mt-4 w-full rounded-xl bg-amber-200 py-3 text-sm font-semibold text-black">Claim refund</button>}
                </div>
              );

              return <div className="mt-5 text-xs text-white/30">Settlement state unavailable.</div>;
            })()}
          </div>

        </section>

        <aside className="xl:sticky xl:top-24 xl:h-fit">
          <div className="rounded-3xl border border-white/[.09] bg-[#0b0b0b] p-5 shadow-2xl">
            <div className="flex items-center justify-between"><div className="text-lg font-semibold">Trade</div><div className="text-xs text-white/25">Limit order</div></div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(["BUY", "SELL"] as const).map((value) => (
                <button key={value} onClick={() => setKind(value)} className={`rounded-xl py-2.5 text-xs font-semibold ${kind === value ? "bg-white text-black" : "bg-white/[.04] text-white/38"}`}>{value}</button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["YES", "NO"] as const).map((value) => {
                const bps = value === "YES" ? yesBps : 10_000 - yesBps;
                return (
                  <button key={value} onClick={() => setSide(value)} className={`rounded-2xl border p-4 text-left ${side === value ? value === "YES" ? "border-emerald-300/40 bg-emerald-300/[.08]" : "border-rose-300/40 bg-rose-300/[.08]" : "border-white/[.07]"}`}>
                    <div className="flex items-center gap-2">
                      {imageFor(value) && <img src={imageFor(value)} alt="" className="h-7 w-7 rounded-full border border-white/10 bg-white object-cover" />}
                      <div className="min-w-0">
                        <div className="truncate text-[10px] text-white/45">{labelFor(value)}</div>
                        <div className={`mt-1 text-2xl font-semibold ${value === "YES" ? "text-emerald-300" : "text-rose-300"}`}>{(bps / 100).toFixed(0)}¢</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <label className="mt-5 block text-[10px] uppercase tracking-wider text-white/25">
              Limit price
              <div className="mt-2 flex items-center rounded-xl border border-white/[.08] bg-black/30 px-3">
                <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="w-full bg-transparent py-3 text-lg outline-none" />
                <span className="text-white/30">¢</span>
              </div>
            </label>
            <label className="mt-3 block text-[10px] uppercase tracking-wider text-white/25">
              Shares
              <input value={shares} onChange={(event) => setShares(event.target.value)} inputMode="decimal" className="mt-2 w-full rounded-xl border border-white/[.08] bg-black/30 p-3 text-lg outline-none" />
            </label>

            <div className="mt-4 space-y-2 rounded-xl bg-white/[.025] p-3 text-xs">
              <div className="flex justify-between text-white/35">
                <span>{kind === "BUY" ? "Max cost" : "Proceeds if filled"}</span>
                <span className="font-medium text-white/80">${estimatedCost.toFixed(2)} USDG</span>
              </div>
              <div className="flex justify-between text-white/35">
                <span>{kind === "BUY" ? "Winning payout" : "Shares committed"}</span>
                <span className="text-white/70">{kind === "BUY" ? `${potentialPayout.toFixed(2)} USDG` : `${potentialPayout.toFixed(2)} ${labelFor(side)}`}</span>
              </div>
              <div className="flex justify-between text-white/35">
                <span>{kind === "BUY" ? "Max profit if correct" : "Order proceeds"}</span>
                <span className={kind === "BUY" ? "text-[#b7ff3c]" : "text-white/70"}>${maxProfit.toFixed(2)} USDG</span>
              </div>
              <div className="flex justify-between text-white/35"><span>Implied probability</span><span className="text-white/70">{impliedProbability.toFixed(2)}%</span></div>
              <div className="my-2 border-t border-white/[.06]" />
              <div className="flex justify-between text-white/35"><span>Devnet SOL</span><span className="text-white/70">{wallet ? traderState ? traderState.sol.uiAmount.toFixed(4) : "Loading…" : "—"}</span></div>
              <div className="flex justify-between text-white/35"><span>USDG balance</span><span className="text-white/70">{wallet ? traderState ? traderState.collateral.uiAmount.toFixed(2) : "Loading…" : "—"}</span></div>
              <div className="flex justify-between text-white/35"><span>{labelFor(side)} balance</span><span className="text-white/70">{wallet ? traderState ? (side === "YES" ? traderState.yes.uiAmount : traderState.no.uiAmount).toFixed(2) : "Loading…" : "—"}</span></div>
              <div className="flex justify-between text-white/35"><span>Network</span><span className="text-white/70">Solana Devnet</span></div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/[.07] bg-white/[.018] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Outcome inventory</div>
                  <div className="mt-1 text-[10px] leading-4 text-white/28">1 USDG creates 1 {yesLabel} + 1 {noLabel}. Use these shares to sell into resting bids.</div>
                </div>
                <div className="text-right text-[10px] text-white/28">
                  <div>{yesLabel} {traderState ? traderState.yes.uiAmount.toFixed(2) : "—"}</div>
                  <div>{noLabel} {traderState ? traderState.no.uiAmount.toFixed(2) : "—"}</div>
                </div>
              </div>

              <div className="mt-3 flex items-center rounded-xl border border-white/[.08] bg-black/30 px-3">
                <input
                  value={completeSetAmount}
                  onChange={(event) => setCompleteSetAmount(event.target.value)}
                  inputMode="decimal"
                  className="w-full bg-transparent py-3 text-sm outline-none"
                  placeholder="10"
                />
                <span className="text-xs text-white/30">USDG</span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => void completeSetAction("SPLIT")}
                  disabled={busy || !wallet || state?.market.status !== "OPEN" || Boolean(traderState && Number(completeSetAmount || 0) > traderState.collateral.uiAmount)}
                  className="rounded-xl bg-[#b7ff3c] px-3 py-3 text-xs font-semibold text-black disabled:opacity-35"
                >
                  Split → outcomes
                </button>
                <button
                  onClick={() => void completeSetAction("MERGE")}
                  disabled={busy || !wallet || !traderState || Number(completeSetAmount || 0) <= 0 || traderState.yes.uiAmount < Number(completeSetAmount || 0) || traderState.no.uiAmount < Number(completeSetAmount || 0)}
                  className="rounded-xl border border-white/[.09] bg-white/[.04] px-3 py-3 text-xs font-semibold text-white/65 disabled:opacity-25"
                >
                  Merge → USDG
                </button>
              </div>
            </div>

            {wallet && traderState && traderState.sol.uiAmount < 0.01 && (
              <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[.07] p-3 text-xs leading-5 text-amber-200">
                Low Devnet SOL. Your first order creates onchain accounts and needs SOL for fees + rent. Fund this wallet with Devnet SOL, then retry.
              </div>
            )}
            {insufficientBalance && (
              <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[.07] p-3 text-xs leading-5 text-amber-200">
                Insufficient {kind === "BUY" ? "Devnet USDG" : `${labelFor(side)} shares`}. Need {requiredForOrder.toFixed(2)}, have {(availableForOrder ?? 0).toFixed(2)}.
              </div>
            )}
            {notice && <div className="mt-3 rounded-xl border border-white/[.07] bg-white/[.025] p-3 text-xs leading-5 text-white/65">{notice}</div>}
            {error && <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/[.08] p-3 text-xs text-rose-300">{error}</div>}

            <button onClick={() => void placeOrder()} disabled={busy || state?.market.status !== "OPEN" || insufficientBalance} className={`mt-4 w-full rounded-xl py-4 text-sm font-semibold disabled:opacity-35 ${side === "YES" ? "bg-emerald-300 text-black" : "bg-rose-300 text-black"}`}>
              {busy
                ? "Confirming on Solana…"
                : !wallet
                  ? "Connect wallet to trade"
                  : insufficientBalance
                    ? `Need ${requiredForOrder.toFixed(2)} ${kind === "BUY" ? "USDG" : side}`
                    : `${kind} ${labelFor(side)} @ ${price}¢`}
            </button>

            <p className="mt-4 text-[10px] leading-4 text-white/20">
              No fake liquidity. Prices come from real resting orders and matched fills on the Mary Jane Devnet program.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
