import React, { useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Rocket, ShieldCheck, Wallet } from "lucide-react";
import { Transaction } from "@solana/web3.js";

function provider() { return (window as any).solana; }
function fromBase64(value: string) { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function toUnix(value: string) { return Math.floor(new Date(value).getTime() / 1000); }
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
  const [resolutionType, setResolutionType] = useState<"PYTH"|"OPTIMISTIC">("PYTH");
  const [pythPair, setPythPair] = useState("SOL/USD");
  const [pythTarget, setPythTarget] = useState("300");
  const [deadline, setDeadline] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [resolutionAt, setResolutionAt] = useState("");
  const [category, setCategory] = useState("Crypto");
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

  const source = resolutionType === "PYTH"
    ? `Pyth Oracle · ${pythPair} · target ${pythTarget}`
    : "Optimistic resolution · public evidence + challenge window";

  const input = () => ({
    question,
    description: resolutionType === "PYTH"
      ? `${description}\n\nResolution source: Pyth ${pythPair}. Target: ${pythTarget}. Resolve using the published Pyth observation at the stated resolution time.`.trim()
      : description,
    source,
    deadline,
    category,
    closeTs: closeAt ? toUnix(closeAt) : undefined,
    resolutionTs: resolutionAt ? toUnix(resolutionAt) : undefined,
  });

  const analyze = async () => {
    setBusy("analyze"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/v1/marketlint/analyze", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(input()) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "MarketLint failed");
      setReport(data);
    } catch (e:any) { setError(e.message); } finally { setBusy(""); }
  };

  const create = async () => {
    if (!wallet) return setError("Connect a Solana wallet first.");
    setBusy("create"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/v1/markets/prepare-create", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({wallet,input:input()}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to prepare market");
      setReport(data.report);
      const signature = await signBuiltTransaction(data.transactionBase64);
      setMarket({ ...data, signature });
      setNotice("Market creation submitted. The indexer will surface it in New as soon as Solana confirms it.");
    } catch (e:any) { setError(e.message); } finally { setBusy(""); }
  };

  const certifiable = report?.analysis?.verdict === "green" && closeAt && resolutionAt;

  return (
    <div className="min-h-screen bg-[#070707] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <a href="/" className="text-lg font-semibold">Mary Jane</a>
          <button onClick={connect} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"><Wallet className="h-4 w-4"/>{wallet ? `${wallet.slice(0,4)}…${wallet.slice(-4)}` : "Connect wallet"}</button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[1fr_360px]">
        <section className="space-y-5 rounded-3xl border border-white/10 bg-white/[.025] p-6">
          <div><div className="text-xs uppercase tracking-[.18em] text-[#b7ff3c]">Permissionless creation</div><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Create a Solana prediction market</h1><p className="mt-2 text-sm text-white/38">MarketLint checks the specification before the wallet signs the onchain market transaction.</p></div>

          <label className="block text-xs text-white/40">Question<textarea value={question} onChange={e=>setQuestion(e.target.value)} rows={3} placeholder="Will SOL/USD close above $300 by 31 December 2026?" className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4 text-base text-white outline-none"/></label>
          <label className="block text-xs text-white/40">Resolution rules<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={4} placeholder="Define exactly what counts as YES, NO and any invalid edge case." className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4 text-white outline-none"/></label>

          <div>
            <div className="text-xs text-white/40">Resolution source</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <button onClick={()=>setResolutionType("PYTH")} className={`rounded-2xl border p-4 text-left ${resolutionType==="PYTH"?"border-[#b7ff3c]/40 bg-[#b7ff3c]/8":"border-white/10"}`}><div className="font-semibold">Pyth market</div><div className="mt-1 text-xs text-white/35">Objective price threshold backed by a Pyth observation.</div></button>
              <button onClick={()=>setResolutionType("OPTIMISTIC")} className={`rounded-2xl border p-4 text-left ${resolutionType==="OPTIMISTIC"?"border-[#b7ff3c]/40 bg-[#b7ff3c]/8":"border-white/10"}`}><div className="font-semibold">Optimistic</div><div className="mt-1 text-xs text-white/35">Public evidence, proposal and challenge window.</div></button>
            </div>
          </div>

          {resolutionType === "PYTH" && <div className="grid gap-3 md:grid-cols-2"><label className="text-xs text-white/40">Pyth pair<input value={pythPair} onChange={e=>setPythPair(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label><label className="text-xs text-white/40">Target value<input value={pythTarget} onChange={e=>setPythTarget(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label></div>}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-white/40">Category<select value={category} onChange={e=>setCategory(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b0b0b] p-3 text-white">{["Crypto","Sports","Tech","World","Other"].map(x=><option key={x}>{x}</option>)}</select></label>
            <label className="text-xs text-white/40">Human-readable deadline<input value={deadline} onChange={e=>setDeadline(e.target.value)} placeholder="31 Dec 2026, 23:59 UTC" className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label>
            <label className="text-xs text-white/40">Trading closes<input type="datetime-local" value={closeAt} onChange={e=>setCloseAt(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label>
            <label className="text-xs text-white/40">Resolution time<input type="datetime-local" value={resolutionAt} onChange={e=>setResolutionAt(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <button onClick={analyze} disabled={!!busy} className="rounded-2xl border border-white/15 py-3 text-sm">{busy==="analyze"?<Loader2 className="mx-auto h-4 w-4 animate-spin"/>:"Run MarketLint"}</button>
            <button onClick={create} disabled={!certifiable || !!busy} className="flex items-center justify-center gap-2 rounded-2xl bg-[#b7ff3c] py-3 text-sm font-semibold text-black disabled:opacity-30"><Rocket className="h-4 w-4"/>Create on Solana</button>
          </div>

          {error && <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</div>}
          {notice && <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">{notice}</div>}
        </section>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/[.025] p-5">
            <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4"/>MarketLint</div>
            {report ? <><div className="mt-4 text-5xl font-semibold">{report.analysis.overallScore}<span className="text-lg text-white/30">/100</span></div><div className="mt-2 text-sm uppercase text-white/50">{report.analysis.verdict}</div><div className="mt-4 text-xs leading-5 text-white/40">{report.analysis.issues.length ? report.analysis.issues.map((x:any)=>x.title).join(" · ") : "No blocking issues."}</div></> : <div className="mt-4 text-sm text-white/35">Compile the market spec before launch.</div>}
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[.025] p-5"><div className="text-sm font-semibold">After creation</div>{["Solana confirms market account","Indexer detects market","Market appears in New","Traders post bids and asks"].map((x,i)=><div key={x} className="mt-4 flex items-center gap-3 text-xs text-white/45"><CheckCircle2 className="h-4 w-4 text-[#b7ff3c]"/><span>{i+1}. {x}</span></div>)}</div>
          {market && <div className="rounded-3xl border border-[#b7ff3c]/20 bg-[#b7ff3c]/5 p-5"><div className="font-semibold">Market submitted</div><div className="mt-2 break-all font-mono text-[11px] text-white/45">{market.addresses.market}</div><a className="mt-4 flex items-center gap-2 text-xs text-white/60" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/address/${market.addresses.market}?cluster=devnet`}>Explorer <ExternalLink className="h-3 w-3"/></a><a href="/" className="mt-4 block rounded-xl bg-white py-3 text-center text-sm font-semibold text-black">Go to markets</a></div>}
        </aside>
      </main>
    </div>
  );
}
export default CreateMarketScreen;
