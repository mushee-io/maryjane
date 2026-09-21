import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Clock3, ExternalLink, RefreshCw, Wallet } from 'lucide-react';
import { Transaction } from '@solana/web3.js';

type BetaRound = {
  address: string;
  assetHash: string;
  asset: string;
  roundId: string;
  collateralMint: string;
  vault: string;
  startPrice: string;
  endPrice: string;
  priceExponent: number;
  startObservedTs: number;
  endObservedTs: number;
  openTs: number;
  lockTs: number;
  closeTs: number;
  upPool: string;
  downPool: string;
  protocolFees: string;
  outcome: 'UNRESOLVED' | 'UP' | 'DOWN' | 'PUSH';
  status: 'OPEN' | 'LOCKED' | 'SETTLED';
};

type BetaPosition = {
  owner: string;
  round: string;
  upStake: string;
  downStake: string;
  collateralPaid: string;
  claimed: boolean;
};

const USDG_DECIMALS = 6n;
const USDG_SCALE = 10n ** USDG_DECIMALS;

function getInjectedWallet(): any {
  return (window as any).solana;
}

function fromBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function formatUsdBaseUnits(value: string | bigint, maximumFractionDigits = 2): string {
  const units = typeof value === 'bigint' ? value : BigInt(value || '0');
  const whole = units / USDG_SCALE;
  const fraction = units % USDG_SCALE;
  const fractionText = fraction.toString().padStart(Number(USDG_DECIMALS), '0').slice(0, maximumFractionDigits);
  return maximumFractionDigits > 0
    ? `${whole.toLocaleString()}${fractionText ? `.${fractionText}` : ''}`
    : whole.toLocaleString();
}

function formatOraclePrice(raw: string, exponent: number): string {
  const price = Number(raw) * 10 ** exponent;
  if (!Number.isFinite(price)) return raw;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: price < 10 ? 4 : 2,
  }).format(price);
}

function timeLeft(target: number, now: number): string {
  const seconds = Math.max(0, target - Math.floor(now / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function probability(upPool: bigint, downPool: bigint): { up: number; down: number } {
  const total = upPool + downPool;
  if (total === 0n) return { up: 50, down: 50 };
  const upBps = Number((upPool * 10_000n) / total);
  return { up: upBps / 100, down: (10_000 - upBps) / 100 };
}

function payoutForPosition(round: BetaRound, position: BetaPosition | null): bigint {
  if (!position || position.claimed || round.status !== 'SETTLED') return 0n;
  const up = BigInt(round.upPool);
  const down = BigInt(round.downPool);
  const total = up + down;
  const userUp = BigInt(position.upStake);
  const userDown = BigInt(position.downStake);

  if (round.outcome === 'PUSH') return userUp + userDown;
  if (round.outcome === 'UP') return up > 0n ? (userUp * total) / up : 0n;
  if (round.outcome === 'DOWN') return down > 0n ? (userDown * total) / down : 0n;
  return 0n;
}

export function ThirtyThreeBetaScreen() {
  const [rounds, setRounds] = useState<BetaRound[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string>('');
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [position, setPosition] = useState<BetaPosition | null>(null);
  const [amount, setAmount] = useState('25');
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'UP' | 'DOWN' | 'CLAIM' | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [error, setError] = useState<string>('');

  const loadRounds = useCallback(async () => {
    try {
      const response = await fetch('/api/33-beta/rounds');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load Mary Jane Beta rounds');
      const nextRounds: BetaRound[] = data.rounds || [];
      setRounds(nextRounds);
      setSelectedAddress((current) => {
        if (current && nextRounds.some((round) => round.address === current)) return current;
        const active = nextRounds.find((round) => round.status !== 'SETTLED');
        return active?.address || nextRounds[0]?.address || '';
      });
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Unable to read Solana Devnet');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRounds();
    const roundsTimer = window.setInterval(loadRounds, 10_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearInterval(roundsTimer);
      window.clearInterval(clockTimer);
    };
  }, [loadRounds]);

  const selected = useMemo(
    () => rounds.find((round) => round.address === selectedAddress) || null,
    [rounds, selectedAddress],
  );

  const loadPosition = useCallback(async () => {
    if (!walletAddress || !selected) {
      setPosition(null);
      return;
    }
    try {
      const response = await fetch(
        `/api/33-beta/position?round=${encodeURIComponent(selected.address)}&wallet=${encodeURIComponent(walletAddress)}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load position');
      setPosition(data.position || null);
    } catch {
      setPosition(null);
    }
  }, [walletAddress, selected]);

  useEffect(() => {
    loadPosition();
  }, [loadPosition]);

  const connectWallet = async () => {
    setError('');
    const provider = getInjectedWallet();
    if (!provider?.connect) {
      setError('No compatible Solana wallet was detected in this browser.');
      return;
    }
    try {
      const result = await provider.connect();
      setWalletAddress(result.publicKey.toString());
    } catch (err: any) {
      setError(err?.message || 'Wallet connection was cancelled');
    }
  };

  const sendBuiltTransaction = async (endpoint: string, body: Record<string, unknown>) => {
    const provider = getInjectedWallet();
    if (!provider?.signAndSendTransaction) throw new Error('Connected wallet cannot sign transactions');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to build Solana transaction');

    const transaction = Transaction.from(fromBase64(data.transactionBase64));
    const result = await provider.signAndSendTransaction(transaction);
    const signature = typeof result === 'string' ? result : result.signature;
    return signature as string;
  };

  const enter = async (side: 'UP' | 'DOWN') => {
    if (!selected || !walletAddress) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a positive USDG amount.');
      return;
    }

    setBusy(side);
    setError('');
    setNotice('');
    try {
      const baseUnits = BigInt(Math.round(parsed * Number(USDG_SCALE)));
      const signature = await sendBuiltTransaction('/api/33-beta/enter-transaction', {
        wallet: walletAddress,
        round: selected.address,
        side,
        amountBaseUnits: baseUnits.toString(),
      });
      setNotice(`${side} position submitted: ${signature.slice(0, 8)}…`);
      await loadRounds();
      await loadPosition();
    } catch (err: any) {
      setError(err?.message || 'Transaction failed');
    } finally {
      setBusy(null);
    }
  };

  const claim = async () => {
    if (!selected || !walletAddress) return;
    setBusy('CLAIM');
    setError('');
    setNotice('');
    try {
      const signature = await sendBuiltTransaction('/api/33-beta/claim-transaction', {
        wallet: walletAddress,
        round: selected.address,
      });
      setNotice(`Claim submitted: ${signature.slice(0, 8)}…`);
      await loadRounds();
      await loadPosition();
    } catch (err: any) {
      setError(err?.message || 'Claim failed');
    } finally {
      setBusy(null);
    }
  };

  const upPool = BigInt(selected?.upPool || '0');
  const downPool = BigInt(selected?.downPool || '0');
  const probs = probability(upPool, downPool);
  const claimable = selected ? payoutForPosition(selected, position) : 0n;
  const amountNumber = Number(amount) || 0;
  const feeBps = 30;
  const netInput = BigInt(Math.max(0, Math.round(amountNumber * 1_000_000 * (1 - feeBps / 10_000))));
  const totalAfterUp = upPool + downPool + netInput;
  const projectedUp = netInput > 0n && upPool + netInput > 0n
    ? (netInput * totalAfterUp) / (upPool + netInput)
    : 0n;
  const totalAfterDown = upPool + downPool + netInput;
  const projectedDown = netInput > 0n && downPool + netInput > 0n
    ? (netInput * totalAfterDown) / (downPool + netInput)
    : 0n;

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0A0A0A]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.32em] text-white/40">Mary Jane</div>
            <div className="mt-1 flex items-center gap-2 text-xl font-semibold">
              Mary Jane Beta
              <span className="rounded-full border border-orange-400/30 bg-orange-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-orange-300">
                Devnet
              </span>
            </div>
          </div>
          <button
            onClick={connectWallet}
            className="flex items-center gap-2 rounded-full border border-white/15 bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
          >
            <Wallet className="h-4 w-4" />
            {walletAddress ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}` : 'Connect wallet'}
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-white/70">Rounds</div>
            <button onClick={loadRounds} className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {loading && <div className="rounded-2xl border border-white/10 p-5 text-sm text-white/50">Reading Solana Devnet…</div>}

          {!loading && rounds.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm leading-6 text-white/50">
              No Mary Jane Beta rounds exist on Devnet yet. An authorized oracle keeper must open the first round onchain.
            </div>
          )}

          {rounds.map((round) => {
            const roundUp = BigInt(round.upPool);
            const roundDown = BigInt(round.downPool);
            const roundProbs = probability(roundUp, roundDown);
            const active = round.address === selectedAddress;
            return (
              <button
                key={round.address}
                onClick={() => setSelectedAddress(round.address)}
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  active ? 'border-white/30 bg-white/[0.07]' : 'border-white/10 bg-white/[0.025] hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{round.asset}</span>
                  <span className={`text-[10px] uppercase tracking-wider ${
                    round.status === 'OPEN' ? 'text-emerald-400' : round.status === 'LOCKED' ? 'text-amber-300' : 'text-white/40'
                  }`}>
                    {round.status}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-white/50">
                  <span>UP {roundProbs.up.toFixed(1)}%</span>
                  <span>{Math.round((round.closeTs - round.openTs) / 60)}m</span>
                </div>
              </button>
            );
          })}
        </aside>

        <section>
          {!selected ? (
            <div className="flex min-h-[520px] items-center justify-center rounded-3xl border border-white/10 bg-white/[0.02] text-sm text-white/40">
              Select a live round when one is available.
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]">
              <div className="border-b border-white/10 p-6 md:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-white/35">Round #{selected.roundId}</div>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight">{selected.asset} UP or DOWN?</h1>
                    <div className="mt-2 text-sm text-white/50">
                      Start {formatOraclePrice(selected.startPrice, selected.priceExponent)}
                      {selected.status === 'SETTLED' && (
                        <> · Close {formatOraclePrice(selected.endPrice, selected.priceExponent)}</>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5 text-xs text-white/40">
                      <Clock3 className="h-3.5 w-3.5" />
                      {selected.status === 'OPEN' ? 'Locks in' : selected.status === 'LOCKED' ? 'Settles in' : 'Result'}
                    </div>
                    <div className="mt-1 font-mono text-2xl">
                      {selected.status === 'OPEN'
                        ? timeLeft(selected.lockTs, now)
                        : selected.status === 'LOCKED'
                          ? timeLeft(selected.closeTs, now)
                          : selected.outcome}
                    </div>
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-5">
                    <div className="flex items-center gap-2 text-emerald-300"><ArrowUp className="h-4 w-4" /> UP</div>
                    <div className="mt-3 text-4xl font-semibold">{probs.up.toFixed(1)}%</div>
                    <div className="mt-2 text-xs text-white/40">{formatUsdBaseUnits(upPool)} USDG pool</div>
                  </div>
                  <div className="rounded-2xl border border-rose-400/20 bg-rose-400/[0.06] p-5">
                    <div className="flex items-center gap-2 text-rose-300"><ArrowDown className="h-4 w-4" /> DOWN</div>
                    <div className="mt-3 text-4xl font-semibold">{probs.down.toFixed(1)}%</div>
                    <div className="mt-2 text-xs text-white/40">{formatUsdBaseUnits(downPool)} USDG pool</div>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 p-6 md:p-8 lg:grid-cols-[1fr_300px]">
                <div>
                  <div className="text-sm font-semibold">Position</div>
                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                    {position ? (
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-white/40">Your UP</div>
                          <div className="mt-1 font-medium">{formatUsdBaseUnits(position.upStake, 4)} USDG</div>
                        </div>
                        <div>
                          <div className="text-white/40">Your DOWN</div>
                          <div className="mt-1 font-medium">{formatUsdBaseUnits(position.downStake, 4)} USDG</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-white/40">
                        {walletAddress ? 'No position in this round.' : 'Connect a wallet to see your position.'}
                      </div>
                    )}
                  </div>

                  {selected.status === 'SETTLED' && position && !position.claimed && claimable > 0n && (
                    <button
                      onClick={claim}
                      disabled={busy !== null}
                      className="mt-4 w-full rounded-2xl bg-white px-4 py-3.5 text-sm font-semibold text-black disabled:opacity-40"
                    >
                      {busy === 'CLAIM' ? 'Submitting claim…' : `Claim ${formatUsdBaseUnits(claimable, 4)} USDG`}
                    </button>
                  )}

                  {position?.claimed && (
                    <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">
                      Claimed {formatUsdBaseUnits(position.collateralPaid, 4)} USDG
                    </div>
                  )}

                  {notice && <div className="mt-4 text-sm text-emerald-300">{notice}</div>}
                  {error && <div className="mt-4 text-sm text-rose-300">{error}</div>}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-semibold">Trade this round</div>
                  <label className="mt-4 block text-xs text-white/40">Amount</label>
                  <div className="mt-2 flex items-center rounded-xl border border-white/10 bg-black/30 px-3">
                    <input
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      inputMode="decimal"
                      className="min-w-0 flex-1 bg-transparent py-3 text-lg outline-none"
                      placeholder="0"
                    />
                    <span className="text-xs font-medium text-white/40">USDG</span>
                  </div>

                  <div className="mt-4 grid gap-2">
                    <button
                      onClick={() => enter('UP')}
                      disabled={!walletAddress || selected.status !== 'OPEN' || busy !== null || Math.floor(now / 1000) >= selected.lockTs}
                      className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {busy === 'UP' ? 'Submitting…' : `UP · win ≈ ${formatUsdBaseUnits(projectedUp, 2)} USDG`}
                    </button>
                    <button
                      onClick={() => enter('DOWN')}
                      disabled={!walletAddress || selected.status !== 'OPEN' || busy !== null || Math.floor(now / 1000) >= selected.lockTs}
                      className="rounded-xl bg-rose-400 px-4 py-3 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {busy === 'DOWN' ? 'Submitting…' : `DOWN · win ≈ ${formatUsdBaseUnits(projectedDown, 2)} USDG`}
                    </button>
                  </div>

                  <div className="mt-4 space-y-2 border-t border-white/10 pt-4 text-xs text-white/40">
                    <div className="flex justify-between"><span>Settlement</span><span>USDG</span></div>
                    <div className="flex justify-between"><span>Network</span><span>Solana Devnet</span></div>
                    <div className="flex justify-between"><span>Duration</span><span>{Math.round((selected.closeTs - selected.openTs) / 60)} min</span></div>
                  </div>

                  <a
                    href={`https://explorer.solana.com/address/${selected.address}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 flex items-center justify-center gap-1.5 text-xs text-white/45 hover:text-white"
                  >
                    View round on Explorer <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default ThirtyThreeBetaScreen;
