import { createHash } from "node:crypto";

const PROGRAM_ID="HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL";
const RPC_URL=process.env.SOLANA_RPC_URL||"https://api.devnet.solana.com";
const ORDER_SIZE=198;
const ORDER_DISC=createHash("sha256").update("account:LimitOrder").digest().subarray(0,8);
const FILLED_DISC=createHash("sha256").update("event:LimitOrderFilled").digest().subarray(0,8);

async function rpc(method:string,params:any[]){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),7000);
  try{
    const r=await fetch(RPC_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:c.signal,cache:"no-store"});
    if(!r.ok) throw new Error(`RPC ${r.status}`);
    const j=await r.json(); if(j?.error) throw new Error(j.error.message||JSON.stringify(j.error)); return j.result;
  }finally{clearTimeout(t);}
}
function dataBuf(a:any){const d=a?.data;const b=Array.isArray(d)?d[0]:"";return b?Buffer.from(b,"base64"):Buffer.alloc(0);}
function decodeOrder(address:string,raw:Buffer,bs58:any){
  if(raw.length!==ORDER_SIZE||!raw.subarray(0,8).equals(ORDER_DISC)) return null;
  let o=8;
  const maker=bs58.encode(raw.subarray(o,o+32)); o+=32;
  const market=bs58.encode(raw.subarray(o,o+32)); o+=32;
  o+=32;
  const side=raw.readUInt8(o++)===0?"YES":"NO";
  const kind=raw.readUInt8(o++)===0?"BUY":"SELL";
  const priceBps=raw.readUInt16LE(o);o+=2;
  const originalShares=raw.readBigUInt64LE(o);o+=8;
  const remainingShares=raw.readBigUInt64LE(o);o+=8;
  const escrowMint=bs58.encode(raw.subarray(o,o+32));o+=32;
  const escrowVault=bs58.encode(raw.subarray(o,o+32));o+=32;
  const createdAt=Number(raw.readBigInt64LE(o));o+=8;
  const status=raw.readUInt8(o++)===0?"ACTIVE":"FILLED";
  return{order:address,maker,market,side,kind,priceBps,originalShares:originalShares.toString(),remainingShares:remainingShares.toString(),escrowMint,escrowVault,createdAt,status};
}
function readFilledEvent(payload:Buffer,bs58:any){
  if(payload.length<8||!payload.subarray(0,8).equals(FILLED_DISC))return null;
  let o=8;
  const order=bs58.encode(payload.subarray(o,o+32));o+=32;
  const market=bs58.encode(payload.subarray(o,o+32));o+=32;
  const maker=bs58.encode(payload.subarray(o,o+32));o+=32;
  const taker=bs58.encode(payload.subarray(o,o+32));o+=32;
  const side=payload.readUInt8(o++)===0?"YES":"NO";
  const kind=payload.readUInt8(o++)===0?"BUY":"SELL";
  const priceBps=payload.readUInt16LE(o);o+=2;
  const shares=payload.readBigUInt64LE(o);o+=8;
  const quoteAmount=payload.readBigUInt64LE(o);o+=8;
  const remainingShares=payload.readBigUInt64LE(o);
  return{order,market,maker,taker,side,kind,priceBps,shares:shares.toString(),quoteAmount:quoteAmount.toString(),remainingShares:remainingShares.toString()};
}

export default async function handler(req:any,res:any){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","s-maxage=3, stale-while-revalidate=8");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  const market=String(req.query?.market||"").trim();
  if(!market)return res.status(400).json({error:"market is required"});
  try{
    const bs58=(await import("bs58")).default;
    const rows:any[]=await rpc("getProgramAccounts",[PROGRAM_ID,{commitment:"confirmed",encoding:"base64",filters:[{dataSize:ORDER_SIZE},{memcmp:{offset:40,bytes:market}}]}])||[];
    const orders=rows.map(r=>decodeOrder(String(r.pubkey),dataBuf(r.account),bs58)).filter(Boolean);
    const active=orders.filter((o:any)=>o.status==="ACTIVE"&&BigInt(o.remainingShares)>0n);

    const sideBook=(side:"YES"|"NO")=>{
      const bids=active.filter((o:any)=>o.side===side&&o.kind==="BUY").sort((a:any,b:any)=>b.priceBps-a.priceBps||a.createdAt-b.createdAt);
      const asks=active.filter((o:any)=>o.side===side&&o.kind==="SELL").sort((a:any,b:any)=>a.priceBps-b.priceBps||a.createdAt-b.createdAt);
      return{bids,asks,bestBidBps:bids[0]?.priceBps??null,bestAskBps:asks[0]?.priceBps??null};
    };

    const trades:any[]=[];
    try{
      const sigs:any[]=await rpc("getSignaturesForAddress",[market,{limit:30},"confirmed"])||[];
      for(let i=0;i<sigs.length;i+=10){
        const chunk=sigs.slice(i,i+10);
        const txs=await Promise.all(chunk.map((s:any)=>rpc("getTransaction",[s.signature,{commitment:"confirmed",maxSupportedTransactionVersion:0}]).catch(()=>null)));
        txs.forEach((tx:any,idx:number)=>{
          for(const line of tx?.meta?.logMessages||[]){
            const marker="Program data: "; const p=line.indexOf(marker); if(p<0)continue;
            try{
              const payload=Buffer.from(line.slice(p+marker.length).trim(),"base64");
              const fill=readFilledEvent(payload,bs58);
              if(fill&&fill.market===market)trades.push({...fill,signature:chunk[idx].signature,blockTime:tx?.blockTime||chunk[idx].blockTime||0});
            }catch{}
          }
        });
        if(trades.length>=20)break;
      }
    }catch{}

    trades.sort((a,b)=>b.blockTime-a.blockTime);
    const cutoff=Math.floor(Date.now()/1000)-86400;
    let volume24=0n,total=0n; const traders=new Set<string>();
    for(const t of trades){const q=BigInt(t.quoteAmount);total+=q;if(t.blockTime>=cutoff)volume24+=q;traders.add(t.maker);traders.add(t.taker);}
    const latest=trades[0];
    const lastMatchedYesBps=latest?(latest.side==="YES"?latest.priceBps:10000-latest.priceBps):null;

    return res.status(200).json({
      yes:sideBook("YES"),no:sideBook("NO"),
      lastMatchedYesBps,lastMatchedAt:latest?.blockTime??null,
      volume24hBaseUnits:volume24.toString(),
      totalMatchedVolumeBaseUnits:total.toString(),
      tradeCount:trades.length,
      traderCount:traders.size,
      recentTrades:trades.slice(0,20),
      activeOrderCount:active.length,
    });
  }catch(e:any){return res.status(500).json({error:e?.message||String(e),stage:"market-book"});}
}
