import { createHash } from "node:crypto";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

const PROGRAM_ID=new PublicKey("HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL");
const RPC_URL=process.env.SOLANA_RPC_URL||"https://api.devnet.solana.com";
const MARKET_DISC=createHash("sha256").update("account:Market").digest().subarray(0,8);
const RESOLUTION_CONFIG_DISC=createHash("sha256").update("account:ResolutionConfig").digest().subarray(0,8);
const RESOLUTION_STATE_DISC=createHash("sha256").update("account:ResolutionState").digest().subarray(0,8);
const STATUS=["OPEN","CLOSED","RESOLUTION_PENDING","DISPUTED","RESOLVED_YES","RESOLVED_NO","CANCELLED"];
const OUTCOME=["UNRESOLVED","YES","NO","INVALID"];

function disc(name:string){return createHash("sha256").update(`global:${name}`).digest().subarray(0,8);}
function hash(value:any){return createHash("sha256").update(String(value||"")).digest();}
function u64(value:bigint){const out=Buffer.alloc(8);out.writeBigUInt64LE(value);return out;}
function pk(raw:Buffer,o:number){return new PublicKey(raw.subarray(o,o+32));}
function decodeMarket(raw:Buffer){
  if(raw.length<420||!raw.subarray(0,8).equals(MARKET_DISC))throw new Error("Invalid Mary Jane market");
  return{
    authority:pk(raw,8),config:pk(raw,40),collateralMint:pk(raw,72),marketSeed:raw.subarray(104,136),
    closeTs:Number(raw.readBigInt64LE(200)),resolutionTs:Number(raw.readBigInt64LE(208)),
    status:STATUS[raw.readUInt8(216)]||"OPEN",collateralVault:pk(raw,219),yesMint:pk(raw,251),noMint:pk(raw,283),
  };
}
function decodeResolutionConfig(raw:Buffer){
  if(raw.length<73||!raw.subarray(0,8).equals(RESOLUTION_CONFIG_DISC))return null;
  return{authority:pk(raw,8).toBase58(),proposalBond:raw.readBigUInt64LE(40).toString(),disputeBond:raw.readBigUInt64LE(48).toString(),challengePeriodSecs:Number(raw.readBigInt64LE(56)),escalationPeriodSecs:Number(raw.readBigInt64LE(64))};
}
function decodeResolution(raw:Buffer){
  if(raw.length<339||!raw.subarray(0,8).equals(RESOLUTION_STATE_DISC))return null;
  return{
    proposer:pk(raw,40).toBase58(),challenger:pk(raw,72).toBase58(),
    proposedOutcome:OUTCOME[raw.readUInt8(104)]||"UNRESOLVED",finalOutcome:OUTCOME[raw.readUInt8(105)]||"UNRESOLVED",
    proposedAt:Number(raw.readBigInt64LE(266)),challengeDeadline:Number(raw.readBigInt64LE(274)),escalationDeadline:Number(raw.readBigInt64LE(282)),
    proposalBond:raw.readBigUInt64LE(290).toString(),disputeBond:raw.readBigUInt64LE(298).toString(),bondVault:pk(raw,306).toBase58(),
  };
}
async function tokenAmount(connection:Connection,account:PublicKey){
  const info=await connection.getAccountInfo(account,"confirmed");if(!info)return 0n;
  try{return BigInt((await connection.getTokenAccountBalance(account,"confirmed")).value.amount);}catch{return 0n;}
}
async function simulate(connection:Connection,tx:Transaction){
  const serialized=tx.serialize({requireAllSignatures:false,verifySignatures:false});
  const result:any=await (connection as any)._rpcRequest("simulateTransaction",[serialized.toString("base64"),{encoding:"base64",commitment:"confirmed",sigVerify:false,replaceRecentBlockhash:false}]);
  const value=result?.result?.value;
  if(value?.err){
    const logs=Array.isArray(value.logs)?value.logs:[];
    const useful=logs.filter((line:string)=>/error|failed|insufficient|custom program error|constraint/i.test(line)).slice(-7);
    throw new Error(useful.length?useful.join(" · "):`Simulation failed: ${JSON.stringify(value.err)}`);
  }
  return serialized;
}
function outcomeByte(value:any){
  const v=String(value||"").toUpperCase();
  if(v==="YES")return 1;if(v==="NO")return 2;if(v==="INVALID")return 3;
  throw new Error("Outcome must be YES, NO or INVALID");
}

export default async function handler(req:any,res:any){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  try{
    const marketAddress=new PublicKey(String(req.method==="GET"?req.query?.market:req.body?.market||""));
    const connection=new Connection(RPC_URL,"confirmed");
    const marketInfo=await connection.getAccountInfo(marketAddress,"confirmed");
    if(!marketInfo)throw new Error("Market not found on Devnet");
    const market=decodeMarket(Buffer.from(marketInfo.data));
    const [resolutionConfigAddress]=PublicKey.findProgramAddressSync([Buffer.from("resolution-config")],PROGRAM_ID);
    const [resolutionAddress]=PublicKey.findProgramAddressSync([Buffer.from("resolution"),marketAddress.toBuffer()],PROGRAM_ID);
    const [bondVault]=PublicKey.findProgramAddressSync([Buffer.from("resolution-bond"),marketAddress.toBuffer()],PROGRAM_ID);
    const [configInfo,resolutionInfo,mintInfo]=await Promise.all([
      connection.getAccountInfo(resolutionConfigAddress,"confirmed"),
      connection.getAccountInfo(resolutionAddress,"confirmed"),
      connection.getAccountInfo(market.collateralMint,"confirmed"),
    ]);
    const resolutionConfig=configInfo?decodeResolutionConfig(Buffer.from(configInfo.data)):null;
    const resolution=resolutionInfo?decodeResolution(Buffer.from(resolutionInfo.data)):null;

    if(req.method==="GET"){
      return res.status(200).json({
        market:{address:marketAddress.toBase58(),status:market.status,closeTs:market.closeTs,resolutionTs:market.resolutionTs,authority:market.authority.toBase58()},
        resolutionConfig:{address:resolutionConfigAddress.toBase58(),...resolutionConfig},
        resolution:resolution?{address:resolutionAddress.toBase58(),...resolution}:null,
        now:Math.floor(Date.now()/1000),
      });
    }
    if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
    if(!mintInfo)throw new Error("Collateral mint unavailable");
    if(!resolutionConfig)throw new Error("Resolution config is not initialized on Devnet");

    const body=typeof req.body==="string"?JSON.parse(req.body):req.body||{};
    const action=String(body.action||"").toUpperCase();
    const wallet=new PublicKey(String(body.wallet||""));
    const tokenProgram=mintInfo.owner;
    const userCollateral=getAssociatedTokenAddressSync(market.collateralMint,wallet,false,tokenProgram);
    const instructions:TransactionInstruction[]=[];
    let ix:TransactionInstruction;

    const ata=(payer:PublicKey,owner:PublicKey,mint:PublicKey)=>{
      const address=getAssociatedTokenAddressSync(mint,owner,false,tokenProgram);
      instructions.push(createAssociatedTokenAccountIdempotentInstruction(payer,address,owner,mint,tokenProgram));
      return address;
    };

    if(action==="CLOSE"){
      ix=new TransactionInstruction({programId:PROGRAM_ID,keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},{pubkey:market.config,isSigner:false,isWritable:false},{pubkey:marketAddress,isSigner:false,isWritable:true},
      ],data:disc("close_market")});
    }else if(action==="PROPOSE"){
      if(market.status!=="CLOSED")throw new Error("Market must be CLOSED before proposing a resolution");
      const proposerCollateral=ata(wallet,wallet,market.collateralMint);
      ix=new TransactionInstruction({programId:PROGRAM_ID,keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},{pubkey:market.config,isSigner:false,isWritable:false},{pubkey:resolutionConfigAddress,isSigner:false,isWritable:false},
        {pubkey:marketAddress,isSigner:false,isWritable:true},{pubkey:market.collateralMint,isSigner:false,isWritable:false},{pubkey:proposerCollateral,isSigner:false,isWritable:true},
        {pubkey:resolutionAddress,isSigner:false,isWritable:true},{pubkey:bondVault,isSigner:false,isWritable:true},{pubkey:tokenProgram,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      ],data:Buffer.concat([disc("propose_resolution"),Buffer.from([outcomeByte(body.outcome)]),hash(body.evidence),hash(body.source),hash(body.observation)])});
    }else if(action==="DISPUTE"){
      if(!resolution)throw new Error("No resolution proposal exists");
      const challengerCollateral=ata(wallet,wallet,market.collateralMint);
      ix=new TransactionInstruction({programId:PROGRAM_ID,keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},{pubkey:market.config,isSigner:false,isWritable:false},{pubkey:resolutionConfigAddress,isSigner:false,isWritable:false},
        {pubkey:marketAddress,isSigner:false,isWritable:true},{pubkey:resolutionAddress,isSigner:false,isWritable:true},{pubkey:market.collateralMint,isSigner:false,isWritable:false},
        {pubkey:challengerCollateral,isSigner:false,isWritable:true},{pubkey:new PublicKey(resolution.bondVault),isSigner:false,isWritable:true},{pubkey:tokenProgram,isSigner:false,isWritable:false},
      ],data:Buffer.concat([disc("dispute_resolution"),hash(body.evidence)])});
    }else if(action==="FINALIZE"){
      if(!resolution)throw new Error("No resolution proposal exists");
      const proposer=new PublicKey(resolution.proposer);const proposerCollateral=ata(wallet,proposer,market.collateralMint);
      ix=new TransactionInstruction({programId:PROGRAM_ID,keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},{pubkey:market.config,isSigner:false,isWritable:false},{pubkey:marketAddress,isSigner:false,isWritable:true},
        {pubkey:resolutionAddress,isSigner:false,isWritable:true},{pubkey:proposer,isSigner:false,isWritable:false},{pubkey:market.collateralMint,isSigner:false,isWritable:false},
        {pubkey:proposerCollateral,isSigner:false,isWritable:true},{pubkey:new PublicKey(resolution.bondVault),isSigner:false,isWritable:true},{pubkey:tokenProgram,isSigner:false,isWritable:false},
      ],data:disc("finalize_uncontested")});
    }else if(action==="RESOLVE_DISPUTE"){
      if(!resolution)throw new Error("No disputed resolution exists");
      if(wallet.toBase58()!==resolutionConfig.authority)throw new Error("Only the resolution authority can adjudicate a dispute");
      const proposer=new PublicKey(resolution.proposer),challenger=new PublicKey(resolution.challenger);
      const proposerCollateral=ata(wallet,proposer,market.collateralMint),challengerCollateral=ata(wallet,challenger,market.collateralMint);
      ix=new TransactionInstruction({programId:PROGRAM_ID,keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},{pubkey:resolutionConfigAddress,isSigner:false,isWritable:false},{pubkey:market.config,isSigner:false,isWritable:false},
        {pubkey:marketAddress,isSigner:false,isWritable:true},{pubkey:resolutionAddress,isSigner:false,isWritable:true},{pubkey:proposer,isSigner:false,isWritable:false},
        {pubkey:challenger,isSigner:false,isWritable:false},{pubkey:market.collateralMint,isSigner:false,isWritable:false},{pubkey:proposerCollateral,isSigner:false,isWritable:true},
        {pubkey:challengerCollateral,isSigner:false,isWritable:true},{pubkey:new PublicKey(resolution.bondVault),isSigner:false,isWritable:true},{pubkey:tokenProgram,isSigner:false,isWritable:false},
      ],data:Buffer.concat([disc("resolve_dispute"),Buffer.from([outcomeByte(body.outcome)]),hash(body.adjudication||body.evidence)])});
    }else if(action==="CANCEL_STALLED"){
      if(!resolution)throw new Error("No disputed resolution exists");
      const proposer=new PublicKey(resolution.proposer),challenger=new PublicKey(resolution.challenger);
      const proposerCollateral=ata(wallet,proposer,market.collateralMint),challengerCollateral=ata(wallet,challenger,market.collateralMint);
      ix=new TransactionInstruction({programId:PROGRAM_ID,keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},{pubkey:market.config,isSigner:false,isWritable:false},{pubkey:marketAddress,isSigner:false,isWritable:true},
        {pubkey:resolutionAddress,isSigner:false,isWritable:true},{pubkey:proposer,isSigner:false,isWritable:false},{pubkey:challenger,isSigner:false,isWritable:false},
        {pubkey:market.collateralMint,isSigner:false,isWritable:false},{pubkey:proposerCollateral,isSigner:false,isWritable:true},{pubkey:challengerCollateral,isSigner:false,isWritable:true},
        {pubkey:new PublicKey(resolution.bondVault),isSigner:false,isWritable:true},{pubkey:tokenProgram,isSigner:false,isWritable:false},
      ],data:disc("cancel_stalled_dispute")});
    }else if(action==="REDEEM"){
      const winningMint=market.status==="RESOLVED_YES"?market.yesMint:market.status==="RESOLVED_NO"?market.noMint:null;
      if(!winningMint)throw new Error("Market is not resolved to a winning outcome");
      const userWinning=ata(wallet,wallet,winningMint);const collateral=ata(wallet,wallet,market.collateralMint);
      const amount=body.amountBaseUnits?BigInt(String(body.amountBaseUnits)):await tokenAmount(connection,userWinning);
      if(amount<=0n)throw new Error("No winning shares to redeem");
      const [receipt]=PublicKey.findProgramAddressSync([Buffer.from("settlement"),marketAddress.toBuffer(),wallet.toBuffer()],PROGRAM_ID);
      ix=new TransactionInstruction({programId:PROGRAM_ID,keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},{pubkey:market.config,isSigner:false,isWritable:false},{pubkey:marketAddress,isSigner:false,isWritable:true},
        {pubkey:market.collateralMint,isSigner:false,isWritable:false},{pubkey:market.collateralVault,isSigner:false,isWritable:true},{pubkey:winningMint,isSigner:false,isWritable:true},
        {pubkey:userWinning,isSigner:false,isWritable:true},{pubkey:collateral,isSigner:false,isWritable:true},{pubkey:receipt,isSigner:false,isWritable:true},
        {pubkey:tokenProgram,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      ],data:Buffer.concat([disc("redeem_winnings"),u64(amount)])});
    }else if(action==="REFUND"){
      if(market.status!=="CANCELLED")throw new Error("Market is not cancelled/invalid");
      const userYes=ata(wallet,wallet,market.yesMint),userNo=ata(wallet,wallet,market.noMint),collateral=ata(wallet,wallet,market.collateralMint);
      const yes=body.yesAmountBaseUnits?BigInt(String(body.yesAmountBaseUnits)):await tokenAmount(connection,userYes);
      const no=body.noAmountBaseUnits?BigInt(String(body.noAmountBaseUnits)):await tokenAmount(connection,userNo);
      if(yes+no<=0n)throw new Error("No outcome shares available for refund");
      const [receipt]=PublicKey.findProgramAddressSync([Buffer.from("settlement"),marketAddress.toBuffer(),wallet.toBuffer()],PROGRAM_ID);
      ix=new TransactionInstruction({programId:PROGRAM_ID,keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},{pubkey:market.config,isSigner:false,isWritable:false},{pubkey:marketAddress,isSigner:false,isWritable:true},
        {pubkey:market.collateralMint,isSigner:false,isWritable:false},{pubkey:market.collateralVault,isSigner:false,isWritable:true},{pubkey:market.yesMint,isSigner:false,isWritable:true},
        {pubkey:market.noMint,isSigner:false,isWritable:true},{pubkey:userYes,isSigner:false,isWritable:true},{pubkey:userNo,isSigner:false,isWritable:true},
        {pubkey:collateral,isSigner:false,isWritable:true},{pubkey:receipt,isSigner:false,isWritable:true},{pubkey:tokenProgram,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      ],data:Buffer.concat([disc("refund_invalid"),u64(yes),u64(no)])});
    }else throw new Error("Unsupported market action");

    instructions.push(ix);
    const latest=await connection.getLatestBlockhash("confirmed");
    const tx=new Transaction({feePayer:wallet,recentBlockhash:latest.blockhash}).add(...instructions);
    const serialized=await simulate(connection,tx);
    return res.status(200).json({action,transactionBase64:serialized.toString("base64"),lastValidBlockHeight:latest.lastValidBlockHeight});
  }catch(error:any){
    return res.status(400).json({error:error?.message||String(error),stage:"market-action"});
  }
}
