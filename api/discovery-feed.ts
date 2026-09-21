import { createHash } from "node:crypto";

const PROGRAM_ID="HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL";
const RPC_URL=process.env.SOLANA_RPC_URL||"https://api.devnet.solana.com";
const MARKET_SIZE=420;
const KNOWN=["B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF"];
const DISC=createHash("sha256").update("account:Market").digest().subarray(0,8);

const META:Record<string,any>={
  "B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF":{
    question:"Will SOL/USD be above $250 at 12:00 UTC on 30 September 2026?",
    description:"YES if the Pyth SOL/USD price is at or above $250.00 at the stated resolution time. NO if it is below $250.00. Use the published Pyth price observation closest to the resolution time.",
    category:"Crypto",
    source:"Pyth Oracle · SOL/USD · target 250",
    createdAt:"2026-09-21T17:09:00.000Z",
  },
};

async function jsonFetch(url:string,init:RequestInit={},timeout=7000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetch(url,{...init,signal:controller.signal,cache:"no-store"});
    if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  }finally{clearTimeout(timer);}
}

async function rpc(method:string,params:any[]){
  const body=await jsonFetch(RPC_URL,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),
  },7000);
  if(body?.error) throw new Error(body.error.message||JSON.stringify(body.error));
  return body?.result;
}

function dataBuffer(account:any){
  const value=account?.data;
  const base64=Array.isArray(value)?value[0]:typeof value==="string"?value:"";
  return base64?Buffer.from(base64,"base64"):Buffer.alloc(0);
}
function i64(raw:Buffer,o:number){return Number(raw.readBigInt64LE(o));}
function u64(raw:Buffer,o:number){return raw.readBigUInt64LE(o);}
function statusName(i:number){return["OPEN","CLOSED","RESOLUTION_PENDING","DISPUTED","RESOLVED_YES","RESOLVED_NO","CANCELLED"][i]||"OPEN";}

function decode(address:string,account:any){
  const raw=dataBuffer(account);
  if(raw.length!==MARKET_SIZE||!raw.subarray(0,8).equals(DISC)) return null;
  return{
    address,
    marketSeed:raw.subarray(104,136).toString("hex"),
    closeTs:i64(raw,200),
    resolutionTs:i64(raw,208),
    status:statusName(raw.readUInt8(216)),
    yesReserve:u64(raw,379),
    noReserve:u64(raw,387),
    volume:u64(raw,403),
  };
}

async function nativeMarkets(limit:number){
  const errors:string[]=[];
  const addresses=new Set<string>(KNOWN);

  try{
    const rows:any[]=await rpc("getProgramAccounts",[
      PROGRAM_ID,
      {commitment:"confirmed",encoding:"base64",filters:[{dataSize:MARKET_SIZE}]},
    ])||[];
    for(const row of rows){
      const raw=dataBuffer(row.account);
      if(raw.length===MARKET_SIZE&&raw.subarray(0,8).equals(DISC)) addresses.add(String(row.pubkey));
    }
  }catch(e:any){errors.push(`getProgramAccounts:${e?.message||e}`);}

  const items:any[]=[];
  for(const address of [...addresses].slice(0,Math.max(limit,10))){
    try{
      const result=await rpc("getAccountInfo",[address,{commitment:"confirmed",encoding:"base64"}]);
      if(!result?.value) continue;
      const m=decode(address,result.value);
      if(!m){errors.push(`decode:${address}`);continue;}
      const meta=META[address]||{};
      const total=m.yesReserve+m.noReserve;
      const yes=total===0n?0.5:Number(m.noReserve*10000n/total)/10000;
      items.push({
        id:`maryjane:${address}`,
        source:"maryjane",
        sourceMarketId:address,
        title:meta.question||`Mary Jane market ${address.slice(0,8)}…`,
        description:meta.description,
        category:meta.category||"Other",
        outcomes:[{id:"yes",label:"YES",probability:yes},{id:"no",label:"NO",probability:1-yes}],
        volume24h:0,
        volumeTotal:Number(m.volume)/1_000_000,
        traders:0,
        tradeCount:0,
        createdAt:meta.createdAt,
        closesAt:new Date(m.closeTs*1000).toISOString(),
        resolved:m.status.startsWith("RESOLVED")||m.status==="CANCELLED",
        nativeAddress:address,
        nativeMarketSeed:m.marketSeed,
        status:m.status,
        probabilitySource:"pool-reference",
      });
    }catch(e:any){errors.push(`account:${address}:${e?.message||e}`);}
  }
  return{items,errors};
}

function prob(v:any){
  const n=Number(v);
  if(!Number.isFinite(n)) return undefined;
  return Math.max(0,Math.min(1,n>1?n/100:n));
}
function arr(v:any){
  if(Array.isArray(v)) return v;
  if(typeof v!=="string") return[];
  try{const x=JSON.parse(v);return Array.isArray(x)?x:[];}catch{return[];}
}
function category(text:string){
  const t=text.toLowerCase();
  if(/crypto|bitcoin|btc|ethereum|eth|solana|\bsol\b|token|defi/.test(t))return"Crypto";
  if(/sport|football|soccer|nba|nfl|tennis|ufc|cricket/.test(t))return"Sports";
  if(/tech|\bai\b|openai|nvidia|apple|google|microsoft|software/.test(t))return"Tech";
  if(/politic|election|government|president|minister|war|geopolit|world/.test(t))return"World";
  return"Other";
}

async function externalMarkets(limit:number){
  const errors:string[]=[];
  const items:any[]=[];

  try{
    const events:any=await jsonFetch(
      `https://gamma-api.polymarket.com/events?active=true&closed=false&order=volume_24hr&ascending=false&limit=${Math.min(50,Math.max(15,limit))}`,
      {},7000
    );
    for(const event of Array.isArray(events)?events:[]){
      for(const m of Array.isArray(event?.markets)?event.markets:[]){
        const labels=arr(m.outcomes).map(String);
        const prices=arr(m.outcomePrices);
        const yi=labels.findIndex(x=>x.toLowerCase()==="yes");
        const ni=labels.findIndex(x=>x.toLowerCase()==="no");
        const yes=prob(prices[yi>=0?yi:0])??0.5;
        const no=prob(prices[ni>=0?ni:1])??(1-yes);
        const id=String(m.id||m.conditionId||m.slug||m.question);
        if(!m.question||m.closed)continue;
        items.push({
          id:`polymarket:${id}`,source:"polymarket",sourceMarketId:id,title:String(m.question),
          description:String(m.description||event.description||"")||undefined,
          category:category(`${event.title||""} ${m.question}`),
          outcomes:[{id:"yes",label:"YES",probability:yes},{id:"no",label:"NO",probability:no}],
          volume24h:Number(m.volume24hr||0),volumeTotal:Number(m.volumeNum||m.volume||0),
          createdAt:m.createdAt||event.startDate,closesAt:m.endDate,resolved:false,
          externalUrl:event.slug?`https://polymarket.com/event/${event.slug}`:"https://polymarket.com",
          probabilitySource:"external",
        });
      }
    }
  }catch(e:any){errors.push(`polymarket:${e?.message||e}`);}

  try{
    const rows:any=await jsonFetch(
      `https://api.manifold.markets/v0/search-markets?term=&sort=24-hour-vol&filter=open&contractType=BINARY&limit=${Math.min(50,Math.max(15,limit))}`,
      {},7000
    );
    for(const m of Array.isArray(rows)?rows:[]){
      const yes=prob(m.probability);
      if(!m.question||yes===undefined||m.isResolved)continue;
      const id=String(m.id||m.slug||m.question);
      items.push({
        id:`manifold:${id}`,source:"manifold",sourceMarketId:id,title:String(m.question),
        description:String(m.textDescription||"")||undefined,category:category(String(m.question)),
        outcomes:[{id:"yes",label:"YES",probability:yes},{id:"no",label:"NO",probability:1-yes}],
        volume24h:Number(m.volume24Hours||0),volumeTotal:Number(m.volume||0),
        traders:Number(m.uniqueBettorCount||0),
        createdAt:m.createdTime?new Date(Number(m.createdTime)).toISOString():undefined,
        closesAt:m.closeTime?new Date(Number(m.closeTime)).toISOString():undefined,
        resolved:false,externalUrl:m.url||"https://manifold.markets",probabilitySource:"external",
      });
    }
  }catch(e:any){errors.push(`manifold:${e?.message||e}`);}

  return{items,errors};
}

export default async function handler(req:any,res:any){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","s-maxage=5, stale-while-revalidate=15");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});

  try{
    const limit=Math.min(180,Math.max(1,Number(req.query?.limit||120)));
    const [native,external]=await Promise.all([nativeMarkets(limit),externalMarkets(limit)]);
    const items=[...native.items,...external.items].filter(x=>!x.resolved).slice(0,limit);
    return res.status(200).json({
      items,
      errors:[...native.errors,...external.errors],
      sources:{
        maryjane:native.items.length,
        polymarket:external.items.filter(x=>x.source==="polymarket").length,
        manifold:external.items.filter(x=>x.source==="manifold").length,
      },
      nativeDiagnostics:{runtime:"pure-json-rpc",known:KNOWN.length,rpcHost:new URL(RPC_URL).host},
      updatedAt:Date.now(),
    });
  }catch(e:any){
    return res.status(500).json({error:e?.message||String(e),stage:"discovery-handler"});
  }
}
