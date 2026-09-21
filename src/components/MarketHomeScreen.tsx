import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Clock3, ExternalLink, Flame, Globe2, Search, Sparkles, Trophy, Wallet, Zap } from "lucide-react";
import { Transaction } from "@solana/web3.js";
import NativeMarketTerminal from "./NativeMarketTerminal";

type Source = "maryjane" | "polymarket" | "manifold";
type Market = {
  id: string;
  source: Source;
  sourceMarketId: string;
  title: string;
  description?: string;
  category: string;
  outcomes: Array<{ id: string; label: string; probability: number }>;
  volume24h?: number;
  volumeTotal?: number;
  traders?: number;
  tradeCount?: number;
  createdAt?: string;
  closesAt?: string;
  resolved: boolean;
  externalUrl?: string;
  nativeAddress?: string;
  nativeMarketSeed?: string;
  status?: string;
  probabilitySource: "last-match" | "external" | "pool-reference" | "unknown";
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
type OrderBook = {
  yes: { bids: BookOrder[]; asks: BookOrder[]; bestBidBps: number | null; bestAskBps: number | null };
  no: { bids: BookOrder[]; asks: BookOrder[]; bestBidBps: number | null; bestAskBps: number | null };
  lastMatchedYesBps: number | null;
  lastMatchedAt: number | null;
  volume24hBaseUnits: string;
  totalMatchedVolumeBaseUnits: string;
  tradeCount: number;
  traderCount: number;
};

const categories = [
  ["Trending", Flame],
  ["New", Clock3],
  ["Crypto", Zap],
  ["Sports", Trophy],
  ["Tech", Sparkles],
  ["World", Globe2],
] as const;

function provider() { return (window as any).solana; }
function short(value: string, left = 5, right = 4) { return value.length > left + right + 1 ? `${value.slice(0,left)}…${value.slice(-right)}` : value; }
function money(value?: number) {
  if (!value) return "$0";
  return new Intl.NumberFormat("en", { notation: value >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}
function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function jsonOrThrow(response: Response) {
  const data = await response.json().catch(() => ({}));
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

function sourceLabel(source: Source) {
  if (source === "maryjane") return "MARY JANE";
  return source.toUpperCase();
}

export function MarketHomeScreen() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [category, setCategory] = useState("Trending");
  const [search, setSearch] = useState("");
  const [wallet, setWallet] = useState("");
  const [selected, setSelected] = useState<Market | null>(null);
  const [book, setBook] = useState<OrderBook | null>(null);
  const [bookSide, setBookSide] = useState<"YES" | "NO">("YES");
  const [orderKind, setOrderKind] = useState<"BUY" | "SELL">("BUY");
  const [price, setPrice] = useState("50");
  const [shares, setShares] = useState("1");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [sourceHealth, setSourceHealth] = useState<string[]>([]);

  const load = async () => {
    try {
      const response = await fetch("/api/discovery-feed?limit=180");
      const data = await jsonOrThrow(response);
      const hydrated = (data.items || []).map((market: Market) => {
        if (market.source !== "maryjane" || !market.nativeAddress) return market;
        try {
          const raw = localStorage.getItem(`maryjane:market-meta:${market.nativeAddress}`);
          if (!raw) return market;
          const meta = JSON.parse(raw);
          return {
            ...market,
            title: meta.question || market.title,
            description: meta.description || market.description,
            category: meta.category || market.category,
            createdAt: meta.createdAt || market.createdAt,
          };
        } catch {
          return market;
        }
      });
      setMarkets(hydrated);
      setSourceHealth(data.errors || []);
    } catch {
      setSourceHealth(["feed:unavailable"]);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selected?.nativeAddress) { setBook(null); return; }
    let active = true;
    const loadBook = async () => {
      const response = await fetch(`/api/market-book?market=${selected.nativeAddress}`);
      if (!response.ok) return;
      const data = await response.json();
      if (active) setBook(data);
    };
    void loadBook();
    const timer = window.setInterval(() => void loadBook(), 8_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selected?.nativeAddress]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return markets
      .filter((market) => !q || `${market.title} ${market.category} ${market.source}`.toLowerCase().includes(q))
      .filter((market) => category === "Trending" || category === "New" || market.category.toLowerCase() === category.toLowerCase())
      .sort((a, b) => {
        if (category === "New") {
          const createdDelta =
            new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
          if (createdDelta !== 0) return createdDelta;
          if (a.source === "maryjane" && b.source !== "maryjane") return -1;
          if (b.source === "maryjane" && a.source !== "maryjane") return 1;
          return 0;
        }
        return (b.volume24h || b.volumeTotal || 0) - (a.volume24h || a.volumeTotal || 0);
      });
  }, [markets, category, search]);

  const connect = async () => {
    const p = provider();
    if (!p?.connect) return setNotice("Install or unlock a compatible Solana wallet.");
    const result = await p.connect();
    setWallet(result.publicKey.toString());
  };

  const placeOrder = async () => {
    if (!selected?.nativeMarketSeed) return;
    if (!wallet) { await connect(); return; }
    const px = Number(price);
    const qty = Number(shares);
    if (!Number.isFinite(px) || px <= 0 || px >= 100) return setNotice("Price must be between 0.01¢ and 99.99¢.");
    if (!Number.isFinite(qty) || qty <= 0) return setNotice("Enter a positive share amount.");
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/order-place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          market: selected.nativeAddress,
          side: bookSide,
          kind: orderKind,
          priceBps: Math.round(px * 100),
          sharesBaseUnits: String(Math.round(qty * 1_000_000)),
        }),
      });
      const data = await jsonOrThrow(response);
      const signature = await signBuiltTransaction(data.transactionBase64);
      setNotice(`Order submitted · ${short(signature, 8, 8)}`);
      window.setTimeout(() => void load(), 1500);
    } catch (error: any) {
      setNotice(error?.message || "Unable to place order.");
    } finally {
      setBusy(false);
    }
  };

  const fillOrder = async (order: BookOrder) => {
    if (!wallet) { await connect(); return; }
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/order-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, order: order.order, sharesBaseUnits: order.remainingShares }),
      });
      const data = await jsonOrThrow(response);
      const signature = await signBuiltTransaction(data.transactionBase64);
      setNotice(`Matched · ${short(signature, 8, 8)}`);
    } catch (error: any) {
      setNotice(error?.message || "Unable to fill order.");
    } finally {
      setBusy(false);
    }
  };

  const nativeCount = markets.filter((m) => m.source === "maryjane").length;
  const externalCount = markets.length - nativeCount;

  return (
    <div className="min-h-screen bg-[#060606] text-[#f5f5ef]">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#060606]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center gap-5 px-5 py-4">
          <a href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#b7ff3c] text-sm font-black text-black">M</div>
            <span className="text-lg font-semibold tracking-[-.03em]">Mary Jane</span>
          </a>
          <nav className="hidden items-center gap-1 lg:flex">
            <a href="/" className="rounded-full bg-white/[0.08] px-4 py-2 text-sm">Markets</a>
            <a href="/create" className="rounded-full px-4 py-2 text-sm text-white/50 hover:text-white">Create</a>
            <a href="/beta" className="rounded-full px-4 py-2 text-sm text-white/50 hover:text-white">Beta</a>
            <a href="/analytics" className="rounded-full px-4 py-2 text-sm text-white/50 hover:text-white">Analytics</a>
          </nav>
          <div className="ml-auto hidden w-[310px] items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 md:flex">
            <Search className="h-4 w-4 text-white/25" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all prediction markets" className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-white/25" />
          </div>
          <button onClick={connect} className="flex items-center gap-2 rounded-xl bg-[#f2f2ed] px-4 py-2.5 text-sm font-semibold text-black">
            <Wallet className="h-4 w-4" />{wallet ? short(wallet) : "Connect"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 pb-20">
        <section className="border-b border-white/[0.06] py-10 md:py-14">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <div className="mb-4 text-xs font-medium uppercase tracking-[.2em] text-[#b7ff3c]">Prediction market terminal</div>
              <h1 className="text-4xl font-semibold leading-[.98] tracking-[-.055em] sm:text-6xl">One feed for what the world thinks happens next.</h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-white/42">Discover public markets across Mary Jane, Polymarket and Manifold. Create permissionless Solana markets and trade native markets through an onchain order book.</p>
            </div>
            <div className="grid min-w-[310px] grid-cols-3 gap-2">
              {[["Native", nativeCount],["External", externalCount],["Sources", 3]].map(([label,value]) => <div key={label} className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4"><div className="text-2xl font-semibold">{value}</div><div className="mt-1 text-[11px] text-white/30">{label}</div></div>)}
            </div>
          </div>
        </section>

        <section className="py-7">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {categories.map(([label, Icon]) => (
              <button key={label} onClick={() => setCategory(label)} className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${category === label ? "border-white bg-white text-black" : "border-white/[.08] bg-white/[.025] text-white/45 hover:text-white"}`}>
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </div>

          <div className="mt-7 flex items-end justify-between gap-5">
            <div><div className="text-xs uppercase tracking-[.18em] text-white/28">{category}</div><h2 className="mt-2 text-2xl font-semibold tracking-[-.035em]">{category === "Trending" ? "Markets moving now" : category === "New" ? "Recently surfaced markets" : `${category} markets`}</h2></div>
            <div className="text-right text-xs text-white/25">{sourceHealth.length ? "Some external sources are temporarily unavailable" : "Mary Jane · Polymarket · Manifold"}</div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((market) => {
              const yes = market.outcomes.find((o) => o.label === "YES")?.probability ?? .5;
              const no = market.outcomes.find((o) => o.label === "NO")?.probability ?? 1 - yes;
              return (
                <button key={market.id} onClick={() => { setSelected(market); setBookSide(yes >= no ? "YES" : "NO"); setPrice(String(Math.round((yes >= no ? yes : no) * 100))); setNotice(""); }} className="group rounded-2xl border border-white/[.08] bg-[#0c0c0c] p-5 text-left transition hover:-translate-y-0.5 hover:border-white/[.16]">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[.12em] ${market.source === "maryjane" ? "bg-[#b7ff3c]/12 text-[#caff75]" : "bg-white/[.06] text-white/38"}`}>{sourceLabel(market.source)}</span>
                    <span className="text-[10px] uppercase tracking-wider text-white/28">{market.category}</span>
                  </div>
                  <h3 className="mt-5 min-h-[72px] text-xl font-semibold leading-6 tracking-[-.025em] text-white/90">{market.title}</h3>
                  <div className="mt-6 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-emerald-400/[.10] px-3 py-3"><div className="text-[10px] text-emerald-300/55">YES</div><div className="mt-1 text-xl font-semibold text-emerald-300">{Math.round(yes*100)}¢</div></div>
                    <div className="rounded-xl bg-rose-400/[.10] px-3 py-3"><div className="text-[10px] text-rose-300/55">NO</div><div className="mt-1 text-xl font-semibold text-rose-300">{Math.round(no*100)}¢</div></div>
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t border-white/[.06] pt-4 text-xs text-white/30">
                    <span>{money(market.volume24h || market.volumeTotal)} vol</span>
                    <span>{market.probabilitySource === "last-match" ? "Last matched" : market.source === "maryjane" ? "Indicative" : "External probability"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </main>

      {selected?.source === "maryjane" && (
        <NativeMarketTerminal
          market={selected}
          wallet={wallet}
          onConnect={connect}
          onClose={() => setSelected(null)}
        />
      )}

      {selected && selected.source !== "maryjane" && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <aside className="h-full w-full max-w-[560px] overflow-y-auto border-l border-white/[.08] bg-[#090909] p-6" onClick={(event) => event.stopPropagation()}>
            <button onClick={() => setSelected(null)} className="text-sm text-white/35 hover:text-white">← Back</button>
            <div className="mt-7 flex items-center justify-between">
              <span className="rounded-full bg-white/[.06] px-2.5 py-1 text-[10px] font-semibold tracking-[.12em] text-white/45">{sourceLabel(selected.source)}</span>
              <span className="text-xs text-white/28">{selected.category}</span>
            </div>
            <h2 className="mt-4 text-3xl font-semibold leading-9 tracking-[-.045em]">{selected.title}</h2>
            {selected.description && <p className="mt-4 text-sm leading-6 text-white/40">{selected.description.slice(0, 700)}</p>}
            <div className="mt-8 rounded-2xl border border-white/[.08] bg-white/[.025] p-5">
              <div className="text-xs uppercase tracking-[.16em] text-white/30">External discovery market</div>
              <p className="mt-3 text-sm leading-6 text-white/45">Mary Jane indexes this market for discovery. Orders and settlement remain on the source venue.</p>
              {selected.externalUrl && (
                <a href={selected.externalUrl} target="_blank" rel="noreferrer" className="mt-5 flex items-center justify-between rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black">
                  Open on {sourceLabel(selected.source)} <ExternalLink className="h-4 w-4"/>
                </a>
              )}
            </div>
          </aside>
        </div>
      )}

    </div>
  );
}
export default MarketHomeScreen;
