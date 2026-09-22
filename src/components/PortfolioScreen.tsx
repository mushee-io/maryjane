import React, { useEffect, useMemo, useState } from "react";
// portfolio deployment marker
import { ArrowUpRight, Clock3, RefreshCw, Wallet } from "lucide-react";
import { Connection, Transaction } from "@solana/web3.js";

type Position = {
  address:string; title:string; category?:string; status:string; closeTs:number; resolutionTs:number;
  yesLabel:string; noLabel:string; yesImageUrl?:string; noImageUrl?:string; coverImageUrl?:string;
  yesUi:number; noUi:number; yesPriceBps:number; noPriceBps:number; yesAvgEntryBps:number; noAvgEntryBps:number;
  currentValueBaseUnits:string; costBasisBaseUnits:string; unrealizedPnlBaseUnits:string; realizedPnlBaseUnits:string;
  claimableBaseUnits:string; yesMint:string; noMint:string; costBasisEstimated?:boolean;
  resolution?:any;
};
type OpenOrder={order:string;market:string;side:"YES"|"NO";kind:"BUY"|"SELL";priceBps:number;remainingShares:string;reservedBaseUnits:string;createdAt:number};
type History={type:string;signature:string;blockTime:number;market:string;side?:string;kind?:string;priceBps?:number;shares?:string;quoteAmount?:string;amount?:string;collateralPaid?:string};
type Portfolio={
  wallet:string; sol:{uiAmount:number};
  summary:{usdg:number;positionValueBaseUnits:string;unrealizedPnlBaseUnits:string;realizedPnlBaseUnits:string;claimableBaseUnits:string;openOrders:number;markets:number};
  positions:Position[];openOrders:OpenOrder[];history:History[];updatedAt:number;
};

function provider(){return (window as any).solana;}
function fromBase64(value:string){const binary=atob(value);return Uint8Array.from(binary,c=>c.charCodeAt(0));}
async function jsonOrThrow(response:Response){
  const text=await response.text();let data:any={};
  try{data=text?JSON.parse(text):{};}catch{throw new Error(`API ${response.status}: ${text.slice(0,160)}`);}
  if(!response.ok)throw new Error(data?.error||"Request failed");return data;
}
async function signBuiltTransaction(transactionBase64:string,lastValidBlockHeight?:number){
  const p=provider();if(!p?.signAndSendTransaction)throw new Error("Connect a compatible Solana wallet first.");
  const tx=Transaction.from(fromBase64(transactionBase64));const result=await p.signAndSendTransaction(tx);
  const signature=typeof result==="string"?result:result.signature;
  if(tx.recentBlockhash&&lastValidBlockHeight){
    const connection=new Connection("https://api.devnet.solana.com","confirmed");
    const confirmation=await connection.confirmTransaction({signature,blockhash:tx.recentBlockhash,lastValidBlockHeight},"confirmed");
    if(confirmation.value.err)throw new Error("Transaction failed on Solana.");
  }
  return signature;
}
function short(value:string,left=5,right=4){return value.length>left+right+1?`${value.slice(0,left)}…${value.slice(-right)}`:value;}
function base(value?:string){return Number(value||"0")/1e6;}
function usd(value?:string){const n=base(value);return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(n);}
function signedUsd(value?:string){const n=base(value);return `${n>=0?"+":"-"}${new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(Math.abs(n))}`;}
function when(ts?:number){if(!ts)return"—";return new Date(ts*1000).toLocaleString(undefined,{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});}
function ago(ts?:number){if(!ts)return"—";const s=Math.max(0,Math.floor(Date.now()/1000-ts));if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;if(s<86400)return`${Math.floor(s/3600)}h ago`;return`${Math.floor(s/86400)}d ago`;}
function historyText(item:History,position?:Position){
  const yes=position?.yesLabel||"YES",no=position?.noLabel||"NO";
  if(item.type==="FILL"){
    const side=item.side==="YES"?yes:no;
    return `${item.kind==="BUY"?"Matched":"Matched"} ${side} · ${((item.priceBps||0)/100).toFixed(2)}¢ · ${(Number(item.shares||0)/1e6).toFixed(2)} shares`;
  }
  if(item.type==="SPLIT")return`Split ${(Number(item.amount||0)/1e6).toFixed(2)} USDG into outcome shares`;
  if(item.type==="MERGE")return`Merged ${(Number(item.amount||0)/1e6).toFixed(2)} complete sets`;
  if(item.type==="REDEEM")return`Redeemed ${usd(item.collateralPaid)} winnings`;
  if(item.type==="REFUND")return`Claimed ${usd(item.collateralPaid)} invalid-market refund`;
  if(item.type==="ORDER_PLACED")return`Placed ${item.kind} ${item.side==="YES"?yes:no} @ ${((item.priceBps||0)/100).toFixed(2)}¢`;
  if(item.type==="ORDER_CANCELLED")return"Cancelled resting order";
  return item.type.replaceAll("_"," ");
}

export function PortfolioScreen(){
  const [wallet,setWallet]=useState("");
  const [data,setData]=useState<Portfolio|null>(null);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  const connect=async()=>{
    const p=provider();if(!p?.connect){setError("Install or unlock a compatible Solana wallet.");return;}
    const result=await p.connect();setWallet(result.publicKey.toString());
  };
  const load=async()=>{
    if(!wallet)return;
    setLoading(true);setError("");
    try{
      const response=await fetch(`/api/trader-state?wallet=${encodeURIComponent(wallet)}`,{cache:"no-store"});
      setData(await jsonOrThrow(response));
    }catch(e:any){setError(e?.message||"Unable to load portfolio");}
    finally{setLoading(false);}
  };
  useEffect(()=>{void load();if(!wallet)return;const timer=window.setInterval(()=>void load(),15_000);return()=>window.clearInterval(timer);},[wallet]);

  const positionMap=useMemo(()=>new Map((data?.positions||[]).map(p=>[p.address,p])),[data]);

  const cancel=async(order:OpenOrder)=>{
    if(!wallet)return connect();setBusy(order.order);setNotice("");
    try{
      const response=await fetch("/api/order-cancel",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet,order:order.order})});
      const tx=await jsonOrThrow(response);const signature=await signBuiltTransaction(tx.transactionBase64,tx.lastValidBlockHeight);
      setNotice(`Order cancelled · ${short(signature,7,6)}`);await load();
    }catch(e:any){setError(e?.message||"Unable to cancel order");}finally{setBusy("");}
  };

  const settle=async(position:Position)=>{
    if(!wallet)return connect();
    const action=position.status==="CANCELLED"?"REFUND":"REDEEM";
    setBusy(position.address);setNotice("");setError("");
    try{
      const response=await fetch("/api/market-action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,wallet,market:position.address})});
      const tx=await jsonOrThrow(response);const signature=await signBuiltTransaction(tx.transactionBase64,tx.lastValidBlockHeight);
      setNotice(action==="REDEEM"?`Winnings redeemed · ${short(signature,7,6)}`:`Refund claimed · ${short(signature,7,6)}`);await load();
    }catch(e:any){setError(e?.message||"Unable to settle position");}finally{setBusy("");}
  };

  return(
    <div className="min-h-screen bg-[#060606] text-[#f5f5ef]">
      <header className="sticky top-0 z-30 border-b border-white/[.08] bg-[#060606]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1450px] flex-wrap items-center gap-4 px-5 py-4 md:flex-nowrap">
          <a href="/" className="flex items-center gap-2.5"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#b7ff3c] text-sm font-black text-black">M</div><span className="text-lg font-semibold">Mary Jane</span></a>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto pt-2 md:order-none md:w-auto md:overflow-visible md:pt-0">
            <a href="/" className="rounded-full px-4 py-2 text-sm text-white/45">Markets</a>
            <a href="/portfolio" className="rounded-full bg-white/[.08] px-4 py-2 text-sm">Portfolio</a>
            <a href="/create" className="rounded-full px-4 py-2 text-sm text-white/45">Create</a>
            <a href="/analytics" className="rounded-full px-4 py-2 text-sm text-white/45">Analytics</a>
            <a href="/44-milady" className="rounded-full px-4 py-2 text-sm font-semibold text-[#caff75]">44 Milady</a>
          </nav>
          <button onClick={connect} className="ml-auto flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black"><Wallet className="h-4 w-4"/>{wallet?short(wallet):"Connect"}</button>
        </div>
      </header>

      <main className="mx-auto max-w-[1450px] px-5 py-9">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div><div className="text-xs uppercase tracking-[.2em] text-[#b7ff3c]">Wallet intelligence</div><h1 className="mt-2 text-4xl font-semibold tracking-[-.05em] md:text-5xl">Portfolio & positions</h1><p className="mt-3 text-sm text-white/38">Native Mary Jane holdings, resting orders, P&L and settlement from Solana Devnet.</p></div>
          {wallet&&<button onClick={()=>void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-white/[.08] px-4 py-2 text-xs text-white/55"><RefreshCw className={`h-3.5 w-3.5 ${loading?"animate-spin":""}`}/>Refresh</button>}
        </div>

        {!wallet&&<div className="mt-10 flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-dashed border-white/[.09] bg-white/[.015] text-center"><Wallet className="h-8 w-8 text-white/20"/><div className="mt-4 text-xl font-semibold">Connect your trading wallet</div><div className="mt-2 max-w-md text-sm text-white/30">Mary Jane reads your native positions directly from Solana. No account or portfolio database is required.</div><button onClick={connect} className="mt-6 rounded-xl bg-[#b7ff3c] px-5 py-3 text-sm font-semibold text-black">Connect wallet</button></div>}

        {wallet&&loading&&!data&&<div className="mt-10 rounded-3xl border border-white/[.08] bg-white/[.02] px-5 py-14 text-center"><RefreshCw className="mx-auto h-5 w-5 animate-spin text-[#b7ff3c]"/><div className="mt-3 text-sm text-white/55">Loading Solana balances and Mary Jane positions…</div></div>}
        {wallet&&error&&!data&&<div className="mt-6 rounded-2xl border border-rose-300/20 bg-rose-300/[.07] p-4 text-sm text-rose-200"><div className="font-semibold">Portfolio could not load</div><div className="mt-1 text-xs text-rose-100/70">{error}</div><button onClick={()=>void load()} className="mt-3 rounded-lg border border-rose-200/20 px-3 py-2 text-xs">Retry</button></div>}

        {wallet&&data&&<>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
            {[
              ["SOL",data.sol.uiAmount.toFixed(4)],
              ["USDG",`${data.summary.usdg.toFixed(2)}`],
              ["Positions",usd(data.summary.positionValueBaseUnits)],
              ["Unrealized",signedUsd(data.summary.unrealizedPnlBaseUnits)],
              ["Realized",signedUsd(data.summary.realizedPnlBaseUnits)],
              ["Claimable",usd(data.summary.claimableBaseUnits)],
              ["Open orders",String(data.summary.openOrders)],
            ].map(([label,value])=><div key={label} className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4"><div className="text-[10px] uppercase tracking-wider text-white/25">{label}</div><div className={`mt-2 text-xl font-semibold ${label==="Unrealized"||label==="Realized"?String(value).startsWith("-")?"text-rose-300":"text-emerald-300":""}`}>{value}</div></div>)}
          </div>

          {(notice||error)&&<div className={`mt-5 rounded-xl border p-3 text-xs ${error?"border-rose-300/20 bg-rose-300/[.07] text-rose-200":"border-emerald-300/20 bg-emerald-300/[.07] text-emerald-200"}`}>{error||notice}</div>}

          <section className="mt-10">
            <div className="flex items-end justify-between"><div><div className="text-xs uppercase tracking-[.16em] text-white/25">Positions</div><h2 className="mt-2 text-2xl font-semibold">Native market exposure</h2></div><div className="text-xs text-white/25">{data.positions.length} markets</div></div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {data.positions.map(position=>{
                const claimable=BigInt(position.claimableBaseUnits||"0")>0n;
                return <div key={position.address} className="overflow-hidden rounded-3xl border border-white/[.08] bg-[#0b0b0b]">
                  {position.coverImageUrl&&<img src={position.coverImageUrl} alt="" className="h-28 w-full object-cover opacity-80"/>}
                  <div className="p-5">
                    <div className="flex items-center justify-between gap-3"><span className="rounded-full bg-[#b7ff3c]/10 px-2.5 py-1 text-[10px] font-semibold tracking-[.12em] text-[#caff75]">{position.status}</span><span className="text-[10px] text-white/25">{position.category||"Native"}</span></div>
                    <h3 className="mt-4 text-xl font-semibold leading-6">{position.title}</h3>
                    <div className="mt-5 grid grid-cols-2 gap-2">
                      {[
                        ["YES",position.yesLabel,position.yesImageUrl,position.yesUi,position.yesPriceBps,position.yesAvgEntryBps],
                        ["NO",position.noLabel,position.noImageUrl,position.noUi,position.noPriceBps,position.noAvgEntryBps],
                      ].map(([id,label,image,balance,mark,avg]:any)=><div key={id} className={`rounded-2xl p-3 ${id==="YES"?"bg-emerald-300/[.06]":"bg-rose-300/[.06]"}`}>
                        <div className="flex items-center gap-2">{image&&<img src={image} alt="" className="h-8 w-8 rounded-full border border-white/10 bg-white object-cover"/>}<div className="min-w-0"><div className="truncate text-xs font-semibold">{label}</div><div className="mt-1 text-[10px] text-white/28">{Number(balance).toFixed(2)} shares</div></div></div>
                        <div className="mt-3 flex justify-between text-[10px] text-white/30"><span>Avg</span><span>{avg?Number(avg/100).toFixed(2):"—"}¢</span></div>
                        <div className="mt-1 flex justify-between text-[10px] text-white/30"><span>Mark</span><span>{Number(mark/100).toFixed(2)}¢</span></div>
                      </div>)}
                    </div>
                    {position.costBasisEstimated&&<div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[.05] px-3 py-2 text-[10px] leading-4 text-amber-100/70">Cost basis is estimated because this wallet has outcome-token transfers that were not Mary Jane trades.</div>}
                    <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/[.06] pt-4 text-xs">
                      <div><div className="text-white/25">Value</div><div className="mt-1 font-semibold">{usd(position.currentValueBaseUnits)}</div></div>
                      <div><div className="text-white/25">Unrealized</div><div className={`mt-1 font-semibold ${base(position.unrealizedPnlBaseUnits)>=0?"text-emerald-300":"text-rose-300"}`}>{signedUsd(position.unrealizedPnlBaseUnits)}</div></div>
                      <div><div className="text-white/25">Realized</div><div className={`mt-1 font-semibold ${base(position.realizedPnlBaseUnits)>=0?"text-emerald-300":"text-rose-300"}`}>{signedUsd(position.realizedPnlBaseUnits)}</div></div>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-[10px] text-white/25"><span>Closes {when(position.closeTs)}</span><a href={`https://explorer.solana.com/address/${position.address}?cluster=devnet`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-white">Explorer <ArrowUpRight className="h-3 w-3"/></a></div>
                    {claimable&&<button onClick={()=>void settle(position)} disabled={!!busy} className="mt-4 w-full rounded-xl bg-[#b7ff3c] py-3 text-sm font-semibold text-black disabled:opacity-40">{busy===position.address?"Confirming…":position.status==="CANCELLED"?`Claim refund · ${usd(position.claimableBaseUnits)}`:`Redeem winnings · ${usd(position.claimableBaseUnits)}`}</button>}
                  </div>
                </div>;
              })}
              {!data.positions.length&&<div className="col-span-full rounded-3xl border border-dashed border-white/[.08] py-16 text-center text-sm text-white/28">No native Mary Jane positions or activity yet.</div>}
            </div>
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-[1fr_.9fr]">
            <div className="rounded-3xl border border-white/[.08] bg-white/[.018] p-5">
              <div className="flex items-center justify-between"><div><div className="text-xs uppercase tracking-[.16em] text-white/25">Orders</div><h2 className="mt-2 text-xl font-semibold">Open orders</h2></div><span className="text-xs text-white/25">{data.openOrders.length}</span></div>
              <div className="mt-5 space-y-2">
                {data.openOrders.map(order=>{const p=positionMap.get(order.market);const label=order.side==="YES"?(p?.yesLabel||"YES"):(p?.noLabel||"NO");return <div key={order.order} className="flex items-center gap-3 rounded-2xl border border-white/[.06] bg-black/20 p-3"><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{p?.title||short(order.market,8,6)}</div><div className="mt-1 text-xs text-white/30">{order.kind} {label} · {(order.priceBps/100).toFixed(2)}¢ · {(Number(order.remainingShares)/1e6).toFixed(2)} shares</div></div><button onClick={()=>void cancel(order)} disabled={!!busy} className="rounded-lg border border-white/[.1] px-3 py-2 text-[10px] text-white/45 hover:text-white">Cancel</button></div>})}
                {!data.openOrders.length&&<div className="py-12 text-center text-xs text-white/25">No resting orders.</div>}
              </div>
            </div>

            <div className="rounded-3xl border border-white/[.08] bg-white/[.018] p-5">
              <div><div className="text-xs uppercase tracking-[.16em] text-white/25">Activity</div><h2 className="mt-2 text-xl font-semibold">Transaction history</h2></div>
              <div className="mt-5 max-h-[520px] space-y-1 overflow-y-auto pr-1">
                {data.history.map((item,index)=>{const p=positionMap.get(item.market);return <a key={`${item.signature}-${item.type}-${index}`} href={`https://explorer.solana.com/tx/${item.signature}?cluster=devnet`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl px-2 py-3 hover:bg-white/[.03]"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[.04]"><Clock3 className="h-3.5 w-3.5 text-white/30"/></div><div className="min-w-0 flex-1"><div className="truncate text-xs text-white/70">{historyText(item,p)}</div><div className="mt-1 truncate text-[10px] text-white/22">{p?.title||short(item.market,8,6)}</div></div><span className="text-[10px] text-white/25">{ago(item.blockTime)}</span></a>})}
                {!data.history.length&&<div className="py-12 text-center text-xs text-white/25">No wallet activity found.</div>}
              </div>
            </div>
          </section>

          <div className="mt-6 text-[10px] leading-5 text-white/20">Average entry and P&L are reconstructed from Mary Jane onchain fills, complete-set splits/merges and settlement events. Direct token transfers can make cost basis an estimate.</div>
        </>}
      </main>
    </div>
  );
}
export default PortfolioScreen;
