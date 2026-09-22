import { createHash } from "node:crypto";

const PROGRAM_ID="HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL";
const RPC_URL=process.env.SOLANA_RPC_URL||"https://api.devnet.solana.com";
const MARKET_DISC=createHash("sha256").update("account:Market").digest().subarray(0,8);
const ORDER_DISC=createHash("sha256").update("account:LimitOrder").digest().subarray(0,8);
const FILLED_DISC=createHash("sha256").update("event:LimitOrderFilled").digest().subarray(0,8);

async function rpc(method:string,params:any[]){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(RPC_URL,{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),
      signal:controller.signal,
      cache:"no-store",
    });
    if(!response.ok)throw new Error(`RPC ${response.status}`);
    const data=await response.json();
    if(data?.error)throw new Error(data.error.message||JSON.stringify(data.error));
    return data.result;
  }finally{clearTimeout(timer);}
}
function accountBuffer(account:any){
  const data=account?.data;
  const encoded=Array.isArray(data)?data[0]:"";
  return encoded?Buffer.from(encoded,"base64"):Buffer.alloc(0);
}
function decodeMarket(raw:Buffer,bs58:any){
  if(raw.length<420||!raw.subarray(0,8).equals(MARKET_DISC))throw new Error("Invalid Mary Jane market account");
  let o=8+32+32;
  const collateralMint=raw.subarray(o,o+32);o+=32;
  const marketSeed=raw.subarray(o,o+32).toString("hex");o+=32;
  o+=32+32;
  const closeTs=Number(raw.readBigInt64LE(o));o+=8;
  const resolutionTs=Number(raw.readBigInt64LE(o));o+=8;
  const statusIndex=raw.readUInt8(o++);const feeBps=raw.readUInt16LE(o);o+=2;
  o+=32+32+32+32+32;
  const yesReserve=raw.readBigUInt64LE(o);o+=8;
  const noReserve=raw.readBigUInt64LE(o);o+=8;
  o+=8;
  const volume=raw.readBigUInt64LE(o);
  const total=yesReserve+noReserve;
  const reserveYesBps=total===0n?5000:Number((noReserve*10000n)/total);
  const status=["OPEN","CLOSED","RESOLUTION_PENDING","DISPUTED","RESOLVED_YES","RESOLVED_NO","CANCELLED"][statusIndex]||"OPEN";
  return{
    marketSeed,closeTs,resolutionTs,status,feeBps,reserveYesBps,totalVolumeBaseUnits:volume.toString(),
    collateralMint:bs58.encode(collateralMint),
    yesMint:bs58.encode(raw.subarray(251,283)),
    noMint:bs58.encode(raw.subarray(283,315)),
  };
}
function decodeOrder(address:string,raw:Buffer,bs58:any){
  if(raw.length!==198||!raw.subarray(0,8).equals(ORDER_DISC))return null;
  let o=8;
  const maker=bs58.encode(raw.subarray(o,o+32));o+=32;
  const market=bs58.encode(raw.subarray(o,o+32));o+=32;
  o+=32;
  const side=raw.readUInt8(o++)===0?"YES":"NO";
  const kind=raw.readUInt8(o++)===0?"BUY":"SELL";
  const priceBps=raw.readUInt16LE(o);o+=2;
  const originalShares=raw.readBigUInt64LE(o);o+=8;
  const remainingShares=raw.readBigUInt64LE(o);o+=8;
  o+=32+32;
  const createdAt=Number(raw.readBigInt64LE(o));o+=8;
  const status=raw.readUInt8(o++)===0?"ACTIVE":"FILLED";
  return{order:address,maker,market,side,kind,priceBps,originalShares:originalShares.toString(),remainingShares:remainingShares.toString(),createdAt,status};
}
function fillEvent(payload:Buffer,bs58:any){
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
  return{order,market,maker,taker,side,kind,priceBps,shares:shares.toString(),quoteAmount:quoteAmount.toString(),remainingShares:remainingShares.toString(),yesPriceBps:side==="YES"?priceBps:10000-priceBps};
}

export default async function handler(req:any,res:any){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","s-maxage=3, stale-while-revalidate=8");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  const address=String(req.query?.address||"").trim();
  if(!address)return res.status(400).json({error:"address is required"});

  try{
    const bs58=(await import("bs58")).default;
    const marketResult=await rpc("getAccountInfo",[address,{commitment:"confirmed",encoding:"base64"}]);
    if(!marketResult?.value)return res.status(404).json({error:"Market not found on Devnet"});
    const market=decodeMarket(accountBuffer(marketResult.value),bs58);

    const orderRows:any[]=await rpc("getProgramAccounts",[PROGRAM_ID,{
      commitment:"confirmed",
      encoding:"base64",
      filters:[{dataSize:198},{memcmp:{offset:40,bytes:address}}],
    }])||[];
    const orders=orderRows.map(row=>decodeOrder(String(row.pubkey),accountBuffer(row.account),bs58)).filter(Boolean);
    const active=orders.filter((order:any)=>order.status==="ACTIVE"&&BigInt(order.remainingShares)>0n);
    const sideBook=(side:"YES"|"NO")=>{
      const bids=active.filter((order:any)=>order.side===side&&order.kind==="BUY").sort((a:any,b:any)=>b.priceBps-a.priceBps||a.createdAt-b.createdAt);
      const asks=active.filter((order:any)=>order.side===side&&order.kind==="SELL").sort((a:any,b:any)=>a.priceBps-b.priceBps||a.createdAt-b.createdAt);
      return{bids,asks,bestBidBps:bids[0]?.priceBps??null,bestAskBps:asks[0]?.priceBps??null};
    };

    const recentTrades:any[]=[];
    try{
      const signatures:any[]=await rpc("getSignaturesForAddress",[address,{limit:35},"confirmed"])||[];
      for(let i=0;i<signatures.length;i+=10){
        const chunk=signatures.slice(i,i+10);
        const transactions=await Promise.all(chunk.map((sig:any)=>rpc("getTransaction",[sig.signature,{commitment:"confirmed",maxSupportedTransactionVersion:0}]).catch(()=>null)));
        transactions.forEach((tx:any,index:number)=>{
          for(const log of tx?.meta?.logMessages||[]){
            const marker="Program data: ";const pos=log.indexOf(marker);if(pos<0)continue;
            try{
              const payload=Buffer.from(log.slice(pos+marker.length).trim(),"base64");
              const trade=fillEvent(payload,bs58);
              if(trade&&trade.market===address)recentTrades.push({...trade,signature:chunk[index].signature,blockTime:tx?.blockTime||chunk[index].blockTime||0});
            }catch{}
          }
        });
        if(recentTrades.length>=20)break;
      }
    }catch{}

    recentTrades.sort((a,b)=>b.blockTime-a.blockTime);
    const cutoff=Math.floor(Date.now()/1000)-86400;
    let volume24=0n,totalMatched=0n;const traders=new Set<string>();
    for(const order of active) traders.add(order.maker);
    for(const trade of recentTrades){
      const quote=BigInt(trade.quoteAmount);
      totalMatched+=quote;if(trade.blockTime>=cutoff)volume24+=quote;
      traders.add(trade.maker);traders.add(trade.taker);
    }
    const latest=recentTrades[0];

    return res.status(200).json({
      market:{address, ...market},
      book:{
        yes:sideBook("YES"),
        no:sideBook("NO"),
        lastMatchedYesBps:latest?.yesPriceBps??null,
        lastMatchedAt:latest?.blockTime??null,
        volume24hBaseUnits:volume24.toString(),
        totalMatchedVolumeBaseUnits:totalMatched.toString(),
        tradeCount:recentTrades.length,
        traderCount:traders.size,
        activeOrderCount:active.length,
      },
      recentTrades:recentTrades.slice(0,20),
      updatedAt:Date.now(),
    });
  }catch(error:any){
    return res.status(500).json({error:error?.message||String(error),stage:"native-market-state"});
  }
}
