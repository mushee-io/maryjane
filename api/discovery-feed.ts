import { createHash } from "node:crypto";
import { fetchExternalMarkets, type DiscoveryMarket } from "../src/lib/marketAggregation";

const PROGRAM_ID_STRING = "HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL";
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const MARKET_SIZE = 420;
const KNOWN_MARKETS = ["B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF"];

const LEGACY_METADATA: Record<string, {
  question: string;
  description?: string;
  category: "Crypto" | "Sports" | "Tech" | "World" | "Other";
  source?: string;
  deadline?: string;
}> = {
  "B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF": {
    question: "Will SOL/USD be above $250 at 12:00 UTC on 30 September 2026?",
    description: "YES if the Pyth SOL/USD price is at or above $250.00 at the stated resolution time. NO if it is below $250.00. Use the published Pyth price observation closest to the resolution time.",
    category: "Crypto",
    source: "Pyth Oracle · SOL/USD · target 250",
    deadline: "30 September 2026, 12:00 UTC",
  },
};

function disc(namespace: "account" | "event", name: string) {
  return createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0,8);
}
const MARKET_DISC=disc("account","Market");
const MARKET_CREATED_DISC=disc("event","MarketCreated");

function readPubkey(PublicKey:any, raw:Buffer, offset:number) {
  return new PublicKey(raw.subarray(offset,offset+32)).toBase58();
}
function readI64(raw:Buffer, offset:number) { return Number(raw.readBigInt64LE(offset)); }
function readU64(raw:Buffer, offset:number) { return raw.readBigUInt64LE(offset); }

function decodeMarket(PublicKey:any,address:string,data:Buffer) {
  if(data.length!==MARKET_SIZE || !data.subarray(0,8).equals(MARKET_DISC)) return null;
  return {
    address,
    authority:readPubkey(PublicKey,data,8),
    marketSeed:data.subarray(104,136).toString("hex"),
    closeTs:readI64(data,200),
    resolutionTs:readI64(data,208),
    statusIndex:data.readUInt8(216),
    yesReserve:readU64(data,379),
    noReserve:readU64(data,387),
    volume:readU64(data,403),
  };
}
function statusName(index:number) {
  return ["OPEN","CLOSED","RESOLUTION_PENDING","DISPUTED","RESOLVED_YES","RESOLVED_NO","CANCELLED"][index] || "OPEN";
}
function categoryFromText(value:string) {
  const t=value.toLowerCase();
  if(/crypto|bitcoin|btc|ethereum|eth|solana|sol\b|token|defi|blockchain/.test(t)) return "Crypto";
  if(/sport|football|soccer|nba|nfl|mlb|nhl|tennis|f1|ufc|cricket/.test(t)) return "Sports";
  if(/tech|ai\b|artificial intelligence|apple|google|microsoft|openai|nvidia|software/.test(t)) return "Tech";
  if(/world|politic|election|government|war|country|president|minister|geopolit/.test(t)) return "World";
  return "Other";
}
function marketCreatedFromLogs(PublicKey:any,logs:string[]) {
  const out:string[]=[];
  for(const line of logs||[]) {
    const marker="Program data: ";
    const i=line.indexOf(marker);
    if(i<0) continue;
    try {
      const payload=Buffer.from(line.slice(i+marker.length).trim(),"base64");
      if(payload.length>=40 && payload.subarray(0,8).equals(MARKET_CREATED_DISC)) {
        out.push(new PublicKey(payload.subarray(8,40)).toBase58());
      }
    } catch {}
  }
  return out;
}
function metadataMemo(logs:string[],created:string[]) {
  const out=new Map<string,any>();
  for(const line of logs||[]) {
    if(!line.includes("Program log: Memo (len ")) continue;
    const i=line.indexOf("): ");
    if(i<0) continue;
    try {
      const memoText=JSON.parse(line.slice(i+3).trim());
      const payload=JSON.parse(memoText);
      if(payload?.t!=="maryjane-market" || payload?.v!==1) continue;
      const market=String(payload.m||created[0]||"");
      if(market) out.set(market,payload);
    } catch {}
  }
  return out;
}

async function discoverNative(limit:number) {
  const web3=await import("@solana/web3.js");
  const {Connection,PublicKey}=web3;
  const connection=new Connection(RPC_URL,"confirmed");
  const programId=new PublicKey(PROGRAM_ID_STRING);
  const addresses=new Set<string>(KNOWN_MARKETS);
  const errors:string[]=[];

  // Discover additional markets, but never let a slow RPC block the known
  // onchain markets from appearing.
  try {
    const gpa:any = await Promise.race([
      connection.getProgramAccounts(programId,{
        commitment:"confirmed",
        filters:[{dataSize:MARKET_SIZE}],
      }),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error("getProgramAccounts timeout")),5_000)),
    ]);
    for(const row of gpa || []) {
      const raw=Buffer.from(row.account.data);
      if(raw.subarray(0,8).equals(MARKET_DISC)) addresses.add(row.pubkey.toBase58());
    }
  } catch(error:any) {
    errors.push(`getProgramAccounts:${error?.message||String(error)}`);
  }

  const selected=[...addresses].slice(0,Math.max(limit,10));
  const infos=await Promise.all(selected.map(async(address)=>{
    try {
      const info:any = await Promise.race([
        connection.getAccountInfo(new PublicKey(address),"confirmed"),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error("getAccountInfo timeout")),5_000)),
      ]);
      return {address,info};
    } catch(error:any) {
      errors.push(`account:${address}:${error?.message||String(error)}`);
      return {address,info:null};
    }
  }));

  const items:DiscoveryMarket[]=[];
  for(const {address,info} of infos) {
    if(!info) continue;
    const decoded=decodeMarket(PublicKey,address,Buffer.from(info.data));
    if(!decoded) {
      errors.push(`decode:${address}:not-a-Market-account(len=${Buffer.from(info.data).length})`);
      continue;
    }

    const legacy=LEGACY_METADATA[address];
    const title=legacy?.question||`Mary Jane market ${address.slice(0,8)}…`;
    const category=(legacy?.category||categoryFromText(title)) as any;
    const total=decoded.yesReserve+decoded.noReserve;
    const yes=total===0n?0.5:Number(decoded.noReserve*10000n/total)/10000;
    const status=statusName(decoded.statusIndex);

    items.push({
      id:`maryjane:${address}`,
      source:"maryjane",
      sourceMarketId:address,
      title,
      description:legacy?.description,
      category,
      outcomes:[
        {id:"yes",label:"YES",probability:yes},
        {id:"no",label:"NO",probability:1-yes},
      ],
      volume24h:0,
      volumeTotal:Number(decoded.volume)/1_000_000,
      traders:0,
      tradeCount:0,
      createdAt:address==="B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF"
        ? "2026-09-21T17:09:00.000Z"
        : undefined,
      closesAt:new Date(decoded.closeTs*1000).toISOString(),
      resolved:status.startsWith("RESOLVED")||status==="CANCELLED",
      nativeAddress:address,
      nativeMarketSeed:decoded.marketSeed,
      status,
      probabilitySource:"pool-reference",
    });
  }
  return {items,errors};
}

export default async function handler(req:any,res:any) {
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","s-maxage=5, stale-while-revalidate=15");
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});
  const limit=Math.min(250,Math.max(1,Number(req.query?.limit||180)));

  const [nativeResult,externalResult]=await Promise.allSettled([
    discoverNative(limit),
    fetchExternalMarkets(limit),
  ]);

  const native=nativeResult.status==="fulfilled"?nativeResult.value.items:[];
  const external=externalResult.status==="fulfilled"?externalResult.value.items:[];
  const errors=[
    ...(nativeResult.status==="fulfilled"?nativeResult.value.errors:[`native:${nativeResult.reason?.message||"unavailable"}`]),
    ...(externalResult.status==="fulfilled"?externalResult.value.errors:[`external:${externalResult.reason?.message||"unavailable"}`]),
  ];

  return res.status(200).json({
    items:[...native,...external].filter((m)=>!m.resolved).slice(0,limit),
    errors,
    sources:{
      maryjane:native.length,
      polymarket:external.filter((x)=>x.source==="polymarket").length,
      manifold:external.filter((x)=>x.source==="manifold").length,
    },
    nativeDiagnostics:{
      discovered:native.length,
      knownMarkets:KNOWN_MARKETS.length,
      rpcHost:(()=>{try{return new URL(RPC_URL).host}catch{return "invalid"}})(),
    },
    updatedAt:Date.now(),
  });
}
