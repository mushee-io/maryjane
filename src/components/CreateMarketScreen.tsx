import React, { useState } from "react";
import { ExternalLink, Loader2, Rocket, ShieldCheck, Wallet } from "lucide-react";
import { Transaction } from "@solana/web3.js";

function provider() {
  return (window as any).solana;
}
function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function toUnix(value: string) {
  return Math.floor(new Date(value).getTime() / 1000);
}
async function signBuiltTransaction(transactionBase64: string) {
  const wallet = provider();
  if (!wallet?.signAndSendTransaction) throw new Error("Wallet cannot sign Solana transactions");
  const tx = Transaction.from(fromBase64(transactionBase64));
  const result = await wallet.signAndSendTransaction(tx);
  return typeof result === "string" ? result : result.signature;
}

export function CreateMarketScreen() {
  const [wallet, setWallet] = useState("");
  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState("Pyth");
  const [deadline, setDeadline] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [resolutionAt, setResolutionAt] = useState("");
  const [category, setCategory] = useState("Crypto");
  const [liquidity, setLiquidity] = useState("25");
  const [report, setReport] = useState<any>(null);
  const [market, setMarket] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const connect = async () => {
    const p = provider();
    if (!p?.connect) return setError("No compatible Solana wallet found.");
    const result = await p.connect();
    setWallet(result.publicKey.toString());
  };

  const input = () => ({
    question,
    description,
    source,
    deadline,
    category,
    closeTs: closeAt ? toUnix(closeAt) : undefined,
    resolutionTs: resolutionAt ? toUnix(resolutionAt) : undefined,
  });

  const analyze = async () => {
    setBusy("analyze"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/v1/marketlint/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input()),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "MarketLint failed");
      setReport(data);
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };

  const create = async () => {
    if (!wallet) return setError("Connect a Solana wallet first.");
    setBusy("create"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/v1/markets/prepare-create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, input: input() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to prepare market");
      setReport(data.report);
      const signature = await signBuiltTransaction(data.transactionBase64);
      setMarket({ ...data, signature });
      setNotice("Certified market creation submitted to Solana Devnet.");
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };

  const seed = async () => {
    if (!market) return;
    setBusy("seed"); setError(""); setNotice("");
    try {
      const baseUnits = BigInt(Math.round(Number(liquidity) * 1_000_000));
      const response = await fetch("/api/v1/markets/seed-liquidity-transaction", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          marketSeed: market.report.hashes.marketSeed,
          amountBaseUnits: baseUnits.toString(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to build liquidity transaction");
      const signature = await signBuiltTransaction(data.transactionBase64);
      setNotice(`Initial liquidity submitted: ${signature.slice(0, 10)}…`);
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };

  const certifiable = report?.analysis?.verdict === "green" && closeAt && resolutionAt;

  return (
    <div className="min-h-screen bg-[#080808] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <div><div className="text-[10px] uppercase tracking-[0.32em] text-white/35">Mary Jane</div><div className="mt-1 text-xl font-semibold">Create Market</div></div>
          <button onClick={connect} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"><Wallet className="h-4 w-4"/>{wallet ? `${wallet.slice(0,4)}…${wallet.slice(-4)}` : "Connect wallet"}</button>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.025] p-6">
          <textarea value={question} onChange={e=>setQuestion(e.target.value)} rows={4} placeholder="Will SOL/USD close above $300 by 31 December 2026?" className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none"/>
          <textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3} placeholder="Resolution criteria and edge cases" className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none"/>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={source} onChange={e=>setSource(e.target.value)} placeholder="Resolution source" className="rounded-xl border border-white/10 bg-black/30 p-3"/>
            <input value={deadline} onChange={e=>setDeadline(e.target.value)} placeholder="Human-readable deadline" className="rounded-xl border border-white/10 bg-black/30 p-3"/>
            <label className="text-xs text-white/45">Close time<input type="datetime-local" value={closeAt} onChange={e=>setCloseAt(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label>
            <label className="text-xs text-white/45">Resolution time<input type="datetime-local" value={resolutionAt} onChange={e=>setResolutionAt(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label>
          </div>
          <input value={category} onChange={e=>setCategory(e.target.value)} placeholder="Category" className="w-full rounded-xl border border-white/10 bg-black/30 p-3"/>
          <div className="grid gap-3 md:grid-cols-2">
            <button onClick={analyze} disabled={!!busy} className="rounded-2xl border border-white/15 py-3 text-sm">{busy==="analyze"?<Loader2 className="mx-auto h-4 w-4 animate-spin"/>:"Run MarketLint"}</button>
            <button onClick={create} disabled={!certifiable || !!busy} className="flex items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-semibold text-black disabled:opacity-30"><Rocket className="h-4 w-4"/>Certify & create</button>
          </div>
          {error && <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</div>}
          {notice && <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">{notice}</div>}
        </section>
        <aside className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
            <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4"/>MarketLint</div>
            {report ? <><div className="mt-4 text-5xl font-semibold">{report.analysis.overallScore}<span className="text-lg text-white/30">/100</span></div><div className="mt-2 text-sm uppercase text-white/50">{report.analysis.verdict}</div><div className="mt-4 text-xs leading-5 text-white/40">{report.analysis.issues.length ? report.analysis.issues.map((x:any)=>x.title).join(" · ") : "No blocking issues."}</div></> : <div className="mt-4 text-sm text-white/35">Compile the draft before launch.</div>}
          </div>
          {market && <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
            <div className="font-semibold">Market created</div>
            <div className="mt-2 break-all font-mono text-[11px] text-white/45">{market.addresses.market}</div>
            <a className="mt-3 flex items-center gap-2 text-xs text-white/60" target="_blank" href={`https://explorer.solana.com/address/${market.addresses.market}?cluster=devnet`}>Explorer <ExternalLink className="h-3 w-3"/></a>
            <div className="mt-5 text-xs text-white/40">Initial USDG liquidity</div>
            <input value={liquidity} onChange={e=>setLiquidity(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3"/>
            <button onClick={seed} disabled={!!busy} className="mt-3 w-full rounded-xl bg-white py-3 text-sm font-semibold text-black">Seed liquidity</button>
          </div>}
        </aside>
      </main>
    </div>
  );
}
export default CreateMarketScreen;
