import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Banknote,
  CircleDollarSign,
  Gauge,
  Landmark,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Connection, PublicKey } from "@solana/web3.js";

const RPC_URL = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("7ahY74GVSGRf9sDXFPtX6EnynoxWz2myNijQd7MPH5vF");

const collateralMarkets = [
  { symbol: "NVDAx", ltv: 60, liquidation: 75, source: "Pyth" },
  { symbol: "AAPLx", ltv: 60, liquidation: 75, source: "Pyth" },
  { symbol: "SPYx", ltv: 70, liquidation: 80, source: "Pyth" },
  { symbol: "TSLAx", ltv: 50, liquidation: 65, source: "Pyth" },
];

function provider() {
  return (window as any).solana;
}

function short(value: string, left = 6, right = 5) {
  return value.length > left + right + 1
    ? `${value.slice(0, left)}…${value.slice(-right)}`
    : value;
}

export function FortyFourMiladyScreen() {
  const [wallet, setWallet] = useState("");
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [programLive, setProgramLive] = useState<boolean | null>(null);
  const [creditAccount, setCreditAccount] = useState("");
  const [creditExists, setCreditExists] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"BORROW"|"SUPPLY">("BORROW");
  const [asset, setAsset] = useState("NVDAx");
  const [amount, setAmount] = useState("0");
  const [borrowAmount, setBorrowAmount] = useState("0");

  const selected = useMemo(
    () => collateralMarkets.find((item) => item.symbol === asset) || collateralMarkets[0],
    [asset],
  );

  const connect = async () => {
    const p = provider();
    if (!p?.connect) return;
    const result = await p.connect();
    setWallet(result.publicKey.toString());
  };

  useEffect(() => {
    const connection = new Connection(RPC_URL, "confirmed");
    connection.getAccountInfo(PROGRAM_ID, "confirmed")
      .then((info) => setProgramLive(Boolean(info?.executable)))
      .catch(() => setProgramLive(false));
  }, []);

  useEffect(() => {
    if (!wallet) {
      setSolBalance(null);
      setCreditAccount("");
      setCreditExists(null);
      return;
    }
    const connection = new Connection(RPC_URL, "confirmed");
    const owner = new PublicKey(wallet);
    const [credit] = PublicKey.findProgramAddressSync(
      [Buffer.from("credit"), owner.toBuffer()],
      PROGRAM_ID,
    );
    setCreditAccount(credit.toBase58());
    Promise.all([
      connection.getBalance(owner, "confirmed"),
      connection.getAccountInfo(credit, "confirmed"),
    ])
      .then(([lamports, creditInfo]) => {
        setSolBalance(lamports / 1e9);
        setCreditExists(Boolean(creditInfo));
      })
      .catch(() => {
        setSolBalance(null);
        setCreditExists(false);
      });
  }, [wallet]);

  const protocolState =
    programLive === null ? "Checking…" : programLive ? "Live on Devnet" : "Deployment pending";

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
              <div className="text-xs font-semibold uppercase tracking-[.2em] text-[#b7ff3c]">Solana collateralized credit</div>
              <h1 className="mt-4 text-5xl font-semibold tracking-[-.06em] md:text-7xl">44 Milady</h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-white/45 md:text-lg">
                Keep the exposure. Unlock the liquidity. Deposit market-linked collateral, read fresh Pyth prices, and borrow USDG without selling the underlying position.
              </p>
            </div>
            <div className="min-w-[280px] rounded-2xl border border-white/[.08] bg-black/35 p-4">
              <div className="flex items-center justify-between text-xs text-white/35"><span>Protocol</span><span className={programLive ? "text-emerald-300" : "text-amber-200"}>{protocolState}</span></div>
              <div className="mt-3 flex items-center justify-between text-xs text-white/35"><span>Program</span><span className="font-mono text-white/65">{short(PROGRAM_ID.toBase58(), 7, 6)}</span></div>
              <div className="mt-3 flex items-center justify-between text-xs text-white/35"><span>Network</span><span className="text-white/65">Solana Devnet</span></div>
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Collateral value", "—", Landmark],
            ["Available to borrow", "—", Banknote],
            ["Debt", "—", CircleDollarSign],
            ["Health factor", "—", Gauge],
          ].map(([label,value,Icon]:any) => (
            <div key={label} className="rounded-2xl border border-white/[.07] bg-white/[.02] p-5">
              <div className="flex items-center justify-between"><span className="text-[10px] uppercase tracking-[.13em] text-white/25">{label}</span><Icon className="h-4 w-4 text-white/20"/></div>
              <div className="mt-3 text-2xl font-semibold">{value}</div>
              <div className="mt-2 text-[10px] text-white/20">Live after credit account + oracle state are connected</div>
            </div>
          ))}
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
          <div className="rounded-[28px] border border-white/[.08] bg-[#0a0a0a] p-5 md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[.16em] text-[#b7ff3c]">Credit terminal</div>
                <h2 className="mt-2 text-2xl font-semibold">Borrow against exposure</h2>
              </div>
              <div className="flex rounded-xl bg-white/[.04] p-1">
                {(["BORROW","SUPPLY"] as const).map((value) => (
                  <button key={value} onClick={()=>setMode(value)} className={`rounded-lg px-4 py-2 text-xs font-semibold ${mode===value?"bg-white text-black":"text-white/35"}`}>
                    {value === "BORROW" ? "Borrow" : "Supply USDG"}
                  </button>
                ))}
              </div>
            </div>

            {mode === "BORROW" ? (
              <>
                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  <label className="text-xs text-white/35">Collateral
                    <select value={asset} onChange={(e)=>setAsset(e.target.value)} className="mt-2 w-full rounded-xl border border-white/[.08] bg-black/35 p-3 text-white outline-none">
                      {collateralMarkets.map((market)=><option key={market.symbol}>{market.symbol}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-white/35">Deposit amount
                    <input value={amount} onChange={(e)=>setAmount(e.target.value)} inputMode="decimal" className="mt-2 w-full rounded-xl border border-white/[.08] bg-black/35 p-3 text-white outline-none"/>
                  </label>
                </div>
                <label className="mt-4 block text-xs text-white/35">Borrow USDG
                  <input value={borrowAmount} onChange={(e)=>setBorrowAmount(e.target.value)} inputMode="decimal" className="mt-2 w-full rounded-xl border border-white/[.08] bg-black/35 p-3 text-lg text-white outline-none"/>
                </label>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Max LTV</div><div className="mt-1 font-semibold">{selected.ltv}%</div></div>
                  <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Liquidation</div><div className="mt-1 font-semibold">{selected.liquidation}%</div></div>
                  <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Oracle</div><div className="mt-1 font-semibold">{selected.source}</div></div>
                </div>
                <button disabled className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#b7ff3c] py-4 text-sm font-semibold text-black opacity-45">
                  Deposit + borrow <ArrowRight className="h-4 w-4"/>
                </button>
                <p className="mt-3 text-[10px] leading-4 text-white/22">Transaction wiring comes next: initialize credit account → deposit collateral → refresh Pyth health → borrow USDG.</p>
              </>
            ) : (
              <>
                <label className="mt-6 block text-xs text-white/35">USDG to supply
                  <input value={amount} onChange={(e)=>setAmount(e.target.value)} inputMode="decimal" className="mt-2 w-full rounded-xl border border-white/[.08] bg-black/35 p-3 text-lg text-white outline-none"/>
                </label>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Pool</div><div className="mt-1 font-semibold">USDG</div></div>
                  <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Interest</div><div className="mt-1 font-semibold">Utilization</div></div>
                  <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Reserve</div><div className="mt-1 font-semibold">10%</div></div>
                </div>
                <button disabled className="mt-5 w-full rounded-xl bg-white py-4 text-sm font-semibold text-black opacity-45">Supply USDG</button>
                <p className="mt-3 text-[10px] leading-4 text-white/22">Supply, interest-index sync and withdrawal builders are the next protocol integration step.</p>
              </>
            )}
          </div>

          <div className="space-y-5">
            <div className="rounded-[28px] border border-white/[.08] bg-[#0a0a0a] p-5">
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#b7ff3c]"/><h3 className="font-semibold">Your 44 Milady account</h3></div>
              {!wallet ? (
                <div className="mt-5 text-sm text-white/35">Connect a Solana wallet to inspect your credit PDA and Devnet balance.</div>
              ) : (
                <div className="mt-5 space-y-3 text-xs">
                  <div className="flex justify-between gap-4"><span className="text-white/30">Wallet</span><span className="font-mono text-white/65">{short(wallet)}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-white/30">Devnet SOL</span><span>{solBalance == null ? "Loading…" : solBalance.toFixed(4)}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-white/30">Credit account</span><span className={creditExists ? "text-emerald-300" : "text-white/50"}>{creditExists === null ? "Checking…" : creditExists ? "Initialized" : "Not initialized"}</span></div>
                  {creditAccount && <div className="break-all rounded-xl bg-white/[.025] p-3 font-mono text-[10px] text-white/30">{creditAccount}</div>}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-white/[.08] bg-[#0a0a0a] p-5">
              <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-[#b7ff3c]"/><h3 className="font-semibold">Protocol flow</h3></div>
              <div className="mt-5 space-y-3">
                {[
                  "Supply USDG liquidity",
                  "Deposit collateral",
                  "Read fresh Pyth price",
                  "Calculate LTV + health",
                  "Borrow USDG",
                  "Repay or withdraw",
                ].map((label,index)=>(
                  <div key={label} className="flex items-center gap-3 text-xs text-white/45">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[.05] text-[10px] text-white/35">{index+1}</span>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-[28px] border border-white/[.08] bg-[#0a0a0a] p-5 md:p-6">
          <div className="flex items-end justify-between gap-4">
            <div><div className="text-xs uppercase tracking-[.16em] text-white/25">Collateral markets</div><h2 className="mt-2 text-2xl font-semibold">Risk configuration</h2></div>
            <div className="text-xs text-white/25">Pyth-priced · on-chain limits</div>
          </div>
          <div className="mt-5 overflow-hidden rounded-2xl border border-white/[.07]">
            {collateralMarkets.map((market,index)=>(
              <div key={market.symbol} className={`grid grid-cols-4 gap-3 px-4 py-4 text-xs ${index ? "border-t border-white/[.06]" : ""}`}>
                <strong className="text-white/80">{market.symbol}</strong>
                <span className="text-white/35">LTV {market.ltv}%</span>
                <span className="text-white/35">Liquidation {market.liquidation}%</span>
                <span className="text-right text-[#caff75]">{market.source}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default FortyFourMiladyScreen;
