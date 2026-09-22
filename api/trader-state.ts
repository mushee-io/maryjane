import { createHash } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

const PROGRAM_ID=new PublicKey("HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL");
const USDG_MINT="4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7";
const MEMO_PROGRAM_ID="MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const RPC_URL=process.env.SOLANA_RPC_URL||"https://api.devnet.solana.com";
const PORTFOLIO_HISTORY_LIMIT=Math.max(10,Math.min(60,Number(process.env.PORTFOLIO_HISTORY_LIMIT||30)));
const METADATA_HOSTS=new Set([
  "res.cloudinary.com",
  "maryjane-blue.vercel.app",
  ...String(process.env.MARY_JANE_METADATA_HOSTS||"").split(",").map(value=>value.trim().toLowerCase()).filter(Boolean),
]);
const MARKET_DISC=createHash("sha256").update("account:Market").digest().subarray(0,8);
const ORDER_DISC=createHash("sha256").update("account:LimitOrder").digest().subarray(0,8);
const RESOLUTION_DISC=createHash("sha256").update("account:ResolutionState").digest().subarray(0,8);

const EVENT={
  fill:createHash("sha256").update("event:LimitOrderFilled").digest().subarray(0,8),
  placed:createHash("sha256").update("event:LimitOrderPlaced").digest().subarray(0,8),
  cancelled:createHash("sha256").update("event:LimitOrderCancelled").digest().subarray(0,8),
  split:createHash("sha256").update("event:CompleteSetSplit").digest().subarray(0,8),
  merge:createHash("sha256").update("event:CompleteSetMerged").digest().subarray(0,8),
  redeemed:createHash("sha256").update("event:WinningsRedeemed").digest().subarray(0,8),
  refunded:createHash("sha256").update("event:InvalidMarketRefunded").digest().subarray(0,8),
};

const STATUS=["OPEN","CLOSED","RESOLUTION_PENDING","DISPUTED","RESOLVED_YES","RESOLVED_NO","CANCELLED"];

function pk(raw:Buffer,o:number){return new PublicKey(raw.subarray(o,o+32));}
function u64(raw:Buffer,o:number){return raw.readBigUInt64LE(o);}
function i64(raw:Buffer,o:number){return Number(raw.readBigInt64LE(o));}
function discEq(raw:Buffer,disc:Buffer){return raw.length>=8&&raw.subarray(0,8).equals(disc);}
function safeMetadataUrl(value:any){
  try{
    const url=new URL(String(value||""));
    if(url.protocol!=="https:"||!METADATA_HOSTS.has(url.hostname.toLowerCase()))return null;
    return url.toString();
  }catch{return null;}
}
function safeText(value:any,max:number){return String(value||"").replace(/[\u0000-\u001F\u007F]/g,"").trim().slice(0,max)||undefined;}
function safeNativeImage(value:any){const url=safeMetadataUrl(value);return url&&/\.(?:png|jpe?g|webp|gif|svg)(?:$|\?)/i.test(url)?url:undefined;}
async function mapLimit<T,R>(items:T[],limit:number,fn:(item:T,index:number)=>Promise<R>){
  const out=new Array<R>(items.length);let cursor=0;
  async function worker(){while(true){const index=cursor++;if(index>=items.length)return;out[index]=await fn(items[index],index);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return out;
}

function decodeMarket(address:string,raw:Buffer){
  if(raw.length<420||!discEq(raw,MARKET_DISC))return null;
  return{
    address,
    authority:pk(raw,8).toBase58(),
    config:pk(raw,40).toBase58(),
    collateralMint:pk(raw,72).toBase58(),
    marketSeed:raw.subarray(104,136).toString("hex"),
    questionHash:raw.subarray(136,168).toString("hex"),
    metadataHash:raw.subarray(168,200).toString("hex"),
    closeTs:i64(raw,200),
    resolutionTs:i64(raw,208),
    status:STATUS[raw.readUInt8(216)]||"OPEN",
    feeBps:raw.readUInt16LE(217),
    collateralVault:pk(raw,219).toBase58(),
    yesMint:pk(raw,251).toBase58(),
    noMint:pk(raw,283).toBase58(),
    yesReserve:u64(raw,379),
    noReserve:u64(raw,387),
    volume:u64(raw,403),
  };
}
function decodeOrder(address:string,raw:Buffer){
  if(raw.length!==198||!discEq(raw,ORDER_DISC))return null;
  const maker=pk(raw,8).toBase58();
  const market=pk(raw,40).toBase58();
  const side=raw.readUInt8(104)===0?"YES":"NO";
  const kind=raw.readUInt8(105)===0?"BUY":"SELL";
  return{
    order:address,maker,market,side,kind,
    priceBps:raw.readUInt16LE(106),
    originalShares:u64(raw,108).toString(),
    remainingShares:u64(raw,116).toString(),
    escrowMint:pk(raw,124).toBase58(),
    escrowVault:pk(raw,156).toBase58(),
    createdAt:i64(raw,188),
    status:raw.readUInt8(196)===0?"ACTIVE":"FILLED",
  };
}
function decodeResolution(raw:Buffer){
  if(raw.length<339||!discEq(raw,RESOLUTION_DISC))return null;
  const outcome=(n:number)=>["UNRESOLVED","YES","NO","INVALID"][n]||"UNRESOLVED";
  return{
    proposer:pk(raw,40).toBase58(),
    challenger:pk(raw,72).toBase58(),
    proposedOutcome:outcome(raw.readUInt8(104)),
    finalOutcome:outcome(raw.readUInt8(105)),
    proposedAt:i64(raw,266),
    challengeDeadline:i64(raw,274),
    escalationDeadline:i64(raw,282),
    proposalBond:u64(raw,290).toString(),
    disputeBond:u64(raw,298).toString(),
    bondVault:pk(raw,306).toBase58(),
  };
}

async function tokenBalance(connection:Connection,mint:PublicKey,owner:PublicKey,tokenProgram:PublicKey){
  const ata=getAssociatedTokenAddressSync(mint,owner,false,tokenProgram);
  const info=await connection.getAccountInfo(ata,"confirmed");
  if(!info)return{amount:"0",decimals:6,uiAmount:0,ata:ata.toBase58()};
  try{
    const balance=await connection.getTokenAccountBalance(ata,"confirmed");
    return{amount:balance.value.amount,decimals:balance.value.decimals,uiAmount:Number(balance.value.uiAmountString||"0"),ata:ata.toBase58()};
  }catch{return{amount:"0",decimals:6,uiAmount:0,ata:ata.toBase58()};}
}

function eventFromPayload(payload:Buffer,signature:string,blockTime:number){
  const p=(o:number)=>pk(payload,o).toBase58();
  if(discEq(payload,EVENT.fill)&&payload.length>=166){
    let o=8;
    const order=p(o);o+=32;const market=p(o);o+=32;const maker=p(o);o+=32;const taker=p(o);o+=32;
    const side=payload.readUInt8(o++)===0?"YES":"NO";const kind=payload.readUInt8(o++)===0?"BUY":"SELL";
    const priceBps=payload.readUInt16LE(o);o+=2;const shares=u64(payload,o);o+=8;const quoteAmount=u64(payload,o);o+=8;
    return{type:"FILL",signature,blockTime,order,market,maker,taker,side,kind,priceBps,shares:shares.toString(),quoteAmount:quoteAmount.toString()};
  }
  if(discEq(payload,EVENT.placed)&&payload.length>=124){
    let o=8;const order=p(o);o+=32;const market=p(o);o+=32;const maker=p(o);o+=32;
    const side=payload.readUInt8(o++)===0?"YES":"NO";const kind=payload.readUInt8(o++)===0?"BUY":"SELL";
    const priceBps=payload.readUInt16LE(o);o+=2;const shares=u64(payload,o);o+=8;const escrowAmount=u64(payload,o);
    return{type:"ORDER_PLACED",signature,blockTime,order,market,maker,side,kind,priceBps,shares:shares.toString(),quoteAmount:escrowAmount.toString()};
  }
  if(discEq(payload,EVENT.cancelled)&&payload.length>=120){
    let o=8;const order=p(o);o+=32;const market=p(o);o+=32;const maker=p(o);o+=32;
    const returnedAmount=u64(payload,o);o+=8;const unfilledShares=u64(payload,o);
    return{type:"ORDER_CANCELLED",signature,blockTime,order,market,maker,returnedAmount:returnedAmount.toString(),shares:unfilledShares.toString()};
  }
  if(discEq(payload,EVENT.split)&&payload.length>=80){
    return{type:"SPLIT",signature,blockTime,market:p(8),user:p(40),amount:u64(payload,72).toString()};
  }
  if(discEq(payload,EVENT.merge)&&payload.length>=80){
    return{type:"MERGE",signature,blockTime,market:p(8),user:p(40),amount:u64(payload,72).toString()};
  }
  if(discEq(payload,EVENT.redeemed)&&payload.length>=120){
    return{type:"REDEEM",signature,blockTime,market:p(8),user:p(40),winningMint:p(72),amount:u64(payload,104).toString(),collateralPaid:u64(payload,112).toString()};
  }
  if(discEq(payload,EVENT.refunded)&&payload.length>=96){
    return{type:"REFUND",signature,blockTime,market:p(8),user:p(40),yesAmount:u64(payload,72).toString(),noAmount:u64(payload,80).toString(),collateralPaid:u64(payload,88).toString()};
  }
  return null;
}

async function walletEvents(connection:Connection,wallet:PublicKey){
  let signatures:any[]=[];
  try{signatures=await connection.getSignaturesForAddress(wallet,{limit:PORTFOLIO_HISTORY_LIMIT},"confirmed");}
  catch{return[];}
  const events:any[]=[];
  for(let i=0;i<signatures.length;i+=20){
    const chunk=signatures.slice(i,i+20);
    let txs:any[]=[];
    try{
      txs=await connection.getTransactions(chunk.map(sig=>sig.signature),{commitment:"confirmed",maxSupportedTransactionVersion:0});
    }catch{
      txs=await Promise.all(chunk.map(sig=>connection.getTransaction(sig.signature,{commitment:"confirmed",maxSupportedTransactionVersion:0}).catch(()=>null)));
    }
    txs.forEach((tx,index)=>{
      for(const log of tx?.meta?.logMessages||[]){
        const marker="Program data: ";const pos=log.indexOf(marker);if(pos<0)continue;
        try{
          const event=eventFromPayload(Buffer.from(log.slice(pos+marker.length).trim(),"base64"),chunk[index].signature,tx?.blockTime||chunk[index].blockTime||0);
          if(event)events.push(event);
        }catch{}
      }
    });
  }
  const seen=new Set<string>();
  return events.filter(event=>{const key=`${event.signature}:${event.type}:${event.order||event.market}:${event.amount||event.shares||""}`;if(seen.has(key))return false;seen.add(key);return true;});
}

async function tokenBalances(connection:Connection,wallet:PublicKey){
  const map=new Map<string,{amount:bigint,decimals:number,uiAmount:number}>();
  for(const programId of [TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID]){
    try{
      const rows=await connection.getParsedTokenAccountsByOwner(wallet,{programId},"confirmed");
      for(const row of rows.value){
        const info:any=(row.account.data as any).parsed?.info;
        if(!info?.mint)continue;
        const token=info.tokenAmount||{};
        map.set(String(info.mint),{amount:BigInt(token.amount||"0"),decimals:Number(token.decimals||0),uiAmount:Number(token.uiAmountString||"0")});
      }
    }catch{}
  }
  return map;
}

async function marketMetadata(connection:Connection,market:string){
  try{
    const signatures=await connection.getSignaturesForAddress(new PublicKey(market),{limit:6},"confirmed");
    const txs=await connection.getParsedTransactions(signatures.map(sig=>sig.signature),{commitment:"confirmed",maxSupportedTransactionVersion:0}).catch(()=>[] as any[]);
    for(const tx of txs){
      for(const ix of tx?.transaction.message.instructions||[]){
        const anyIx:any=ix;
        if(String(anyIx.programId)!==MEMO_PROGRAM_ID||typeof anyIx.parsed!=="string")continue;
        try{
          const memo=JSON.parse(anyIx.parsed);
          if(memo?.t!=="maryjane-market"||memo?.m&&memo.m!==market)continue;
          let remote:any={};
          const metadataUrl=safeMetadataUrl(memo?.u);
          if(metadataUrl){
            const response=await fetch(metadataUrl,{signal:AbortSignal.timeout(5000),headers:{"user-agent":"MaryJane-Portfolio/1.0"}});
            if(response.ok){const candidate=await response.json();if(candidate?.t==="maryjane-market-metadata")remote=candidate;}
          }
          return{
            title:safeText(remote.question||memo.q,220)||`Mary Jane market ${market.slice(0,8)}…`,
            description:safeText(remote.description,2000),category:safeText(remote.category||memo.c,32)||"Other",
            yesLabel:safeText(remote.yesLabel,48)||"YES",noLabel:safeText(remote.noLabel,48)||"NO",
            yesImageUrl:safeNativeImage(remote.yesImageUrl),noImageUrl:safeNativeImage(remote.noImageUrl),coverImageUrl:safeNativeImage(remote.coverImageUrl),
          };
        }catch{}
      }
    }
  }catch{}
  return{title:`Mary Jane market ${market.slice(0,8)}…`,category:"Other",yesLabel:"YES",noLabel:"NO"};
}

async function latestPrice(connection:Connection,market:string,fallback:number){
  try{
    const signatures=await connection.getSignaturesForAddress(new PublicKey(market),{limit:18},"confirmed");
    let txs:any[]=[];
    try{txs=await connection.getTransactions(signatures.map(sig=>sig.signature),{commitment:"confirmed",maxSupportedTransactionVersion:0});}
    catch{txs=await Promise.all(signatures.map(sig=>connection.getTransaction(sig.signature,{commitment:"confirmed",maxSupportedTransactionVersion:0}).catch(()=>null)));}
    for(let i=0;i<txs.length;i++){
      const tx=txs[i];const sig=signatures[i];
      for(const log of tx?.meta?.logMessages||[]){
        const pos=log.indexOf("Program data: ");if(pos<0)continue;
        const ev=eventFromPayload(Buffer.from(log.slice(pos+14).trim(),"base64"),sig.signature,tx?.blockTime||sig.blockTime||0);
        if(ev?.type==="FILL"&&ev.market===market)return ev.side==="YES"?ev.priceBps:10000-ev.priceBps;
      }
    }
  }catch{}
  return fallback;
}

type LedgerSide={qty:bigint,cost:bigint,realized:bigint};
function sideState(){return{qty:0n,cost:0n,realized:0n} as LedgerSide;}
function buy(state:LedgerSide,qty:bigint,cost:bigint){state.qty+=qty;state.cost+=cost;}
function sell(state:LedgerSide,qty:bigint,proceeds:bigint){
  const actual=qty>state.qty?state.qty:qty;
  const removed=state.qty>0n?state.cost*actual/state.qty:0n;
  state.qty-=actual;state.cost-=removed;state.realized+=proceeds-removed;
}

async function portfolio(connection:Connection,wallet:PublicKey){
  const warnings:string[]=[];
  const [marketRows,orderRows,tokens,events,solLamports]=await Promise.all([
    connection.getProgramAccounts(PROGRAM_ID,{commitment:"confirmed",filters:[{dataSize:420}]}).catch((error:any)=>{warnings.push(`markets:${error?.message||error}`);return[];}),
    connection.getProgramAccounts(PROGRAM_ID,{commitment:"confirmed",filters:[{dataSize:198},{memcmp:{offset:8,bytes:wallet.toBase58()}}]}).catch((error:any)=>{warnings.push(`orders:${error?.message||error}`);return[];}),
    tokenBalances(connection,wallet).catch((error:any)=>{warnings.push(`tokens:${error?.message||error}`);return new Map();}),
    walletEvents(connection,wallet).catch((error:any)=>{warnings.push(`history:${error?.message||error}`);return[];}),
    connection.getBalance(wallet,"confirmed").catch((error:any)=>{warnings.push(`sol:${error?.message||error}`);return 0;}),
  ]);

  const markets=new Map<string,any>();
  for(const row of marketRows){
    const market=decodeMarket(row.pubkey.toBase58(),Buffer.from(row.account.data));
    if(market)markets.set(market.address,market);
  }
  const orders=orderRows.map(row=>decodeOrder(row.pubkey.toBase58(),Buffer.from(row.account.data))).filter(Boolean) as any[];
  const activeOrders=orders.filter(order=>order.status==="ACTIVE"&&BigInt(order.remainingShares)>0n);

  const ledgers=new Map<string,{yes:LedgerSide,no:LedgerSide}>();
  const ledger=(market:string)=>{if(!ledgers.has(market))ledgers.set(market,{yes:sideState(),no:sideState()});return ledgers.get(market)!;};
  const ordered=[...events].sort((a,b)=>a.blockTime-b.blockTime);

  for(const event of ordered){
    const market=markets.get(event.market);if(!market)continue;
    const l=ledger(event.market);
    if(event.type==="FILL"){
      const makerIs=event.maker===wallet.toBase58();const takerIs=event.taker===wallet.toBase58();if(!makerIs&&!takerIs)continue;
      const direction=makerIs?(event.kind==="BUY"?"BUY":"SELL"):(event.kind==="BUY"?"SELL":"BUY");
      const s=event.side==="YES"?l.yes:l.no;const qty=BigInt(event.shares);const quote=BigInt(event.quoteAmount);
      direction==="BUY"?buy(s,qty,quote):sell(s,qty,quote);
    }else if((event.type==="SPLIT"||event.type==="MERGE")&&event.user===wallet.toBase58()){
      const amount=BigInt(event.amount);const half=amount/2n;
      if(event.type==="SPLIT"){buy(l.yes,amount,half+(amount%2n));buy(l.no,amount,half);}
      else{sell(l.yes,amount,half+(amount%2n));sell(l.no,amount,half);}
    }else if(event.type==="REDEEM"&&event.user===wallet.toBase58()){
      const amount=BigInt(event.amount);const s=event.winningMint===market.yesMint?l.yes:l.no;sell(s,amount,BigInt(event.collateralPaid));
    }else if(event.type==="REFUND"&&event.user===wallet.toBase58()){
      const paid=BigInt(event.collateralPaid);const yes=BigInt(event.yesAmount);const no=BigInt(event.noAmount);const total=yes+no;
      const yesPaid=total?paid*yes/total:0n;sell(l.yes,yes,yesPaid);sell(l.no,no,paid-yesPaid);
    }
  }

  const relevant=[...markets.values()].filter(m=>{
    const y=tokens.get(m.yesMint)?.amount||0n;const n=tokens.get(m.noMint)?.amount||0n;
    return y>0n||n>0n||activeOrders.some(o=>o.market===m.address)||events.some(e=>e.market===m.address);
  }).slice(0,20);

  const results=await mapLimit(relevant,8,async market=>{
    const total=market.yesReserve+market.noReserve;
    const fallback=market.status==="RESOLVED_YES"?10000:market.status==="RESOLVED_NO"?0:market.status==="CANCELLED"?5000:total===0n?5000:Number(market.noReserve*10000n/total);
    const [yesPriceBps,meta]=await Promise.all([
      latestPrice(connection,market.address,fallback),
      marketMetadata(connection,market.address),
    ]);
    const y=tokens.get(market.yesMint)||{amount:0n,decimals:6,uiAmount:0};
    const n=tokens.get(market.noMint)||{amount:0n,decimals:6,uiAmount:0};
    const l=ledgers.get(market.address)||{yes:sideState(),no:sideState()};
    const yesAvg=l.yes.qty>0n?Number(l.yes.cost*10000n/l.yes.qty):0;
    const noAvg=l.no.qty>0n?Number(l.no.cost*10000n/l.no.qty):0;
    const knownYes=y.amount<l.yes.qty?y.amount:l.yes.qty;
    const knownNo=n.amount<l.no.qty?n.amount:l.no.qty;
    const unknownYes=y.amount-knownYes;
    const unknownNo=n.amount-knownNo;
    const yesKnownCost=yesAvg?knownYes*BigInt(yesAvg)/10000n:0n;
    const noKnownCost=noAvg?knownNo*BigInt(noAvg)/10000n:0n;
    const yesUnknownCost=unknownYes*BigInt(yesPriceBps)/10000n;
    const noUnknownCost=unknownNo*BigInt(10000-yesPriceBps)/10000n;
    const yesCost=yesKnownCost+yesUnknownCost;
    const noCost=noKnownCost+noUnknownCost;
    const currentValue=y.amount*BigInt(yesPriceBps)/10000n+n.amount*BigInt(10000-yesPriceBps)/10000n;
    const unrealized=currentValue-yesCost-noCost;
    const costBasisEstimated=y.amount!==l.yes.qty||n.amount!==l.no.qty;
    let resolution:any=null;
    try{
      const [pda]=PublicKey.findProgramAddressSync([Buffer.from("resolution"),new PublicKey(market.address).toBuffer()],PROGRAM_ID);
      const info=await connection.getAccountInfo(pda,"confirmed");if(info)resolution={address:pda.toBase58(),...decodeResolution(Buffer.from(info.data))};
    }catch{}
    const winningBalance=market.status==="RESOLVED_YES"?y.amount:market.status==="RESOLVED_NO"?n.amount:0n;
    const invalidRefund=market.status==="CANCELLED"?(y.amount+n.amount)/2n:0n;
    return{
      ...market,...meta,
      yesBalance:y.amount.toString(),noBalance:n.amount.toString(),
      yesUi:y.uiAmount,noUi:n.uiAmount,yesPriceBps,noPriceBps:10000-yesPriceBps,
      yesAvgEntryBps:yesAvg,noAvgEntryBps:noAvg,
      costBasisBaseUnits:(yesCost+noCost).toString(),
      currentValueBaseUnits:currentValue.toString(),
      unrealizedPnlBaseUnits:unrealized.toString(),
      realizedPnlBaseUnits:(l.yes.realized+l.no.realized).toString(),
      claimableBaseUnits:(winningBalance+invalidRefund).toString(),
      costBasisEstimated,
      resolution,
    };
  });

  let positionValue=0n,unrealized=0n,realized=0n,claimable=0n;
  for(const p of results){positionValue+=BigInt(p.currentValueBaseUnits);unrealized+=BigInt(p.unrealizedPnlBaseUnits);realized+=BigInt(p.realizedPnlBaseUnits);claimable+=BigInt(p.claimableBaseUnits);}
  const usdg=tokens.get(USDG_MINT)||{amount:0n,decimals:6,uiAmount:0};

  return{
    wallet:wallet.toBase58(),
    sol:{lamports:solLamports,uiAmount:solLamports/1e9},
    summary:{
      usdgBaseUnits:usdg.amount.toString(),usdg:usdg.uiAmount,
      positionValueBaseUnits:positionValue.toString(),
      unrealizedPnlBaseUnits:unrealized.toString(),
      realizedPnlBaseUnits:realized.toString(),
      claimableBaseUnits:claimable.toString(),
      openOrders:activeOrders.length,markets:results.length,
    },
    positions:results.sort((a,b)=>Number(BigInt(b.currentValueBaseUnits)-BigInt(a.currentValueBaseUnits))),
    openOrders:activeOrders.map(order=>{
      const reserved=order.kind==="BUY"?BigInt(order.remainingShares)*BigInt(order.priceBps)/10000n:BigInt(order.remainingShares);
      return{...order,reservedBaseUnits:reserved.toString()};
    }).sort((a,b)=>b.createdAt-a.createdAt),
    history:[...events].filter(e=>e.maker===wallet.toBase58()||e.taker===wallet.toBase58()||e.user===wallet.toBase58()).sort((a,b)=>b.blockTime-a.blockTime).slice(0,100),
    diagnostics:{historyLimit:PORTFOLIO_HISTORY_LIMIT,metadataHosts:[...METADATA_HOSTS],warnings},
    updatedAt:Date.now(),
  };
}

export default async function handler(req:any,res:any){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  try{
    const wallet=new PublicKey(String(req.query?.wallet||""));
    const connection=new Connection(RPC_URL,"confirmed");
    const marketValue=String(req.query?.market||"").trim();
    if(!marketValue)return res.status(200).json(await portfolio(connection,wallet));

    const marketAddress=new PublicKey(marketValue);
    const info=await connection.getAccountInfo(marketAddress,"confirmed");
    if(!info)throw new Error("Market not found on Devnet");
    const market=decodeMarket(marketAddress.toBase58(),Buffer.from(info.data));
    if(!market)throw new Error("Invalid Mary Jane market account");
    const collateralInfo=await connection.getAccountInfo(new PublicKey(market.collateralMint),"confirmed");
    const yesInfo=await connection.getAccountInfo(new PublicKey(market.yesMint),"confirmed");
    const noInfo=await connection.getAccountInfo(new PublicKey(market.noMint),"confirmed");
    if(!collateralInfo||!yesInfo||!noInfo)throw new Error("Market token mint unavailable");

    const [usd,yes,no,solLamports]=await Promise.all([
      tokenBalance(connection,new PublicKey(market.collateralMint),wallet,collateralInfo.owner),
      tokenBalance(connection,new PublicKey(market.yesMint),wallet,yesInfo.owner),
      tokenBalance(connection,new PublicKey(market.noMint),wallet,noInfo.owner),
      connection.getBalance(wallet,"confirmed"),
    ]);

    let resolution:any=null;
    try{
      const [pda]=PublicKey.findProgramAddressSync([Buffer.from("resolution"),marketAddress.toBuffer()],PROGRAM_ID);
      const r=await connection.getAccountInfo(pda,"confirmed");if(r)resolution={address:pda.toBase58(),...decodeResolution(Buffer.from(r.data))};
    }catch{}

    return res.status(200).json({
      wallet:wallet.toBase58(),market:marketAddress.toBase58(),marketState:market,
      collateral:{symbol:"USDG",mint:market.collateralMint,...usd},
      yes:{symbol:"YES",mint:market.yesMint,...yes},
      no:{symbol:"NO",mint:market.noMint,...no},
      sol:{lamports:solLamports,uiAmount:solLamports/1e9},
      resolution,updatedAt:Date.now(),
    });
  }catch(error:any){
    return res.status(400).json({error:error?.message||String(error),stage:"trader-state"});
  }
}
