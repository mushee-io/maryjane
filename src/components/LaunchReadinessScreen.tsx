import React, { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, RefreshCw, XCircle } from "lucide-react";

export function LaunchReadinessScreen() {
  const [data,setData]=useState<any>(null);
  const [error,setError]=useState("");
  const load=async()=>{try{setError("");const r=await fetch("/api/v1/launch/readiness");const j=await r.json();if(!r.ok)throw new Error(j.error||"Readiness failed");setData(j);}catch(e:any){setError(e.message);}};
  useEffect(()=>{load();},[]);
  return <div className="min-h-screen bg-[#080808] text-white">
    <header className="border-b border-white/10"><div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5"><div><div className="text-[10px] uppercase tracking-[0.32em] text-white/35">Mary Jane</div><div className="mt-1 text-xl font-semibold">Launch Readiness</div></div><button onClick={load} className="rounded-full border border-white/10 p-2"><RefreshCw className="h-4 w-4"/></button></div></header>
    <main className="mx-auto max-w-5xl px-5 py-6">
      {error&&<div className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-rose-300">{error}</div>}
      {data&&<>
        <div className={`rounded-3xl border p-6 ${data.readyForMarkets?"border-emerald-400/20 bg-emerald-400/10":"border-amber-400/20 bg-amber-400/10"}`}><div className="text-sm uppercase tracking-wider text-white/50">Devnet market stack</div><div className="mt-2 text-3xl font-semibold">{data.readyForMarkets?"READY":"CONFIGURATION REQUIRED"}</div><div className="mt-2 text-sm text-white/45">Public creation: {data.readyForPublicCreation?"enabled":"disabled"}</div></div>
        <div className="mt-6 grid gap-3 md:grid-cols-2">{data.checks.map((check:any)=><div key={check.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="flex items-center gap-3">{check.ok?<CheckCircle2 className="h-5 w-5 text-emerald-400"/>:<XCircle className="h-5 w-5 text-rose-400"/>}<div><div className="text-sm font-medium">{check.label}</div><div className="text-[10px] uppercase text-white/30">{check.critical?"critical":"optional"}</div></div></div>{check.address&&<div className="mt-3 break-all font-mono text-[10px] text-white/30">{check.address}</div>}</div>)}</div>
        <div className="mt-6 rounded-2xl border border-white/10 p-4 text-xs text-white/40">RPC: {data.rpc}<br/>Indexer last sync: {data.indexer?.lastSyncAt ? new Date(data.indexer.lastSyncAt).toLocaleString() : "not synced"}</div>
        <div className="mt-6 flex gap-3"><a href="/create" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">Create market</a><a href={`https://explorer.solana.com/address/${data.programId}?cluster=devnet`} target="_blank" className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm">Program <ExternalLink className="h-3 w-3"/></a></div>
      </>}
    </main>
  </div>;
}
export default LaunchReadinessScreen;
