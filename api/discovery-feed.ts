import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const PROGRAM_ID="HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL";
const RPC_URL=process.env.SOLANA_RPC_URL||"https://api.devnet.solana.com";
const MARKET_SIZE=420;
const MEMO_PROGRAM_ID="MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const metadataCache=new Map<string,{at:number,value:any,ttl:number}>();
const METADATA_HOSTS=new Set([
  "res.cloudinary.com",
  "maryjane-blue.vercel.app",
  ...String(process.env.MARY_JANE_METADATA_HOSTS||"").split(",").map(value=>value.trim().toLowerCase()).filter(Boolean),
]);
const KNOWN=["B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF"];
const DISC=createHash("sha256").update("account:Market").digest().subarray(0,8);

const MILADY_PROGRAM_ID=new PublicKey("BS3vTdhrkK5zHchx92PFGeodckt1dLzf7i9uJyEsmZst");
const MILADY_PROTOCOL=new PublicKey("ACszf63tCaLrk11goAU4FLsZyuXq1xznbHsS4SMmSvWc");
const MILADY_USDG=new PublicKey("H9fWLuVzqjWjkFjsZ8hSYUb3fGGofa4XHtwCSxQbP9PS");
const MILADY_POOL=new PublicKey("Gkxt6cQjhrqD6CoXLC3TabNxPB1fDYfru1xsTPD1rsru");
const MILADY_LIQUIDITY_VAULT=new PublicKey("77SvAEarM7aXgvN2TV8Hw4Nd4Dy4oQ3Brv9TM2y9HUPN");

function miladyCredit(owner:PublicKey){
  return PublicKey.findProgramAddressSync([Buffer.from("credit"),owner.toBuffer()],MILADY_PROGRAM_ID)[0];
}
function miladySupplier(owner:PublicKey){
  return PublicKey.findProgramAddressSync([Buffer.from("supplier"),MILADY_POOL.toBuffer(),owner.toBuffer()],MILADY_PROGRAM_ID)[0];
}
function miladyVault(credit:PublicKey,market:PublicKey){
  return PublicKey.findProgramAddressSync([Buffer.from("vault"),credit.toBuffer(),market.toBuffer()],MILADY_PROGRAM_ID)[0];
}
async function rpcAmount(address:PublicKey){
  try{
    const result=await rpc("getTokenAccountBalance",[address.toBase58(),{"commitment":"confirmed"}]);
    return BigInt(result?.value?.amount||"0");
  }catch{return 0n;}
}
async function rpcAccount(address:PublicKey){
  const result=await rpc("getAccountInfo",[address.toBase58(),{"commitment":"confirmed","encoding":"base64"}]).catch(()=>null);
  return result?.value||null;
}
function accountRaw(account:any){
  return dataBuffer(account);
}
function decodeMiladyCredit(raw:Buffer){
  if(raw.length<76)return null;
  let offset=40;
  const debt=raw.readBigUInt64LE(offset);
  offset=72;
  const count=raw.readUInt32LE(offset);
  offset+=4+count*40;
  if(offset+32>raw.length)return{debt,collateralValue:0n,borrowLimit:0n,liquidationCapacity:0n,health:0n};
  const collateralValue=raw.readBigUInt64LE(offset);offset+=8;
  const borrowLimit=raw.readBigUInt64LE(offset);offset+=8;
  const liquidationCapacity=raw.readBigUInt64LE(offset);offset+=8;
  const health=raw.readBigUInt64LE(offset);
  return{debt,collateralValue,borrowLimit,liquidationCapacity,health};
}
async function pythSolPayload(){
  const apiKey=String(process.env.PYTH_API_KEY||"").trim();
  if(!apiKey)return{configured:false,price:null,updateData:null,error:"PYTH_API_KEY is not configured"};

  const feedId="0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
  const url=new URL("https://pyth.dourolabs.app/hermes/v2/updates/price/latest");
  url.searchParams.append("ids[]",feedId);
  url.searchParams.set("encoding","base64");
  url.searchParams.set("parsed","true");

  const response=await fetch(url,{
    headers:{authorization:`Bearer ${apiKey}`,accept:"application/json"},
    signal:AbortSignal.timeout(12000),
  });
  const text=await response.text();
  if(!response.ok)return{configured:true,price:null,updateData:null,error:`Pyth request failed (${response.status}): ${text.slice(0,180)}`};

  const body=JSON.parse(text);
  const parsed=body.parsed?.find((item:any)=>("0x"+String(item.id||"").replace(/^0x/,"")).toLowerCase()===feedId)??body.parsed?.[0];
  if(!parsed?.price||!body?.binary?.data?.length)return{configured:true,price:null,updateData:null,error:"Pyth SOL/USD response is incomplete"};
  return{
    configured:true,
    feedId,
    price:Number(parsed.price.price)*10**Number(parsed.price.expo),
    updateData:body.binary.data,
    publishTime:Number(parsed.price.publish_time||0),
    error:"",
  };
}
async function miladyState(walletText?:string){
  const rows:any[]=await rpc("getProgramAccounts",[
    MILADY_PROGRAM_ID.toBase58(),
    {commitment:"confirmed",encoding:"base64"}
  ])||[];

  let solx:any=null;
  for(const row of rows){
    const raw=dataBuffer(row.account);
    if(raw.length<150)continue;
    const symbol=raw.subarray(72,80).toString("utf8").replace(/\0+$/g,"");
    if(symbol!=="SOLx")continue;
    solx={
      market:new PublicKey(String(row.pubkey)),
      mint:new PublicKey(raw.subarray(40,72)),
      ltvBps:raw.readUInt16LE(113),
      liquidationThresholdBps:raw.readUInt16LE(115),
    };
    break;
  }
  if(!solx)throw new Error("SOLx market not found on 44 Milady Devnet");

  const [programAccount,poolRaw,poolAccount,pyth]=await Promise.all([
    rpcAccount(MILADY_PROGRAM_ID),
    rpcAmount(MILADY_LIQUIDITY_VAULT),
    rpcAccount(MILADY_POOL),
    pythSolPayload().catch((error:any)=>({configured:Boolean(process.env.PYTH_API_KEY),price:null,updateData:null,error:error?.message||String(error)})),
  ]);

  const poolData=poolAccount?accountRaw(poolAccount):Buffer.alloc(0);
  const totalSuppliedRaw=poolData.length>=237?poolData.readBigUInt64LE(104):0n;
  const totalBorrowedRaw=poolData.length>=237?poolData.readBigUInt64LE(112):0n;
  const reserveFactorBps=poolData.length>=237?poolData.readUInt16LE(208):0;
  const borrowAprBps=poolData.length>=237?poolData.readUInt32LE(224):0;
  const supplyAprBps=poolData.length>=237?poolData.readUInt32LE(228):0;
  const utilizationPct=totalSuppliedRaw>0n
    ? Number(totalBorrowedRaw*10_000n/totalSuppliedRaw)/100
    : 0;

  const base:any={
    network:"devnet",
    programId:MILADY_PROGRAM_ID.toBase58(),
    programLive:Boolean(programAccount?.executable),
    protocol:MILADY_PROTOCOL.toBase58(),
    usdgMint:MILADY_USDG.toBase58(),
    lendingPool:MILADY_POOL.toBase58(),
    liquidityVault:MILADY_LIQUIDITY_VAULT.toBase58(),
    poolUsdg:Number(poolRaw)/1_000_000,
    pool:{
      availableUsdg:Number(poolRaw)/1_000_000,
      totalSuppliedUsdg:Number(totalSuppliedRaw)/1_000_000,
      totalBorrowedUsdg:Number(totalBorrowedRaw)/1_000_000,
      utilizationPct,
      borrowAprPct:borrowAprBps/100,
      supplyAprPct:supplyAprBps/100,
      reserveFactorPct:reserveFactorBps/100,
    },
    solx:{
      market:solx.market.toBase58(),
      mint:solx.mint.toBase58(),
      ltvBps:solx.ltvBps,
      liquidationThresholdBps:solx.liquidationThresholdBps,
    },
    oracle:{price:pyth.price,configured:pyth.configured,error:pyth.error||""},
  };

  if(!walletText)return base;
  const owner=new PublicKey(walletText);
  const credit=miladyCredit(owner);
  const supplier=miladySupplier(owner);
  const vault=miladyVault(credit,solx.market);
  const usdgAta=getAssociatedTokenAddressSync(MILADY_USDG,owner);
  const solxAta=getAssociatedTokenAddressSync(solx.mint,owner);

  const [creditAccount,supplierAccount,walletUsdg,walletSolx,vaultSolx,solBalance]=await Promise.all([
    rpcAccount(credit),
    rpcAccount(supplier),
    rpcAmount(usdgAta),
    rpcAmount(solxAta),
    rpcAmount(vault),
    rpc("getBalance",[owner.toBase58(),{"commitment":"confirmed"}]).catch(()=>({value:0})),
  ]);

  const decoded=creditAccount?decodeMiladyCredit(accountRaw(creditAccount)):null;
  const supplied=supplierAccount&&accountRaw(supplierAccount).length>=80?accountRaw(supplierAccount).readBigUInt64LE(72):0n;
  const debt=Number(decoded?.debt||0n)/1_000_000;
  const deposited=Number(vaultSolx)/1_000_000;
  let collateralValue=Number(decoded?.collateralValue||0n)/1_000_000;
  let borrowLimit=Number(decoded?.borrowLimit||0n)/1_000_000;
  let liquidationCapacity=Number(decoded?.liquidationCapacity||0n)/1_000_000;
  if(pyth.price!=null&&deposited>0){
    collateralValue=deposited*pyth.price;
    borrowLimit=collateralValue*(solx.ltvBps/10_000);
    liquidationCapacity=collateralValue*(solx.liquidationThresholdBps/10_000);
  }

  return{
    ...base,
    solx:{...base.solx,walletBalance:Number(walletSolx)/1_000_000,deposited},
    wallet:{
      address:owner.toBase58(),
      sol:Number(solBalance?.value||0)/1e9,
      usdg:Number(walletUsdg)/1_000_000,
      credit:credit.toBase58(),
      creditExists:Boolean(creditAccount),
      supplier:supplier.toBase58(),
      suppliedUsdg:Number(supplied)/1_000_000,
    },
    credit:{
      debt,
      collateralValue,
      borrowLimit,
      availableToBorrow:Math.max(0,borrowLimit-debt),
      liquidationCapacity,
      healthFactor:debt>0?liquidationCapacity/debt:null,
    },
  };
}

const META:Record<string,any>={
  "B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF":{
    question:"Will SOL/USD be above $250 at 12:00 UTC on 30 September 2026?",
    description:"YES if the Pyth SOL/USD price is at or above $250.00 at the stated resolution time. NO if it is below $250.00. Use the published Pyth price observation closest to the resolution time.",
    category:"Crypto",
    source:"Pyth Oracle · SOL/USD · target 250",
    createdAt:"2026-09-21T17:09:00.000Z",
  },
};

function safeMetadataUrl(value:any){
  try{
    const url=new URL(String(value||""));
    if(url.protocol!=="https:")return null;
    if(!METADATA_HOSTS.has(url.hostname.toLowerCase()))return null;
    return url.toString();
  }catch{return null;}
}
function safeText(value:any,max:number){
  return String(value||"").replace(/[\u0000-\u001F\u007F]/g,"").trim().slice(0,max)||undefined;
}
function safeNativeImage(value:any){
  const url=safeMetadataUrl(value);
  return url&&/\.(?:png|jpe?g|webp|gif|svg)(?:$|\?)/i.test(url)?url:undefined;
}
async function mapLimit<T,R>(items:T[],limit:number,fn:(item:T,index:number)=>Promise<R>){
  const out=new Array<R>(items.length);
  let cursor=0;
  async function worker(){
    while(true){
      const index=cursor++;
      if(index>=items.length)return;
      out[index]=await fn(items[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return out;
}

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

async function nativeMetadata(address:string){
  const cached=metadataCache.get(address);
  if(cached&&Date.now()-cached.at<cached.ttl)return cached.value;

  let memo:any={};
  let metadataError="";
  try{
    const signatures:any[]=await rpc("getSignaturesForAddress",[address,{limit:6},"confirmed"])||[];
    for(const signature of signatures){
      const tx=await rpc("getTransaction",[signature.signature,{commitment:"confirmed",encoding:"jsonParsed",maxSupportedTransactionVersion:0}]).catch(()=>null);
      const instructions=tx?.transaction?.message?.instructions||[];
      for(const ix of instructions){
        if(String(ix?.programId||"")!==MEMO_PROGRAM_ID)continue;
        const parsed=typeof ix?.parsed==="string"?ix.parsed:"";
        if(!parsed)continue;
        try{
          const candidate=JSON.parse(parsed);
          if(candidate?.t==="maryjane-market"&&(!candidate?.m||candidate.m===address)){memo=candidate;break;}
        }catch{}
      }
      if(memo?.t)break;
    }
  }catch(error:any){metadataError=String(error?.message||error);}

  let remote:any={};
  const metadataUrl=safeMetadataUrl(memo?.u);
  if(metadataUrl){
    try{
      const candidate=await jsonFetch(metadataUrl,{},5000);
      if(candidate&&candidate.t==="maryjane-market-metadata")remote=candidate;
    }catch(error:any){metadataError=String(error?.message||error);}
  }

  const value={
    question:safeText(remote?.question||memo?.q,220),
    description:safeText(remote?.description,2000),
    category:safeText(remote?.category||memo?.c,32),
    source:safeText(remote?.source||memo?.s,180),
    deadline:safeText(remote?.deadline||memo?.d,96),
    createdAt:safeText(remote?.createdAt,64),
    yesLabel:safeText(remote?.yesLabel,48),
    noLabel:safeText(remote?.noLabel,48),
    coverImageUrl:safeNativeImage(remote?.coverImageUrl),
    yesImageUrl:safeNativeImage(remote?.yesImageUrl),
    noImageUrl:safeNativeImage(remote?.noImageUrl),
    metadataUrl:metadataUrl||undefined,
    metadataError:metadataError||undefined,
  };
  const useful=Boolean(value.question||value.description||value.coverImageUrl||value.yesImageUrl||value.noImageUrl);
  metadataCache.set(address,{at:Date.now(),value,ttl:useful?300_000:20_000});
  return value;
}

async function nativeMarkets(limit:number){
  const errors:string[]=[];
  const accountByAddress=new Map<string,any>();

  try{
    const rows:any[]=await rpc("getProgramAccounts",[
      PROGRAM_ID,
      {commitment:"confirmed",encoding:"base64",filters:[{dataSize:MARKET_SIZE}]},
    ])||[];
    for(const row of rows){
      const raw=dataBuffer(row.account);
      if(raw.length===MARKET_SIZE&&raw.subarray(0,8).equals(DISC))accountByAddress.set(String(row.pubkey),row.account);
    }
  }catch(e:any){errors.push(`getProgramAccounts:${e?.message||e}`);}

  const missingKnown=KNOWN.filter(address=>!accountByAddress.has(address));
  if(missingKnown.length){
    try{
      const result=await rpc("getMultipleAccounts",[missingKnown,{commitment:"confirmed",encoding:"base64"}]);
      (result?.value||[]).forEach((account:any,index:number)=>{if(account)accountByAddress.set(missingKnown[index],account);});
    }catch(e:any){errors.push(`knownFallback:${e?.message||e}`);}
  }

  const addresses=[...accountByAddress.keys()].slice(0,Math.min(180,Math.max(limit,10)));
  const rows=await mapLimit(addresses,6,async(address)=>{
    const account=accountByAddress.get(address);
    const m=decode(address,account);
    if(!m){errors.push(`decode:${address}`);return null;}
    let chainMeta:any={};
    try{chainMeta=await nativeMetadata(address);}catch(e:any){errors.push(`metadata:${address}:${e?.message||e}`);}
    if(chainMeta?.metadataError)errors.push(`metadata:${address}:${chainMeta.metadataError}`);
    const meta={...(META[address]||{}),...chainMeta};
    const total=m.yesReserve+m.noReserve;
    const yes=total===0n?0.5:Number(m.noReserve*10000n/total)/10000;
    const yesLabel=String(meta.yesLabel||"YES");
    const noLabel=String(meta.noLabel||"NO");
    return{
      id:`maryjane:${address}`,source:"maryjane",sourceMarketId:address,
      title:meta.question||`Mary Jane market ${address.slice(0,8)}…`,description:meta.description,category:meta.category||"Other",
      outcomes:[
        {id:"yes",label:yesLabel,probability:yes,imageUrl:meta.yesImageUrl||undefined},
        {id:"no",label:noLabel,probability:1-yes,imageUrl:meta.noImageUrl||undefined},
      ],
      coverImageUrl:meta.coverImageUrl||undefined,metadataUrl:meta.metadataUrl||undefined,
      volume24h:0,volumeTotal:Number(m.volume)/1_000_000,traders:0,tradeCount:0,createdAt:meta.createdAt,
      closesAt:new Date(m.closeTs*1000).toISOString(),resolved:m.status.startsWith("RESOLVED")||m.status==="CANCELLED",
      nativeAddress:address,nativeMarketSeed:m.marketSeed,status:m.status,probabilitySource:"pool-reference",
    };
  });
  return{items:rows.filter(Boolean),errors};
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

function cleanTitle(value:any){
  return String(value||"")
    .replace(/\s+/g," ")
    .replace(/[\u0000-\u001F\u007F]/g,"")
    .trim();
}
function canonicalTitle(value:string){
  return cleanTitle(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g," ")
    .replace(/0x[a-f0-9]{40}/gi," ")
    .replace(/[^a-z0-9$%]+/g," ")
    .replace(/\b(the|a|an|will|would|is|are|be|by|on|in|at|to|of|for|before|after)\b/g," ")
    .replace(/\s+/g," ")
    .trim();
}
function titleTokens(value:string){
  return new Set(canonicalTitle(value).split(" ").filter(token=>token.length>1));
}
function similarity(a:string,b:string){
  const A=titleTokens(a),B=titleTokens(b);
  if(!A.size||!B.size)return 0;
  let intersection=0;
  for(const token of A)if(B.has(token))intersection++;
  return intersection/Math.max(A.size,B.size);
}
function looksLikeSpamTitle(title:string){
  const t=cleanTitle(title);
  const lower=t.toLowerCase();
  if(t.length<10||t.length>190)return true;
  if(/0x[a-f0-9]{40}/i.test(t))return true;
  if(/\b(?:test(?:ing)?|asdf|qwerty|hello world|sample market|demo market|ignore this|do not bet|fake market)\b/i.test(lower))return true;
  if(/https?:\/\//i.test(t))return true;
  if(/[!?]{5,}|[-_=]{8,}/.test(t))return true;
  const words=t.split(/\s+/).filter(Boolean);
  if(words.length<3)return true;
  const meaningful=words.filter(word=>/[a-zA-Z]{2,}/.test(word));
  if(meaningful.length<3)return true;
  return false;
}
function qualityScore(item:any){
  if(item.source==="maryjane")return 100;
  const title=cleanTitle(item.title);
  let score=58;
  const description=String(item.description||"").trim();
  const v24=Math.max(0,Number(item.volume24h||0));
  const total=Math.max(0,Number(item.volumeTotal||0));
  const traders=Math.max(0,Number(item.traders||0));

  if(title.length>=20&&title.length<=120)score+=10;
  else if(title.length>150)score-=10;

  if(description.length>=40)score+=8;
  else if(description.length===0)score-=4;

  if(v24>=10000)score+=16;
  else if(v24>=1000)score+=12;
  else if(v24>=100)score+=8;
  else if(v24>=10)score+=4;
  else if(total<=1)score-=10;

  if(total>=10000)score+=8;
  else if(total>=1000)score+=5;
  else if(total>=100)score+=2;

  if(traders>=25)score+=5;
  else if(traders>=5)score+=2;

  if(/[?]$/.test(title))score+=2;
  if(looksLikeSpamTitle(title))score-=50;

  return Math.max(0,Math.min(100,score));
}
function freshnessScore(createdAt:any){
  const time=new Date(createdAt||0).getTime();
  if(!Number.isFinite(time)||time<=0)return 0;
  const ageHours=Math.max(0,(Date.now()-time)/3_600_000);
  if(ageHours<=6)return 100;
  if(ageHours<=24)return 92;
  if(ageHours<=72)return 78;
  if(ageHours<=168)return 60;
  if(ageHours<=720)return 35;
  return 10;
}
function newRank(item:any){
  if(item.source==="maryjane")return 10_000+freshnessScore(item.createdAt);
  const quality=qualityScore(item);
  const fresh=freshnessScore(item.createdAt);
  const activity=Math.min(100,Math.log10(Math.max(1,Number(item.volume24h||item.volumeTotal||0))+1)*24);
  return quality*0.55+fresh*0.3+activity*0.15;
}
function dedupeAndRank(items:any[]){
  const accepted:any[]=[];
  const sorted=[...items]
    .filter(item=>item.source==="maryjane"||(!looksLikeSpamTitle(item.title)&&qualityScore(item)>=48))
    .map(item=>({...item,title:cleanTitle(item.title),qualityScore:qualityScore(item),newRank:newRank(item)}))
    .sort((a,b)=>{
      if(a.source==="maryjane"&&b.source!=="maryjane")return -1;
      if(b.source==="maryjane"&&a.source!=="maryjane")return 1;
      return (b.newRank||0)-(a.newRank||0);
    });

  for(const item of sorted){
    const exact=canonicalTitle(item.title);
    const duplicate=accepted.find(existing=>{
      if(canonicalTitle(existing.title)===exact)return true;
      return similarity(existing.title,item.title)>=0.9;
    });
    if(!duplicate)accepted.push(item);
  }
  return accepted;
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
        const title=cleanTitle(m.question);
        if(looksLikeSpamTitle(title))continue;
        items.push({
          id:`polymarket:${id}`,source:"polymarket",sourceMarketId:id,title,
          description:String(m.description||event.description||"")||undefined,
          coverImageUrl:String(m.image||event.image||event.icon||"")||undefined,
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
      const title=cleanTitle(m.question);
      if(looksLikeSpamTitle(title))continue;
      const id=String(m.id||m.slug||m.question);
      items.push({
        id:`manifold:${id}`,source:"manifold",sourceMarketId:id,title,
        description:String(m.textDescription||"")||undefined,
        coverImageUrl:String(m.coverImageUrl||m.imageUrl||m.thumbnailUrl||"")||undefined,
        category:category(String(m.question)),
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

  if(String(req.query?.miladyState||"")==="1"){
    res.setHeader("Cache-Control","no-store");
    if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
    try{
      const wallet=String(req.query?.wallet||"").trim()||undefined;
      return res.status(200).json(await miladyState(wallet));
    }catch(error:any){
      return res.status(500).json({error:error?.message||String(error),stage:"44-milady-state"});
    }
  }

  if(String(req.query?.pythSol||"")==="1"){
    res.setHeader("Cache-Control","no-store");
    if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});

    const apiKey=String(process.env.PYTH_API_KEY||"").trim();
    if(!apiKey){
      return res.status(503).json({
        error:"PYTH_API_KEY is not configured",
        configured:false,
      });
    }

    try{
      const feedId="0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
      const url=new URL("https://pyth.dourolabs.app/hermes/v2/updates/price/latest");
      url.searchParams.append("ids[]",feedId);
      url.searchParams.set("encoding","base64");
      url.searchParams.set("parsed","true");

      const response=await fetch(url,{
        headers:{
          authorization:`Bearer ${apiKey}`,
          accept:"application/json",
        },
        signal:AbortSignal.timeout(12000),
      });
      const text=await response.text();
      if(!response.ok){
        return res.status(502).json({
          error:`Pyth request failed (${response.status})`,
          detail:text.slice(0,240),
          configured:true,
        });
      }

      const body=JSON.parse(text);
      const parsed=body.parsed?.find((item:any)=>
        ("0x"+String(item.id||"").replace(/^0x/,"")).toLowerCase()===feedId
      )??body.parsed?.[0];

      if(!parsed?.price||!body?.binary?.data?.length){
        return res.status(502).json({
          error:"Pyth SOL/USD response is incomplete",
          configured:true,
        });
      }

      const price=Number(parsed.price.price)*10**Number(parsed.price.expo);
      return res.status(200).json({
        configured:true,
        feedId,
        price,
        updateData:body.binary.data,
        publishTime:Number(parsed.price.publish_time||0),
      });
    }catch(error:any){
      return res.status(502).json({
        error:error?.message||"Unable to fetch Pyth SOL/USD",
        configured:true,
      });
    }
  }

  res.setHeader("Cache-Control","s-maxage=5, stale-while-revalidate=15");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});

  try{
    const limit=Math.min(180,Math.max(1,Number(req.query?.limit||120)));
    const [native,external]=await Promise.all([nativeMarkets(limit),externalMarkets(limit)]);
    const raw=[...native.items,...external.items].filter(x=>!x.resolved);
    const ranked=dedupeAndRank(raw);
    const items=ranked.slice(0,limit);
    return res.status(200).json({
      items,
      errors:[...native.errors,...external.errors],
      sources:{
        maryjane:items.filter(x=>x.source==="maryjane").length,
        polymarket:items.filter(x=>x.source==="polymarket").length,
        manifold:items.filter(x=>x.source==="manifold").length,
      },
      qualityDiagnostics:{
        raw:raw.length,
        accepted:ranked.length,
        filtered:Math.max(0,raw.length-ranked.length),
      },
      nativeDiagnostics:{runtime:"pure-json-rpc",known:KNOWN.length,rpcHost:(()=>{try{return new URL(RPC_URL).host;}catch{return"invalid-rpc-url";}})(),metadataHosts:[...METADATA_HOSTS]},
      updatedAt:Date.now(),
    });
  }catch(e:any){
    return res.status(500).json({error:e?.message||String(e),stage:"discovery-handler"});
  }
}
