import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BarChart3, Wallet } from "lucide-react";
import { Transaction } from "@solana/web3.js";

type Market = {
  title: string;
  description?: string;
  category: string;
  nativeAddress?: string;
  nativeMarketSeed?: string;
  closesAt?: string;
  status?: string;
  outcomes: Array<{ label: string; probability: number }>;
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
async function signBuiltTransaction(transactionBase64: string) {
  const wallet = provider();
  if (!wallet?.signAndSendTransaction) throw new Error("Connect a compatible Solana wallet first.");
  const tx = Transaction.from(fromBase64(transactionBase64));
  const result = await wallet.signAndSendTransaction(tx);
  return typeof result === "string" ? result : result.signature;
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
  const [error, setError] = useState("");
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [kind, setKind] = useState<"BUY" | "SELL">("BUY");
  const [price, setPrice] = useState("50");
  const [shares, setShares] = useState("1");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const address = market.nativeAddress || "";
  const load = async () => {
    if (!address) return;
    try {
      const response = await fetch(`/api/native-market-state?address=${encodeURIComponent(address)}`);
      const data = await jsonOrThrow(response);
      setState(data);
      setError("");
    } catch (err: any) {
      setError(err?.message || "Unable to load live market state");
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [address]);

  const fallbackYes = Math.round((market.outcomes.find((outcome) => outcome.label === "YES")?.probability ?? .5) * 10_000);
  const yesBps = state?.book.lastMatchedYesBps ?? state?.market.reserveYesBps ?? fallbackYes;
  const selectedBps = side === "YES" ? yesBps : 10_000 - yesBps;
  const book = state?.book[side.toLowerCase() as "yes" | "no"];
  const spread = book?.bestBidBps != null && book?.bestAskBps != null ? book.bestAskBps - book.bestBidBps : null;
  const estimatedCost = (Number(shares) || 0) * (Number(price) || 0) / 100;

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
    if (!market.nativeMarketSeed) return;
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
          marketSeed: market.nativeMarketSeed,
          side,
          kind,
          priceBps: Math.round(px * 100),
          sharesBaseUnits: String(Math.round(qty * 1e6)),
        }),
      });
      const data = await jsonOrThrow(response);
      const signature = await signBuiltTransaction(data.transactionBase64);
      setNotice(`Order submitted · ${short(signature)}`);
      window.setTimeout(() => void load(), 1800);
    } catch (err: any) {
      setNotice(err?.message || "Unable to place order");
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
      const signature = await signBuiltTransaction(data.transactionBase64);
      setNotice(`Matched · ${short(signature)}`);
      window.setTimeout(() => void load(), 1800);
    } catch (err: any) {
      setNotice(err?.message || "Unable to fill order");
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
              <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-[-.045em] md:text-5xl">{market.title}</h1>
              {market.description && <p className="mt-4 max-w-3xl text-sm leading-6 text-white/38">{market.description}</p>}
            </div>
            <div className="shrink-0 lg:text-right">
              <div className="text-xs text-white/30">YES probability</div>
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
              <div className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4" />YES probability</div>
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
                    <button key={value} onClick={() => setSide(value)} className={`rounded-lg px-4 py-1.5 text-xs font-semibold ${side === value ? value === "YES" ? "bg-emerald-300 text-black" : "bg-rose-300 text-black" : "text-white/35"}`}>{value}</button>
                  ))}
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <div className="mb-2 flex justify-between text-[10px] uppercase tracking-wider text-white/25"><span>Bids</span><span>Shares</span></div>
                  {(book?.bids || []).slice(0, 10).map((order) => (
                    <button key={order.order} onClick={() => void takeOrder(order)} className="mb-1 flex w-full justify-between rounded-lg bg-emerald-400/[.06] px-3 py-2 text-xs hover:bg-emerald-400/[.12]">
                      <span className="text-emerald-300">{(order.priceBps / 100).toFixed(2)}¢</span>
                      <span className="text-white/38">{(Number(order.remainingShares) / 1e6).toFixed(2)}</span>
                    </button>
                  ))}
                  {!book?.bids.length && <div className="py-8 text-center text-xs text-white/22">No bids</div>}
                </div>
                <div>
                  <div className="mb-2 flex justify-between text-[10px] uppercase tracking-wider text-white/25"><span>Asks</span><span>Shares</span></div>
                  {(book?.asks || []).slice(0, 10).map((order) => (
                    <button key={order.order} onClick={() => void takeOrder(order)} className="mb-1 flex w-full justify-between rounded-lg bg-rose-400/[.06] px-3 py-2 text-xs hover:bg-rose-400/[.12]">
                      <span className="text-rose-300">{(order.priceBps / 100).toFixed(2)}¢</span>
                      <span className="text-white/38">{(Number(order.remainingShares) / 1e6).toFixed(2)}</span>
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
                    <span className={trade.side === "YES" ? "text-emerald-300" : "text-rose-300"}>{(trade.yesPriceBps / 100).toFixed(2)}¢ YES</span>
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
                    <div className="text-[10px] text-white/30">{value}</div>
                    <div className={`mt-1 text-2xl font-semibold ${value === "YES" ? "text-emerald-300" : "text-rose-300"}`}>{(bps / 100).toFixed(0)}¢</div>
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
              <div className="flex justify-between text-white/35"><span>{kind === "BUY" ? "Max cost" : "Order value"}</span><span className="text-white/70">${estimatedCost.toFixed(2)}</span></div>
              <div className="flex justify-between text-white/35"><span>Potential payout</span><span className="text-white/70">${(Number(shares) || 0).toFixed(2)}</span></div>
              <div className="flex justify-between text-white/35"><span>Network</span><span className="text-white/70">Solana Devnet</span></div>
            </div>

            <button onClick={() => void placeOrder()} disabled={busy || state?.market.status !== "OPEN"} className={`mt-4 w-full rounded-xl py-4 text-sm font-semibold disabled:opacity-35 ${side === "YES" ? "bg-emerald-300 text-black" : "bg-rose-300 text-black"}`}>
              {busy ? "Preparing transaction…" : wallet ? `${kind} ${side} @ ${price}¢` : "Connect wallet to trade"}
            </button>

            {notice && <div className="mt-3 rounded-xl border border-white/[.07] bg-white/[.025] p-3 text-xs leading-5 text-white/55">{notice}</div>}
            {error && <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/[.08] p-3 text-xs text-rose-300">{error}</div>}

            <p className="mt-4 text-[10px] leading-4 text-white/20">
              No fake liquidity. Prices come from real resting orders and matched fills on the Mary Jane Devnet program.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
