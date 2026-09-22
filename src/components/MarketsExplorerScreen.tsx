import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Clock3,
  Database,
  ExternalLink,
  RefreshCw,
  Search,
  Signal,
  TrendingUp,
  Users,
  Waves,
} from 'lucide-react';

type Analytics = {
  updatedAt: number;
  totalMarkets: number;
  openMarkets: number;
  resolvedMarkets: number;
  disputedMarkets: number;
  cancelledMarkets: number;
  betaRounds: number;
  liveBetaRounds: number;
  totalVolumeBaseUnits: string;
  volume24hBaseUnits: string;
  totalCollateralLockedBaseUnits: string;
  totalProtocolFeesBaseUnits: string;
  outcomeLiquidityBaseUnits: string;
  activeTraders24h: number;
  events24h: number;
};

type Market = {
  address: string;
  authority: string;
  questionHash: string;
  metadataHash: string;
  closeTs: number;
  resolutionTs: number;
  status: string;
  yesReserve: string;
  noReserve: string;
  lpSupply: string;
  volume: string;
  protocolFees: string;
  collateralVaultBalance: string;
  yesProbabilityBps: number;
  noProbabilityBps: number;
  updatedAt: number;
};

type BetaRound = {
  address: string;
  assetHash: string;
  roundId: string;
  openTs: number;
  closeTs: number;
  status: string;
  outcome: string;
  upPool: string;
  downPool: string;
  vaultBalance: string;
  upProbabilityBps: number;
  downProbabilityBps: number;
};

type EventItem = {
  id: string;
  signature: string;
  blockTime: number;
  type: string;
  market?: string;
  round?: string;
  actor?: string;
  data: Record<string, string | number | boolean>;
};

type ChartPoint = {
  timestamp: number;
  yesProbabilityBps: number;
  volume: string;
  collateralVaultBalance: string;
};

const SCALE = 1_000_000n;

function formatUnits(value: string | bigint, digits = 2) {
  const amount = typeof value === 'bigint' ? value : BigInt(value || '0');
  const whole = amount / SCALE;
  const fraction = (amount % SCALE).toString().padStart(6, '0').slice(0, digits);
  return digits > 0 ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString();
}

function short(value: string, left = 5, right = 4) {
  return value.length <= left + right + 1
    ? value
    : `${value.slice(0, left)}…${value.slice(-right)}`;
}

async function readJson(response: Response) {
  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`API ${response.status} returned a non-JSON response`);
  }
  if (!response.ok) throw new Error(data?.error || `API ${response.status}`);
  return data;
}

function statusTone(status: string) {
  if (status === 'OPEN') return 'text-emerald-300 border-emerald-400/20 bg-emerald-400/10';
  if (status.includes('RESOLVED') || status === 'SETTLED') return 'text-sky-300 border-sky-400/20 bg-sky-400/10';
  if (status === 'DISPUTED') return 'text-amber-300 border-amber-400/20 bg-amber-400/10';
  if (status === 'CANCELLED') return 'text-rose-300 border-rose-400/20 bg-rose-400/10';
  return 'text-white/55 border-white/10 bg-white/[0.04]';
}

function Sparkline({ points }: { points: ChartPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-white/35">
        Chart history appears as the indexer collects live snapshots.
      </div>
    );
  }

  const values = points.map((point) => point.yesProbabilityBps / 100);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(1, max - min);
  const width = 900;
  const height = 220;
  const path = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - min) / spread) * (height - 20) - 10;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="mb-3 flex items-center justify-between text-xs text-white/40">
        <span>YES probability</span>
        <span>{values.at(-1)?.toFixed(2)}%</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full" preserveAspectRatio="none">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="4" className="text-white" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function MarketsExplorerScreen() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [betaRounds, setBetaRounds] = useState<BetaRound[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'volume' | 'liquidity' | 'newest' | 'ending'>('volume');
  const [status, setStatus] = useState('ALL');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refreshTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const marketParams = new URLSearchParams({
        sort,
        limit: '100',
      });
      if (search.trim()) marketParams.set('q', search.trim());
      if (status !== 'ALL') marketParams.set('status', status);

      const response = await fetch(`/api/analytics-feed?${marketParams.toString()}`, { cache: 'no-store' });
      const data = await readJson(response);
      const nextMarkets = data.markets || [];

      setAnalytics(data.analytics || null);
      setMarkets(nextMarkets);
      setBetaRounds(data.betaRounds || []);
      setEvents(data.events || []);
      setConnected(true);
      setSelected((current) => {
        const next = nextMarkets;
        if (current && next.some((market: Market) => market.address === current)) return current;
        return next[0]?.address || '';
      });
      setError('');
    } catch (err: any) {
      setConnected(false);
      setError(err?.message || 'Unable to load live market data');
    } finally {
      setLoading(false);
    }
  }, [search, sort, status]);

  useEffect(() => {
    load();
  }, [load]);

  const loadSelectedActivity = useCallback(async () => {
    if (!selected) {
      setChart([]);
      setEvents([]);
      return;
    }
    try {
      const response = await fetch(`/api/native-market-state?address=${encodeURIComponent(selected)}`, { cache: 'no-store' });
      const data = await readJson(response);
      const trades = Array.isArray(data.recentTrades) ? data.recentTrades : [];
      setChart(
        [...trades].reverse().map((trade: any) => ({
          timestamp: Number(trade.blockTime || 0) * 1000,
          yesProbabilityBps: Number(trade.yesPriceBps || 5000),
          volume: String(trade.quoteAmount || '0'),
          collateralVaultBalance: markets.find((market) => market.address === selected)?.collateralVaultBalance || '0',
        })),
      );
      setEvents(
        trades.map((trade: any, index: number) => ({
          id: `${trade.signature || 'fill'}-${index}`,
          signature: String(trade.signature || ''),
          blockTime: Number(trade.blockTime || 0),
          type: 'LIMIT ORDER FILLED',
          market: selected,
          actor: String(trade.taker || trade.maker || ''),
          data: {
            side: String(trade.side || ''),
            priceBps: Number(trade.priceBps || 0),
            shares: String(trade.shares || '0'),
            quoteAmount: String(trade.quoteAmount || '0'),
          },
        })),
      );
    } catch {
      setChart([]);
      setEvents([]);
    }
  }, [selected, markets]);

  useEffect(() => {
    void loadSelectedActivity();
  }, [loadSelectedActivity]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load();
      void loadSelectedActivity();
    }, 8_000);

    return () => {
      window.clearInterval(timer);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [load, loadSelectedActivity]);

  const selectedMarket = useMemo(
    () => markets.find((market) => market.address === selected) || null,
    [markets, selected],
  );

  return (
    <div className="min-h-screen bg-[#080808] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#080808]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.34em] text-white/35">Mary Jane</div>
            <div className="mt-1 flex items-center gap-3">
              <h1 className="text-xl font-semibold">Market Intelligence</h1>
              <span className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] uppercase tracking-wider ${
                connected ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-white/10 bg-white/[0.03] text-white/35'
              }`}>
                <Signal className="h-3 w-3" />
                {connected ? 'Live' : 'Reconnecting'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/33-beta"
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/[0.05] hover:text-white"
            >
              Mary Jane Beta
            </a>
            <button
              onClick={() => void load()}
              className="rounded-full border border-white/10 p-2.5 text-white/60 hover:bg-white/[0.05] hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-6">
        {error && (
          <div className="mb-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {[
            ['Markets', analytics?.totalMarkets ?? 0, Database],
            ['Open', analytics?.openMarkets ?? 0, Waves],
            ['24h volume', analytics ? `${formatUnits(analytics.volume24hBaseUnits)} USDG` : '—', TrendingUp],
            ['Collateral', analytics ? `${formatUnits(analytics.totalCollateralLockedBaseUnits)} USDG` : '—', BarChart3],
            ['24h traders', analytics?.activeTraders24h ?? 0, Users],
            ['Beta live', analytics?.liveBetaRounds ?? 0, Activity],
          ].map(([label, value, Icon]) => (
            <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <div className="flex items-center gap-2 text-xs text-white/35">
                <Icon className="h-3.5 w-3.5" />
                {String(label)}
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight">{String(value)}</div>
            </div>
          ))}
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[440px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3">
                  <Search className="h-4 w-4 text-white/30" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search address or hash"
                    className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-white/25"
                  />
                </div>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as typeof sort)}
                  className="rounded-xl border border-white/10 bg-[#111] px-3 text-sm outline-none"
                >
                  <option value="volume">Volume</option>
                  <option value="liquidity">Liquidity</option>
                  <option value="newest">Newest</option>
                  <option value="ending">Ending</option>
                </select>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {['ALL', 'OPEN', 'DISPUTED', 'RESOLVED_YES', 'RESOLVED_NO', 'CANCELLED'].map((value) => (
                  <button
                    key={value}
                    onClick={() => setStatus(value)}
                    className={`rounded-full border px-3 py-1.5 text-[11px] transition ${
                      status === value
                        ? 'border-white/30 bg-white text-black'
                        : 'border-white/10 text-white/45 hover:text-white'
                    }`}
                  >
                    {value.replaceAll('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {loading && (
                <div className="rounded-2xl border border-white/10 p-6 text-sm text-white/35">
                  Reading Mary Jane from Solana Devnet…
                </div>
              )}

              {!loading && markets.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm leading-6 text-white/35">
                  No native prediction markets found on Solana Devnet.
                </div>
              )}

              {markets.map((market) => {
                const active = market.address === selected;
                return (
                  <button
                    key={market.address}
                    onClick={() => setSelected(market.address)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      active ? 'border-white/25 bg-white/[0.07]' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.045]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{short(market.address, 7, 6)}</div>
                        <div className="mt-1 text-[11px] text-white/30">Q {short(market.questionHash, 8, 8)}</div>
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-[9px] uppercase tracking-wider ${statusTone(market.status)}`}>
                        {market.status}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-white/30">YES</div>
                        <div className="mt-1">{(market.yesProbabilityBps / 100).toFixed(1)}%</div>
                      </div>
                      <div>
                        <div className="text-white/30">Volume</div>
                        <div className="mt-1">{formatUnits(market.volume)}</div>
                      </div>
                      <div>
                        <div className="text-white/30">Vault</div>
                        <div className="mt-1">{formatUnits(market.collateralVaultBalance)}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            {selectedMarket ? (
              <>
                <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.28em] text-white/30">Prediction Market</div>
                      <h2 className="mt-2 text-2xl font-semibold">{short(selectedMarket.address, 10, 8)}</h2>
                      <div className="mt-2 text-sm text-white/35">
                        question hash {short(selectedMarket.questionHash, 12, 12)}
                      </div>
                    </div>
                    <a
                      href={`https://explorer.solana.com/address/${selectedMarket.address}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-xs text-white/50 hover:text-white"
                    >
                      Explorer <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-4">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs text-white/30">YES</div>
                      <div className="mt-2 text-3xl font-semibold">{(selectedMarket.yesProbabilityBps / 100).toFixed(2)}%</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs text-white/30">NO</div>
                      <div className="mt-2 text-3xl font-semibold">{(selectedMarket.noProbabilityBps / 100).toFixed(2)}%</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs text-white/30">Volume</div>
                      <div className="mt-2 text-xl font-semibold">{formatUnits(selectedMarket.volume)} USDG</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs text-white/30">Closes</div>
                      <div className="mt-2 flex items-center gap-1.5 text-sm font-medium">
                        <Clock3 className="h-4 w-4" />
                        {new Date(selectedMarket.closeTs * 1000).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5">
                    <Sparkline points={chart} />
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold">Live activity</div>
                        <div className="mt-1 text-xs text-white/30">Live matched fills from Solana Devnet</div>
                      </div>
                      <Activity className="h-4 w-4 text-white/35" />
                    </div>

                    <div className="space-y-2">
                      {events
                        .filter((event) => !event.market || event.market === selectedMarket.address)
                        .slice(0, 12)
                        .map((event) => (
                          <div key={event.id} className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium">{event.type}</div>
                              <div className="text-[10px] text-white/25">
                                {new Date(event.blockTime * 1000).toLocaleTimeString()}
                              </div>
                            </div>
                            <div className="mt-1 text-[10px] text-white/30">
                              {event.actor ? short(event.actor) : short(event.signature)}
                            </div>
                          </div>
                        ))}

                      {events.filter((event) => event.market === selectedMarket.address).length === 0 && (
                        <div className="py-8 text-center text-xs text-white/30">No indexed events for this market yet.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold">Mary Jane Beta rounds</div>
                        <div className="mt-1 text-xs text-white/30">Fast-market activity from Solana Devnet</div>
                      </div>
                      <Waves className="h-4 w-4 text-white/35" />
                    </div>

                    <div className="space-y-2">
                      {betaRounds.slice(0, 10).map((round) => (
                        <a
                          key={round.address}
                          href="/33-beta"
                          className="block rounded-xl border border-white/10 bg-black/20 px-3 py-3 hover:bg-white/[0.04]"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-medium">{short(round.address, 7, 6)}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[9px] ${statusTone(round.status)}`}>
                              {round.status}
                            </span>
                          </div>
                          <div className="mt-2 flex justify-between text-[10px] text-white/30">
                            <span>UP {(round.upProbabilityBps / 100).toFixed(1)}%</span>
                            <span>{formatUnits(BigInt(round.upPool) + BigInt(round.downPool))} USDG</span>
                          </div>
                        </a>
                      ))}

                      {betaRounds.length === 0 && (
                        <div className="py-8 text-center text-xs text-white/30">No Beta rounds indexed yet.</div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex min-h-[500px] items-center justify-center rounded-3xl border border-dashed border-white/10 text-sm text-white/30">
                Select a native market to inspect live activity.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default MarketsExplorerScreen;
