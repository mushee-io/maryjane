import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  ChevronRight,
  Clock3,
  Flame,
  Globe2,
  Search,
  Sparkles,
  Trophy,
  Wallet,
  Zap,
} from "lucide-react";
import { Transaction } from "@solana/web3.js";

type Market = {
  address: string;
  authority: string;
  marketSeed: string;
  questionHash: string;
  metadataHash: string;
  closeTs: number;
  resolutionTs: number;
  status: string;
  volume: string;
  collateralVaultBalance: string;
  yesProbabilityBps: number;
  noProbabilityBps: number;
};

type MarketLintReport = {
  certifiedAt?: number;
  input: {
    question: string;
    description?: string;
    category?: string;
    source?: string;
    deadline?: string;
  };
  hashes: {
    marketSeed: string;
    questionHash: string;
    metadataHash: string;
  };
};

type Analytics = {
  totalMarkets: number;
  openMarkets: number;
  volume24hBaseUnits: string;
  activeTraders24h: number;
};

const SCALE = 1_000_000n;

function formatUnits(value: string | bigint, digits = 0) {
  const amount = typeof value === "bigint" ? value : BigInt(value || "0");
  const whole = amount / SCALE;
  const fraction = (amount % SCALE).toString().padStart(6, "0").slice(0, digits);
  return digits ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString();
}

function short(value: string, left = 5, right = 4) {
  return value.length <= left + right + 1
    ? value
    : `${value.slice(0, left)}…${value.slice(-right)}`;
}

async function jsonOrThrow(response: Response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("market-api-unavailable");
  }
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data?.error || "Request failed");
  return data;
}

function provider() {
  return (window as any).solana;
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signBuiltTransaction(transactionBase64: string) {
  const wallet = provider();
  if (!wallet?.signAndSendTransaction) {
    throw new Error("Connect a compatible Solana wallet first.");
  }
  const tx = Transaction.from(fromBase64(transactionBase64));
  const result = await wallet.signAndSendTransaction(tx);
  return typeof result === "string" ? result : result.signature;
}

const categories = [
  { label: "Trending", icon: Flame },
  { label: "Crypto", icon: Zap },
  { label: "Sports", icon: Trophy },
  { label: "World", icon: Globe2 },
  { label: "Tech", icon: Sparkles },
];

export function MarketHomeScreen() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [reports, setReports] = useState<MarketLintReport[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [category, setCategory] = useState("Trending");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Market | null>(null);
  const [wallet, setWallet] = useState("");
  const [tradeSide, setTradeSide] = useState<"YES" | "NO">("YES");
  const [tradeAmount, setTradeAmount] = useState("1");
  const [tradeBusy, setTradeBusy] = useState(false);
  const [tradeNotice, setTradeNotice] = useState("");
  const [feedAvailable, setFeedAvailable] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [marketsRes, reportsRes, analyticsRes] = await Promise.all([
          fetch("/api/v1/markets?sort=volume&limit=100"),
          fetch("/api/v1/marketlint/reports?limit=250"),
          fetch("/api/v1/analytics/protocol"),
        ]);

        const [marketJson, reportJson, analyticsJson] = await Promise.all([
          jsonOrThrow(marketsRes),
          jsonOrThrow(reportsRes),
          jsonOrThrow(analyticsRes),
        ]);

        if (!active) return;
        setMarkets(marketJson.items || []);
        setReports(reportJson.items || []);
        setAnalytics(analyticsJson);
        setFeedAvailable(true);
      } catch {
        if (!active) return;
        setFeedAvailable(false);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const reportsBySeed = useMemo(
    () => new Map(reports.map((report) => [report.hashes.marketSeed, report])),
    [reports],
  );

  const visibleMarkets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return markets.filter((market) => {
      const report = reportsBySeed.get(market.marketSeed);
      const marketCategory = report?.input.category || "Other";
      const categoryOk =
        category === "Trending" ||
        marketCategory.toLowerCase() === category.toLowerCase();
      const haystack = `${report?.input.question || ""} ${market.address} ${marketCategory}`.toLowerCase();
      return categoryOk && (!q || haystack.includes(q));
    });
  }, [markets, reportsBySeed, category, search]);

  const connect = async () => {
    const p = provider();
    if (!p?.connect) {
      setTradeNotice("Install or unlock a compatible Solana wallet.");
      return;
    }
    const result = await p.connect();
    setWallet(result.publicKey.toString());
  };

  const trade = async () => {
    if (!selected) return;
    if (!wallet) {
      await connect();
      return;
    }

    setTradeBusy(true);
    setTradeNotice("");
    try {
      const amount = Number(tradeAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid USDG amount.");

      const response = await fetch("/api/v1/markets/trade-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          marketSeed: selected.marketSeed,
          side: tradeSide,
          direction: "BUY",
          amountInBaseUnits: String(Math.round(amount * 1_000_000)),
          minAmountOutBaseUnits: "1",
        }),
      });
      const data = await jsonOrThrow(response);
      const signature = await signBuiltTransaction(data.transactionBase64);
      setTradeNotice(`Submitted on Devnet · ${short(signature, 8, 8)}`);
    } catch (error: any) {
      setTradeNotice(
        error?.message === "market-api-unavailable"
          ? "Trading API is redeploying. Try again shortly."
          : error?.message || "Unable to submit trade.",
      );
    } finally {
      setTradeBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070707] text-[#f6f6f2]">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#070707]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] items-center gap-5 px-5 py-4">
          <a href="/" className="mr-2 flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#b7ff3c] text-sm font-black text-black">
              M
            </div>
            <span className="text-lg font-semibold tracking-[-0.03em]">Mary Jane</span>
          </a>

          <nav className="hidden items-center gap-1 lg:flex">
            <a href="/" className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-medium">Markets</a>
            <a href="/create" className="rounded-full px-4 py-2 text-sm text-white/55 hover:bg-white/[0.05] hover:text-white">Create</a>
            <a href="/beta" className="rounded-full px-4 py-2 text-sm text-white/55 hover:bg-white/[0.05] hover:text-white">Beta</a>
            <a href="/analytics" className="rounded-full px-4 py-2 text-sm text-white/55 hover:bg-white/[0.05] hover:text-white">Analytics</a>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden w-[280px] items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 md:flex">
              <Search className="h-4 w-4 text-white/25" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search markets"
                className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-white/25"
              />
            </div>
            <button
              onClick={connect}
              className="flex items-center gap-2 rounded-xl bg-[#f2f2ed] px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-white"
            >
              <Wallet className="h-4 w-4" />
              {wallet ? short(wallet) : "Connect"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 pb-20">
        <section className="border-b border-white/[0.06] py-12 md:py-16">
          <div className="max-w-4xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#b7ff3c]/20 bg-[#b7ff3c]/10 px-3 py-1.5 text-xs font-medium text-[#c9ff72]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#b7ff3c]" />
              Solana Devnet live
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-6xl md:text-7xl">
              Predict what happens next.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-white/45 md:text-lg">
              Trade outcomes, launch markets and price uncertainty on Solana.
              Permissionless markets with onchain liquidity and transparent resolution.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="/create" className="flex items-center gap-2 rounded-xl bg-[#b7ff3c] px-5 py-3 text-sm font-semibold text-black hover:brightness-105">
                Create a market <ArrowRight className="h-4 w-4" />
              </a>
              <a href="/beta" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-medium text-white/70 hover:bg-white/[0.05]">
                Open Mary Jane Beta
              </a>
            </div>
          </div>

          <div className="mt-10 grid max-w-3xl grid-cols-3 gap-6 border-t border-white/[0.06] pt-6">
            <div>
              <div className="text-2xl font-semibold tracking-tight">{analytics?.openMarkets ?? markets.filter((m) => m.status === "OPEN").length}</div>
              <div className="mt-1 text-xs text-white/30">Open markets</div>
            </div>
            <div>
              <div className="text-2xl font-semibold tracking-tight">{analytics ? formatUnits(analytics.volume24hBaseUnits) : "0"}</div>
              <div className="mt-1 text-xs text-white/30">24h USDG volume</div>
            </div>
            <div>
              <div className="text-2xl font-semibold tracking-tight">{analytics?.activeTraders24h ?? 0}</div>
              <div className="mt-1 text-xs text-white/30">24h traders</div>
            </div>
          </div>
        </section>

        <section className="py-8">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {categories.map(({ label, icon: Icon }) => (
              <button
                key={label}
                onClick={() => setCategory(label)}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                  category === label
                    ? "border-white bg-white text-black"
                    : "border-white/[0.08] bg-white/[0.025] text-white/45 hover:text-white"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="mt-7 flex items-end justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-white/30">
                {category}
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
                {category === "Trending" ? "Markets people are watching" : `${category} markets`}
              </h2>
            </div>
            <div className="hidden text-xs text-white/25 sm:block">
              {feedAvailable ? "Live from Solana Devnet" : "Market feed reconnecting"}
            </div>
          </div>

          {visibleMarkets.length > 0 ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleMarkets.map((market) => {
                const report = reportsBySeed.get(market.marketSeed);
                const question = report?.input.question || `Market ${short(market.address, 8, 6)}`;
                const marketCategory = report?.input.category || "Prediction";
                const yes = market.yesProbabilityBps / 100;
                const no = market.noProbabilityBps / 100;

                return (
                  <button
                    key={market.address}
                    onClick={() => {
                      setSelected(market);
                      setTradeSide(yes >= no ? "YES" : "NO");
                      setTradeNotice("");
                    }}
                    className="group rounded-2xl border border-white/[0.08] bg-[#0d0d0d] p-5 text-left transition hover:-translate-y-0.5 hover:border-white/[0.16] hover:bg-[#101010]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <span className="rounded-full bg-white/[0.055] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-white/40">
                        {marketCategory}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-[#b7ff3c]">
                        {market.status}
                      </span>
                    </div>

                    <h3 className="mt-5 min-h-[72px] text-xl font-semibold leading-6 tracking-[-0.025em] text-white/90">
                      {question}
                    </h3>

                    <div className="mt-6 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-[#163824] px-3 py-3">
                        <div className="text-[10px] uppercase tracking-wider text-emerald-300/55">Yes</div>
                        <div className="mt-1 text-xl font-semibold text-emerald-300">{yes.toFixed(0)}¢</div>
                      </div>
                      <div className="rounded-xl bg-[#3a171b] px-3 py-3">
                        <div className="text-[10px] uppercase tracking-wider text-rose-300/55">No</div>
                        <div className="mt-1 text-xl font-semibold text-rose-300">{no.toFixed(0)}¢</div>
                      </div>
                    </div>

                    <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4 text-xs text-white/30">
                      <span>{formatUnits(market.volume)} USDG vol.</span>
                      <span className="flex items-center gap-1">
                        <Clock3 className="h-3 w-3" />
                        {new Date(market.closeTs * 1000).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0c0c0c]">
              <div className="grid min-h-[360px] gap-8 p-7 md:grid-cols-[1fr_380px] md:p-10">
                <div className="flex max-w-xl flex-col justify-center">
                  <div className="text-xs font-medium uppercase tracking-[0.2em] text-[#b7ff3c]">
                    Mary Jane is live
                  </div>
                  <h3 className="mt-4 text-3xl font-semibold tracking-[-0.045em] md:text-4xl">
                    Launch the first market.
                  </h3>
                  <p className="mt-4 max-w-lg text-sm leading-6 text-white/40">
                    The protocol is deployed on Solana Devnet. Create a real binary market,
                    certify it through MarketLint and seed USDG liquidity. It will appear here
                    automatically once indexed.
                  </p>
                  <div className="mt-7">
                    <a href="/create" className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black">
                      Create market <ChevronRight className="h-4 w-4" />
                    </a>
                  </div>
                </div>

                <div className="flex flex-col justify-center rounded-2xl border border-white/[0.07] bg-black/30 p-5">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/25">Protocol status</div>
                  {[
                    ["Solana Devnet", "Live"],
                    ["USDG collateral", "Ready"],
                    ["MarketLint", "Ready"],
                    ["Resolution", "Ready"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between border-b border-white/[0.06] py-4 last:border-0">
                      <span className="text-sm text-white/50">{label}</span>
                      <span className="flex items-center gap-2 text-xs font-medium text-[#b7ff3c]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#b7ff3c]" />
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <aside
            className="h-full w-full max-w-[460px] overflow-y-auto border-l border-white/[0.08] bg-[#0a0a0a] p-6"
            onClick={(event) => event.stopPropagation()}
          >
            {(() => {
              const report = reportsBySeed.get(selected.marketSeed);
              const question = report?.input.question || `Market ${short(selected.address, 8, 6)}`;
              const yes = selected.yesProbabilityBps / 100;
              const no = selected.noProbabilityBps / 100;

              return (
                <>
                  <button onClick={() => setSelected(null)} className="text-sm text-white/35 hover:text-white">
                    ← Back to markets
                  </button>
                  <div className="mt-7 text-xs uppercase tracking-[0.16em] text-white/30">
                    {report?.input.category || "Prediction"}
                  </div>
                  <h2 className="mt-3 text-3xl font-semibold leading-9 tracking-[-0.045em]">
                    {question}
                  </h2>
                  {report?.input.description && (
                    <p className="mt-4 text-sm leading-6 text-white/40">{report.input.description}</p>
                  )}

                  <div className="mt-7 grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setTradeSide("YES")}
                      className={`rounded-2xl border p-4 text-left transition ${
                        tradeSide === "YES"
                          ? "border-emerald-300/45 bg-[#173923]"
                          : "border-white/[0.08] bg-white/[0.025]"
                      }`}
                    >
                      <div className="text-xs text-emerald-300/60">YES</div>
                      <div className="mt-1 text-3xl font-semibold text-emerald-300">{yes.toFixed(0)}¢</div>
                    </button>
                    <button
                      onClick={() => setTradeSide("NO")}
                      className={`rounded-2xl border p-4 text-left transition ${
                        tradeSide === "NO"
                          ? "border-rose-300/45 bg-[#3a171b]"
                          : "border-white/[0.08] bg-white/[0.025]"
                      }`}
                    >
                      <div className="text-xs text-rose-300/60">NO</div>
                      <div className="mt-1 text-3xl font-semibold text-rose-300">{no.toFixed(0)}¢</div>
                    </button>
                  </div>

                  <div className="mt-7 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                    <div className="flex items-center justify-between text-xs text-white/35">
                      <span>Amount</span>
                      <span>USDG · Devnet</span>
                    </div>
                    <div className="mt-3 flex items-center rounded-xl border border-white/[0.08] bg-black/30 px-4">
                      <input
                        value={tradeAmount}
                        onChange={(event) => setTradeAmount(event.target.value)}
                        inputMode="decimal"
                        className="w-full bg-transparent py-4 text-2xl font-semibold outline-none"
                      />
                      <span className="text-sm text-white/30">USDG</span>
                    </div>
                    <button
                      onClick={() => void trade()}
                      disabled={tradeBusy}
                      className={`mt-3 w-full rounded-xl py-3.5 text-sm font-semibold transition disabled:opacity-50 ${
                        tradeSide === "YES"
                          ? "bg-emerald-300 text-[#07120b]"
                          : "bg-rose-300 text-[#1a080a]"
                      }`}
                    >
                      {tradeBusy ? "Preparing trade…" : wallet ? `Buy ${tradeSide}` : "Connect wallet to trade"}
                    </button>
                    {tradeNotice && <div className="mt-3 text-xs leading-5 text-white/40">{tradeNotice}</div>}
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl border border-white/[0.07] p-4">
                      <div className="text-white/25">Volume</div>
                      <div className="mt-2 text-sm font-medium">{formatUnits(selected.volume)} USDG</div>
                    </div>
                    <div className="rounded-xl border border-white/[0.07] p-4">
                      <div className="text-white/25">Liquidity</div>
                      <div className="mt-2 text-sm font-medium">{formatUnits(selected.collateralVaultBalance)} USDG</div>
                    </div>
                  </div>

                  <a
                    href={`https://explorer.solana.com/address/${selected.address}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-6 flex items-center justify-between rounded-xl border border-white/[0.07] px-4 py-3 text-xs text-white/40 hover:text-white"
                  >
                    View on Solana Explorer
                    <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </>
              );
            })()}
          </aside>
        </div>
      )}

      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-white/25">
          <span>Mary Jane · Prediction markets on Solana</span>
          <div className="flex items-center gap-4">
            <a href="/create" className="hover:text-white">Create</a>
            <a href="/analytics" className="hover:text-white">Analytics</a>
            <a href="/launch" className="hover:text-white">Protocol</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default MarketHomeScreen;
