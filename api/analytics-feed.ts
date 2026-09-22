import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

const PROGRAM_ID="HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL";
const RPC_URL=process.env.SOLANA_RPC_URL||"https://api.devnet.solana.com";
const MARKET_SIZE=420;
const BETA_SIZE=263;
const MARKET_DISC=createHash("sha256").update("account:Market").digest().subarray(0,8);
const BETA_DISC=createHash("sha256").update("account:BetaRound").digest().subarray(0,8);
const MARKET_STATUS=["OPEN","CLOSED","RESOLUTION_PENDING","DISPUTED","RESOLVED_YES","RESOLVED_NO","CANCELLED"] as const;
const BETA_STATUS=["OPEN","LOCKED","SETTLED"] as const;
const BETA_OUTCOME=["UNRESOLVED","UP","DOWN","PUSH"] as const;
const KNOWN_MARKETS=["B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF"];

async function rpc(method:string,params:any[],timeout=9000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
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
  const value=account?.data;
  const encoded=Array.isArray(value)?value[0]:typeof value==="string"?value:"";
  return encoded?Buffer.from(encoded,"base64"):Buffer.alloc(0);
}
function pk(raw:Buffer,offset:number){return new PublicKey(raw.subarray(offset,offset+32)).toBase58();}
function tokenAmount(account:any){
  const raw=accountBuffer(account);
  return raw.length>=72?raw.readBigUInt64LE(64):0n;
}
function probabilityBps(a:bigint,b:bigint){
  const total=a+b;
  return total===0n?5000:Number((a*10000n)/total);
}

function decodeMarket(address:string,account:any){
  const raw=accountBuffer(account);
  if(raw.length<MARKET_SIZE||!raw.subarray(0,8).equals(MARKET_DISC))return null;
  let o=8;
  const authority=pk(raw,o);o+=32;
  const config=pk(raw,o);o+=32;
  const collateralMint=pk(raw,o);o+=32;
  const marketSeed=raw.subarray(o,o+32).toString("hex");o+=32;
  const questionHash=raw.subarray(o,o+32).toString("hex");o+=32;
  const metadataHash=raw.subarray(o,o+32).toString("hex");o+=32;
  const closeTs=Number(raw.readBigInt64LE(o));o+=8;
  const resolutionTs=Number(raw.readBigInt64LE(o));o+=8;
  const status=MARKET_STATUS[raw.readUInt8(o++)]||"OPEN";
  const feeBps=raw.readUInt16LE(o);o+=2;
  const collateralVault=pk(raw,o);o+=32;
  const yesMint=pk(raw,o);o+=32;
  const noMint=pk(raw,o);o+=32;
  const yesReserveVault=pk(raw,o);o+=32;
  const noReserveVault=pk(raw,o);o+=32;
  const yesReserve=raw.readBigUInt64LE(o);o+=8;
  const noReserve=raw.readBigUInt64LE(o);o+=8;
  const lpSupply=raw.readBigUInt64LE(o);o+=8;
  const volume=raw.readBigUInt64LE(o);o+=8;
  const protocolFees=raw.readBigUInt64LE(o);o+=8;
  const yesProbabilityBps=probabilityBps(noReserve,yesReserve);
  return{
    address,authority,config,collateralMint,marketSeed,questionHash,metadataHash,
    closeTs,resolutionTs,status,feeBps,collateralVault,yesMint,noMint,
    yesReserveVault,noReserveVault,yesReserve:yesReserve.toString(),noReserve:noReserve.toString(),
    lpSupply:lpSupply.toString(),volume:volume.toString(),protocolFees:protocolFees.toString(),
    collateralVaultBalance:"0",yesProbabilityBps,noProbabilityBps:10000-yesProbabilityBps,
    updatedAt:Date.now(),
  };
}

function decodeBeta(address:string,account:any){
  const raw=accountBuffer(account);
  if(raw.length<BETA_SIZE||!raw.subarray(0,8).equals(BETA_DISC))return null;
  let o=8;
  const assetHash=raw.subarray(o,o+32).toString("hex");o+=32;
  const roundId=raw.readBigUInt64LE(o).toString();o+=8;
  const collateralMint=pk(raw,o);o+=32;
  const vault=pk(raw,o);o+=32;
  const startPrice=raw.readBigInt64LE(o).toString();o+=8;
  const endPrice=raw.readBigInt64LE(o).toString();o+=8;
  const priceExponent=raw.readInt32LE(o);o+=4;
  const startObservedTs=Number(raw.readBigInt64LE(o));o+=8;
  const endObservedTs=Number(raw.readBigInt64LE(o));o+=8;
  o+=32+32;
  const openTs=Number(raw.readBigInt64LE(o));o+=8;
  const lockTs=Number(raw.readBigInt64LE(o));o+=8;
  const closeTs=Number(raw.readBigInt64LE(o));o+=8;
  const upPool=raw.readBigUInt64LE(o);o+=8;
  const downPool=raw.readBigUInt64LE(o);o+=8;
  const protocolFees=raw.readBigUInt64LE(o);o+=8;
  const outcome=BETA_OUTCOME[raw.readUInt8(o++)]||"UNRESOLVED";
  const status=BETA_STATUS[raw.readUInt8(o++)]||"OPEN";
  const upProbabilityBps=probabilityBps(upPool,downPool);
  return{
    address,assetHash,roundId,collateralMint,vault,startPrice,endPrice,priceExponent,
    startObservedTs,endObservedTs,openTs,lockTs,closeTs,upPool:upPool.toString(),
    downPool:downPool.toString(),protocolFees:protocolFees.toString(),outcome,status,
    vaultBalance:"0",upProbabilityBps,downProbabilityBps:10000-upProbabilityBps,
  };
}

async function programRows(size:number){
  const result=await rpc("getProgramAccounts",[
    PROGRAM_ID,
    {commitment:"confirmed",encoding:"base64",filters:[{dataSize:size}]},
  ]);
  return Array.isArray(result)?result:[];
}

async function multipleAccounts(addresses:string[]){
  const out=new Map<string,any>();
  for(let i=0;i<addresses.length;i+=100){
    const chunk=addresses.slice(i,i+100);
    if(!chunk.length)continue;
    const result=await rpc("getMultipleAccounts",[chunk,{commitment:"confirmed",encoding:"base64"}]);
    const values=result?.value||[];
    chunk.forEach((address,index)=>out.set(address,values[index]||null));
  }
  return out;
}

export default async function handler(req:any,res:any){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","s-maxage=4, stale-while-revalidate=12");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});

  const errors:string[]=[];
  try{
    let marketRows:any[]=[];
    let betaRows:any[]=[];

    try{marketRows=await programRows(MARKET_SIZE);}catch(error:any){errors.push(`markets:${error?.message||error}`);}
    try{betaRows=await programRows(BETA_SIZE);}catch(error:any){errors.push(`beta:${error?.message||error}`);}

    const seen=new Set(marketRows.map(row=>String(row.pubkey)));
    for(const address of KNOWN_MARKETS){
      if(seen.has(address))continue;
      try{
        const result=await rpc("getAccountInfo",[address,{commitment:"confirmed",encoding:"base64"}]);
        if(result?.value)marketRows.push({pubkey:address,account:result.value});
      }catch(error:any){errors.push(`fallback:${address}:${error?.message||error}`);}
    }

    let markets=marketRows
      .map(row=>decodeMarket(String(row.pubkey),row.account))
      .filter(Boolean) as any[];
    const betaRounds=betaRows
      .map(row=>decodeBeta(String(row.pubkey),row.account))
      .filter(Boolean) as any[];

    const vaults=[...markets.map(m=>m.collateralVault),...betaRounds.map(r=>r.vault)];
    try{
      const balances=await multipleAccounts([...new Set(vaults)]);
      markets=markets.map(m=>({...m,collateralVaultBalance:tokenAmount(balances.get(m.collateralVault)).toString()}));
      betaRounds.forEach(round=>{round.vaultBalance=tokenAmount(balances.get(round.vault)).toString();});
    }catch(error:any){errors.push(`vaults:${error?.message||error}`);}

    const q=String(req.query?.q||"").trim().toLowerCase();
    const status=String(req.query?.status||"ALL").toUpperCase();
    if(q){
      markets=markets.filter(m=>[m.address,m.questionHash,m.metadataHash,m.authority].some(value=>String(value).toLowerCase().includes(q)));
    }
    if(status!=="ALL")markets=markets.filter(m=>m.status===status);

    const sort=String(req.query?.sort||"volume");
    markets.sort((a,b)=>{
      if(sort==="liquidity")return Number(BigInt(b.collateralVaultBalance)-BigInt(a.collateralVaultBalance));
      if(sort==="ending")return a.closeTs-b.closeTs;
      if(sort==="newest")return b.resolutionTs-a.resolutionTs;
      return Number(BigInt(b.volume)-BigInt(a.volume));
    });
    const limit=Math.max(1,Math.min(200,Number(req.query?.limit||100)));
    markets=markets.slice(0,limit);

    const allMarkets=marketRows.map(row=>decodeMarket(String(row.pubkey),row.account)).filter(Boolean) as any[];
    const totals=allMarkets.reduce((acc,m)=>{
      acc.volume+=BigInt(m.volume);
      acc.fees+=BigInt(m.protocolFees);
      acc.outcome+=BigInt(m.yesReserve)+BigInt(m.noReserve);
      return acc;
    },{volume:0n,fees:0n,outcome:0n});
    let totalCollateral=0n;
    for(const market of markets)totalCollateral+=BigInt(market.collateralVaultBalance||"0");
    for(const round of betaRounds)totalCollateral+=BigInt(round.vaultBalance||"0");

    const analytics={
      updatedAt:Date.now(),
      totalMarkets:allMarkets.length,
      openMarkets:allMarkets.filter(m=>m.status==="OPEN").length,
      resolvedMarkets:allMarkets.filter(m=>String(m.status).startsWith("RESOLVED")).length,
      disputedMarkets:allMarkets.filter(m=>m.status==="DISPUTED").length,
      cancelledMarkets:allMarkets.filter(m=>m.status==="CANCELLED").length,
      betaRounds:betaRounds.length,
      liveBetaRounds:betaRounds.filter(r=>r.status==="OPEN"||r.status==="LOCKED").length,
      totalVolumeBaseUnits:totals.volume.toString(),
      volume24hBaseUnits:"0",
      totalCollateralLockedBaseUnits:totalCollateral.toString(),
      totalProtocolFeesBaseUnits:totals.fees.toString(),
      outcomeLiquidityBaseUnits:totals.outcome.toString(),
      activeTraders24h:0,
      events24h:0,
    };

    return res.status(200).json({
      analytics,
      markets,
      betaRounds:betaRounds.sort((a,b)=>b.openTs-a.openTs).slice(0,50),
      events:[],
      diagnostics:{runtime:"standalone-rpc",errors},
    });
  }catch(error:any){
    return res.status(200).json({
      analytics:{
        updatedAt:Date.now(),totalMarkets:0,openMarkets:0,resolvedMarkets:0,disputedMarkets:0,cancelledMarkets:0,
        betaRounds:0,liveBetaRounds:0,totalVolumeBaseUnits:"0",volume24hBaseUnits:"0",
        totalCollateralLockedBaseUnits:"0",totalProtocolFeesBaseUnits:"0",outcomeLiquidityBaseUnits:"0",
        activeTraders24h:0,events24h:0,
      },
      markets:[],betaRounds:[],events:[],
      diagnostics:{runtime:"standalone-rpc",errors:[error?.message||String(error)]},
    });
  }
}
