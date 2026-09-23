import { Buffer } from "buffer";
import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  CircleDollarSign,
  RefreshCw,
  Repeat2,
  Sparkles,
  Wallet,
  Waves,
} from "lucide-react";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const RPC_URL="https://api.devnet.solana.com";
const PROGRAM_ID=new PublicKey("BS3vTdhrkK5zHchx92PFGeodckt1dLzf7i9uJyEsmZst");
const PROTOCOL=new PublicKey("ACszf63tCaLrk11goAU4FLsZyuXq1xznbHsS4SMmSvWc");
const USDG_MINT=new PublicKey("H9fWLuVzqjWjkFjsZ8hSYUb3fGGofa4XHtwCSxQbP9PS");
const LENDING_POOL=new PublicKey("Gkxt6cQjhrqD6CoXLC3TabNxPB1fDYfru1xsTPD1rsru");
const LIQUIDITY_VAULT=new PublicKey("77SvAEarM7aXgvN2TV8Hw4Nd4Dy4oQ3Brv9TM2y9HUPN");

type State={
  programLive:boolean;
  poolUsdg:number;
  pool?:{
    availableUsdg:number;
    totalSuppliedUsdg:number;
    totalBorrowedUsdg:number;
    utilizationPct:number;
    borrowAprPct:number;
    supplyAprPct:number;
  };
  wallet?:{
    address:string;
    sol:number;
    usdg:number;
    supplier:string;
    suppliedUsdg:number;
    supplierClaimUsdg?:number;
    accruedYieldUsdg?:number;
  };
};

type HistoryItem={
  signature:string;
  label:string;
  amount:string;
  timestamp:number;
};

function provider(){return (window as any).solana;}
function short(v:string,l=6,r=5){return v.length>l+r+1?`${v.slice(0,l)}…${v.slice(-r)}`:v;}
function qty(v:number|undefined,d=2){return (v??0).toLocaleString(undefined,{maximumFractionDigits:d});}
function parseAmount(value:string){
  const text=value.trim();
  if(!/^\d+(?:\.\d{0,6})?$/.test(text))throw new Error("Enter a positive USDG amount with at most 6 decimals.");
  const [whole,frac=""]=text.split(".");
  const raw=BigInt(whole)*1_000_000n+BigInt((frac+"000000").slice(0,6));
  if(raw<=0n)throw new Error("Amount must be greater than zero.");
  return raw;
}
function u64(value:bigint){const b=Buffer.alloc(8);b.writeBigUInt64LE(value);return b;}
function disc(hex:string){return Buffer.from(hex,"hex");}
function supplierPda(owner:PublicKey){
  return PublicKey.findProgramAddressSync(
    [Buffer.from("supplier"),LENDING_POOL.toBuffer(),owner.toBuffer()],
    PROGRAM_ID,
  )[0];
}
function faucetPda(){
  return PublicKey.findProgramAddressSync([Buffer.from("faucet"),USDG_MINT.toBuffer()],PROGRAM_ID)[0];
}
function claimPda(owner:PublicKey){
  return PublicKey.findProgramAddressSync([Buffer.from("claim"),owner.toBuffer(),USDG_MINT.toBuffer()],PROGRAM_ID)[0];
}
function friendly(error:any){
  const text=String(error?.message||error||"");
  if(/FaucetCooldown/i.test(text))return "The test USDG faucet is still on cooldown for this wallet.";
  if(/InsufficientSupply/i.test(text))return "That recall is larger than your current 7070 working balance.";
  if(/InsufficientLiquidity/i.test(text))return "The lending pool cannot recall that much liquidity right now. Try a smaller amount.";
  if(/insufficient funds/i.test(text))return "Your wallet does not have enough USDG for that move.";
  if(/User rejected|rejected the request/i.test(text))return "Transaction cancelled in the wallet.";
  return text.length>320?"The Solana transaction failed during simulation. Refresh the balances and retry.":text;
}

export function SeventySeventyScreen(){
  const [wallet,setWallet]=useState("");
  const [state,setState]=useState<State|null>(null);
  const [reserve,setReserve]=useState("50");
  const [amount,setAmount]=useState("100");
  const [recall,setRecall]=useState("100");
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [history,setHistory]=useState<HistoryItem[]>([]);

  const historyKey=(address:string)=>`7070:history:${address}`;

  const load=async(address=wallet)=>{
    const q=new URLSearchParams({miladyState:"1"});
    if(address)q.set("wallet",address);
    const response=await fetch(`/api/discovery-feed?${q.toString()}`,{cache:"no-store"});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data?.error||"Unable to load 7070 state.");
    setState(data);
    return data as State;
  };

  const connect=async()=>{
    const p=provider();
    if(!p?.connect){setError("A Solana wallet such as Phantom is required.");return;}
    setError("");
    const result=await p.connect();
    const address=result.publicKey.toString();
    setWallet(address);
    await load(address);
  };

  const send=async(instructions:TransactionInstruction[])=>{
    const p=provider();
    if(!p?.signTransaction)throw new Error("Connected wallet cannot sign Solana transactions.");
    const connection=new Connection(RPC_URL,"confirmed");
    const owner=new PublicKey(wallet);
    const latest=await connection.getLatestBlockhash("confirmed");
    const tx=new Transaction({feePayer:owner,recentBlockhash:latest.blockhash}).add(...instructions);
    const signed=await p.signTransaction(tx);
    const signature=await connection.sendRawTransaction(signed.serialize(),{
      skipPreflight:false,
      preflightCommitment:"confirmed",
    });
    await connection.confirmTransaction({
      signature,
      blockhash:latest.blockhash,
      lastValidBlockHeight:latest.lastValidBlockHeight,
    },"confirmed");
    return signature;
  };

  const record=(item:HistoryItem)=>{
    const next=[item,...history.filter(x=>x.signature!==item.signature)].slice(0,10);
    setHistory(next);
    try{localStorage.setItem(historyKey(wallet),JSON.stringify(next));}catch{}
  };

  const moveToWork=async(value:string,label="Put USDG to work")=>{
    if(!wallet)return connect();
    setBusy("supply");setError("");setMessage("");
    try{
      const raw=parseAmount(value);
      if(Number(raw)/1e6>(state?.wallet?.usdg||0)+1e-9)throw new Error(`Wallet has only ${qty(state?.wallet?.usdg)} USDG ready to trade.`);
      const owner=new PublicKey(wallet);
      const ata=getAssociatedTokenAddressSync(USDG_MINT,owner);
      const supplier=supplierPda(owner);
      const sig=await send([
        createAssociatedTokenAccountIdempotentInstruction(owner,ata,owner,USDG_MINT),
        new TransactionInstruction({
          programId:PROGRAM_ID,
          keys:[
            {pubkey:owner,isSigner:true,isWritable:true},
            {pubkey:PROTOCOL,isSigner:false,isWritable:false},
            {pubkey:LENDING_POOL,isSigner:false,isWritable:true},
            {pubkey:USDG_MINT,isSigner:false,isWritable:false},
            {pubkey:ata,isSigner:false,isWritable:true},
            {pubkey:LIQUIDITY_VAULT,isSigner:false,isWritable:true},
            {pubkey:supplier,isSigner:false,isWritable:true},
            {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},
            {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
          ],
          data:Buffer.concat([disc("16e2d4f29838c2cd"),u64(raw)]),
        }),
      ]);
      const next=await load(wallet);
      setMessage(`${label}: ${value} USDG moved into productive liquidity. Working balance: ${qty(next.wallet?.supplierClaimUsdg??next.wallet?.suppliedUsdg)} USDG.`);
      record({signature:sig,label,amount:`${value} USDG`,timestamp:Date.now()});
    }catch(e:any){setError(friendly(e));}
    finally{setBusy("");}
  };

  const recallLiquidity=async(value:string)=>{
    if(!wallet)return connect();
    setBusy("recall");setError("");setMessage("");
    try{
      const raw=parseAmount(value);
      const claim=state?.wallet?.supplierClaimUsdg??state?.wallet?.suppliedUsdg??0;
      if(Number(raw)/1e6>claim+1e-9)throw new Error(`7070 currently has about ${qty(claim)} USDG working.`);
      const owner=new PublicKey(wallet);
      const ata=getAssociatedTokenAddressSync(USDG_MINT,owner);
      const sig=await send([
        createAssociatedTokenAccountIdempotentInstruction(owner,ata,owner,USDG_MINT),
        new TransactionInstruction({
          programId:PROGRAM_ID,
          keys:[
            {pubkey:owner,isSigner:true,isWritable:true},
            {pubkey:PROTOCOL,isSigner:false,isWritable:false},
            {pubkey:LENDING_POOL,isSigner:false,isWritable:true},
            {pubkey:USDG_MINT,isSigner:false,isWritable:false},
            {pubkey:ata,isSigner:false,isWritable:true},
            {pubkey:LIQUIDITY_VAULT,isSigner:false,isWritable:true},
            {pubkey:supplierPda(owner),isSigner:false,isWritable:true},
            {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},
          ],
          data:Buffer.concat([disc("5941168bbb6a503f"),u64(raw)]),
        }),
      ]);
      const next=await load(wallet);
      setMessage(`Recalled ${value} USDG to the trading wallet. Ready-to-trade balance: ${qty(next.wallet?.usdg)} USDG.`);
      record({signature:sig,label:"Recall for trading",amount:`${value} USDG`,timestamp:Date.now()});
    }catch(e:any){setError(friendly(e));}
    finally{setBusy("");}
  };

  const claimUsd=async()=>{
    if(!wallet)return connect();
    setBusy("claim");setError("");setMessage("");
    try{
      const owner=new PublicKey(wallet);
      const ata=getAssociatedTokenAddressSync(USDG_MINT,owner);
      const sig=await send([
        createAssociatedTokenAccountIdempotentInstruction(owner,ata,owner,USDG_MINT),
        new TransactionInstruction({
          programId:PROGRAM_ID,
          keys:[
            {pubkey:owner,isSigner:true,isWritable:true},
            {pubkey:PROTOCOL,isSigner:false,isWritable:false},
            {pubkey:faucetPda(),isSigner:false,isWritable:false},
            {pubkey:USDG_MINT,isSigner:false,isWritable:true},
            {pubkey:ata,isSigner:false,isWritable:true},
            {pubkey:claimPda(owner),isSigner:false,isWritable:true},
            {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},
            {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
          ],
          data:disc("5007fb6c37918744"),
        }),
      ]);
      const next=await load(wallet);
      setMessage(`Test USDG claimed. Ready-to-trade balance: ${qty(next.wallet?.usdg)} USDG.`);
      record({signature:sig,label:"Test USDG claimed",amount:"faucet",timestamp:Date.now()});
    }catch(e:any){setError(friendly(e));}
    finally{setBusy("");}
  };

  const sweep=()=>{
    const keep=Math.max(0,Number(reserve)||0);
    const free=state?.wallet?.usdg||0;
    const sweepable=Math.max(0,free-keep);
    if(sweepable<=0){setError("Nothing to sweep above the reserve target.");return;}
    setAmount((Math.floor(sweepable*1e6)/1e6).toString());
    void moveToWork((Math.floor(sweepable*1e6)/1e6).toString(),"Sweep idle USDG");
  };

  const recallMax=()=>{
    const claim=Math.min(
      state?.wallet?.supplierClaimUsdg??state?.wallet?.suppliedUsdg??0,
      state?.pool?.availableUsdg??state?.poolUsdg??0,
    );
    const value=Math.floor(claim*1e6)/1e6;
    setRecall(String(value));
    if(value>0)void recallLiquidity(String(value));
  };

  useEffect(()=>{
    void load("").catch(()=>undefined);
    const p=provider();
    if(p?.publicKey){
      const address=p.publicKey.toString();
      setWallet(address);
      void load(address);
    }
  },[]);

  useEffect(()=>{
    if(!wallet){setHistory([]);return;}
    try{
      const parsed=JSON.parse(localStorage.getItem(historyKey(wallet))||"[]");
      setHistory(Array.isArray(parsed)?parsed:[]);
    }catch{setHistory([]);}
    const timer=window.setInterval(()=>void load(wallet).catch(()=>undefined),15000);
    return()=>window.clearInterval(timer);
  },[wallet]);

  const free=state?.wallet?.usdg||0;
  const working=state?.wallet?.supplierClaimUsdg??state?.wallet?.suppliedUsdg??0;
  const yieldEarned=state?.wallet?.accruedYieldUsdg||0;
  const total=free+working;
  const productivity=total>0?working/total*100:0;
  const apr=state?.pool?.supplyAprPct||0;
  const dailyEstimate=working*(apr/100)/365;
  const reserveNumber=Math.max(0,Number(reserve)||0);
  const sweepable=Math.max(0,free-reserveNumber);

  return(
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
            <a href="/44-milady" className="rounded-full px-4 py-2 text-sm font-semibold text-[#caff75]">44 Milady</a>
            <a href="/7070" className="rounded-full bg-[#b7ff3c]/10 px-4 py-2 text-sm font-semibold text-[#caff75]">7070</a>
          </nav>
          <button onClick={connect} className="ml-auto flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black">
            <Wallet className="h-4 w-4"/>{wallet?short(wallet):"Connect wallet"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-10">
        <section className="overflow-hidden rounded-[34px] border border-white/[.08] bg-[radial-gradient(circle_at_top_right,rgba(183,255,60,.13),transparent_38%),#090909] p-7 md:p-10">
          <div className="max-w-4xl">
            <div className="text-xs font-semibold uppercase tracking-[.22em] text-[#b7ff3c]">Productive liquidity · Solana Devnet</div>
            <h1 className="mt-4 text-6xl font-semibold tracking-[-.07em] md:text-8xl">7070</h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-white/45">
              Idle between trades. Working while it waits. 7070 moves free USDG into productive lending liquidity, then recalls it back to your Mary Jane trading wallet when you need capital for a prediction.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-[#b7ff3c]/20 bg-[#b7ff3c]/5 px-3 py-2 text-[#caff75]">Prediction capital</span>
            <span className="rounded-full border border-white/[.08] px-3 py-2 text-white/45">Yield while idle</span>
            <span className="rounded-full border border-white/[.08] px-3 py-2 text-white/45">One-click recall</span>
            <span className="rounded-full border border-white/[.08] px-3 py-2 text-white/45">44 Milady yield engine</span>
          </div>
        </section>

        {(message||error)&&(
          <section className={`mt-4 rounded-2xl border p-4 text-sm ${error?"border-red-400/20 bg-red-400/5 text-red-200":"border-emerald-400/20 bg-emerald-400/5 text-emerald-200"}`}>
            {error||message}
          </section>
        )}

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Ready to trade",`${qty(free)} USDG`,CircleDollarSign],
            ["Working capital",`${qty(working)} USDG`,Waves],
            ["Accrued yield",`${qty(yieldEarned,6)} USDG`,Sparkles],
            ["Productivity",`${qty(productivity,1)}%`,Repeat2],
          ].map(([label,value,Icon]:any)=>(
            <div key={label} className="rounded-2xl border border-white/[.07] bg-white/[.02] p-5">
              <div className="flex items-center justify-between"><span className="text-[10px] uppercase tracking-[.14em] text-white/25">{label}</span><Icon className="h-4 w-4 text-white/20"/></div>
              <div className="mt-3 text-2xl font-semibold">{value}</div>
            </div>
          ))}
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
          <div className="rounded-[28px] border border-white/[.08] bg-[#0a0a0a] p-6">
            <div className="flex items-start justify-between gap-4">
              <div><div className="text-xs uppercase tracking-[.16em] text-[#b7ff3c]">7070 engine</div><h2 className="mt-2 text-3xl font-semibold">Put idle USDG to work</h2></div>
              <button onClick={()=>{setBusy("refresh");void load(wallet).finally(()=>setBusy(""));}} className="rounded-xl border border-white/[.08] p-2.5 text-white/40"><RefreshCw className={`h-4 w-4 ${busy==="refresh"?"animate-spin":""}`}/></button>
            </div>

            <div className="mt-6 rounded-2xl border border-white/[.07] bg-black/25 p-4">
              <div className="flex items-center justify-between text-xs"><span className="text-white/35">Keep ready for trades</span><span className="text-white/60">{qty(reserveNumber)} USDG reserve</span></div>
              <input value={reserve} onChange={e=>setReserve(e.target.value)} inputMode="decimal" className="mt-3 w-full rounded-xl border border-white/[.08] bg-black/40 p-3 text-lg outline-none"/>
              <div className="mt-3 flex items-center justify-between text-[10px] text-white/25"><span>Wallet {qty(free)} USDG</span><span>Sweepable {qty(sweepable)} USDG</span></div>
              <button onClick={sweep} disabled={Boolean(busy)||!wallet||sweepable<=0} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#b7ff3c] py-3.5 text-sm font-semibold text-black disabled:opacity-35">
                <ArrowDownToLine className="h-4 w-4"/>{busy==="supply"?"Moving capital…":"Sweep idle USDG"}
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/[.07] p-4">
                <div className="text-xs text-white/35">Manual move</div>
                <input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" className="mt-3 w-full rounded-xl border border-white/[.08] bg-black/35 p-3 outline-none"/>
                <div className="mt-2 flex gap-2">
                  <button onClick={()=>setAmount(String(Math.floor(free*1e6)/1e6))} className="rounded-lg border border-white/[.08] px-3 py-2 text-[10px] text-white/55">Max</button>
                  <button onClick={()=>void moveToWork(amount)} disabled={Boolean(busy)||!wallet} className="flex-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-35">Put to work</button>
                </div>
              </div>
              <div className="rounded-2xl border border-white/[.07] p-4">
                <div className="text-xs text-white/35">Recall for a prediction</div>
                <input value={recall} onChange={e=>setRecall(e.target.value)} inputMode="decimal" className="mt-3 w-full rounded-xl border border-white/[.08] bg-black/35 p-3 outline-none"/>
                <div className="mt-2 flex gap-2">
                  <button onClick={recallMax} disabled={Boolean(busy)||working<=0} className="rounded-lg border border-white/[.08] px-3 py-2 text-[10px] text-white/55 disabled:opacity-35">Recall max</button>
                  <button onClick={()=>void recallLiquidity(recall)} disabled={Boolean(busy)||!wallet||working<=0} className="flex-1 rounded-lg border border-[#b7ff3c]/20 px-3 py-2 text-xs font-semibold text-[#caff75] disabled:opacity-35">Recall USDG</button>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button onClick={claimUsd} disabled={Boolean(busy)||!wallet} className="rounded-xl border border-white/[.08] px-4 py-3 text-xs font-semibold text-white/60 disabled:opacity-35">{busy==="claim"?"Claiming…":"Get test USDG"}</button>
              <a href="/" className="flex items-center gap-2 rounded-xl border border-white/[.08] px-4 py-3 text-xs font-semibold text-white/60">Go to markets <ArrowRight className="h-3.5 w-3.5"/></a>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-[28px] border border-white/[.08] bg-[#0a0a0a] p-5">
              <div className="text-xs uppercase tracking-[.14em] text-white/25">Live yield engine</div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Supply APR</div><div className="mt-1 text-xl font-semibold">{qty(apr,2)}%</div></div>
                <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Utilization</div><div className="mt-1 text-xl font-semibold">{qty(state?.pool?.utilizationPct,2)}%</div></div>
                <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Daily estimate</div><div className="mt-1 text-xl font-semibold">{qty(dailyEstimate,6)} USDG</div></div>
                <div className="rounded-xl bg-white/[.025] p-3"><div className="text-[10px] text-white/25">Pool available</div><div className="mt-1 text-xl font-semibold">{qty(state?.pool?.availableUsdg??state?.poolUsdg,2)}</div></div>
              </div>
              <p className="mt-4 text-[10px] leading-5 text-white/25">APR and daily yield are live estimates from the current 44 Milady lending pool. Yield accrues through the supplier index and is synchronized on your next supply or recall transaction.</p>
            </div>

            <div className="rounded-[28px] border border-white/[.08] bg-[#0a0a0a] p-5">
              <div className="text-xs uppercase tracking-[.14em] text-white/25">The 7070 loop</div>
              <div className="mt-4 space-y-3">
                {[
                  ["1","USDG waits between prediction trades"],
                  ["2","7070 routes the idle portion into productive liquidity"],
                  ["3","Supplier yield accrues while capital is parked"],
                  ["4","Recall USDG back to the wallet before the next trade"],
                ].map(([n,label])=>(
                  <div key={n} className="flex items-center gap-3 rounded-xl bg-white/[.02] p-3 text-xs text-white/50"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#b7ff3c]/10 text-[#caff75]">{n}</span>{label}</div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/[.08] bg-[#0a0a0a] p-5">
              <div className="flex items-center justify-between"><div className="text-xs uppercase tracking-[.14em] text-white/25">Recent 7070 moves</div><span className="text-[10px] text-white/20">Devnet</span></div>
              <div className="mt-4 space-y-2">
                {history.length===0?<div className="rounded-xl border border-dashed border-white/[.08] p-4 text-xs text-white/25">Your successful sweeps and recalls appear here.</div>:history.slice(0,6).map(item=>(
                  <a key={item.signature} href={`https://explorer.solana.com/tx/${item.signature}?cluster=devnet`} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-white/[.06] p-3 text-xs">
                    <div><div className="text-white/65">{item.label}</div><div className="mt-1 text-[10px] text-white/25">{item.amount}</div></div>
                    <span className="font-mono text-[10px] text-[#caff75]">{short(item.signature,5,4)}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default SeventySeventyScreen;
