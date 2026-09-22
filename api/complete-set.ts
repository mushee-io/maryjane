import { createHash } from "node:crypto";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

const PROGRAM_ID=new PublicKey("HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL");
const RPC_URL=process.env.SOLANA_RPC_URL||"https://api.devnet.solana.com";
const MARKET_DISC=createHash("sha256").update("account:Market").digest().subarray(0,8);

function disc(name:string){
  return createHash("sha256").update(`global:${name}`).digest().subarray(0,8);
}
function u64(value:bigint){
  if(value<=0n||value>0xffff_ffff_ffff_ffffn)throw new Error("Amount must be positive");
  const out=Buffer.alloc(8);out.writeBigUInt64LE(value);return out;
}
function decodeMarket(raw:Buffer){
  if(raw.length<420||!raw.subarray(0,8).equals(MARKET_DISC))throw new Error("Invalid Mary Jane market account");
  let o=8;
  o+=32;
  const config=new PublicKey(raw.subarray(o,o+32));o+=32;
  const collateralMint=new PublicKey(raw.subarray(o,o+32));o+=32;
  o+=32+32+32+8+8+1+2;
  const collateralVault=new PublicKey(raw.subarray(o,o+32));o+=32;
  const yesMint=new PublicKey(raw.subarray(o,o+32));o+=32;
  const noMint=new PublicKey(raw.subarray(o,o+32));
  return{config,collateralMint,collateralVault,yesMint,noMint};
}
async function balance(connection:Connection,account:PublicKey){
  const info=await connection.getAccountInfo(account,"confirmed");
  if(!info)return 0n;
  const token=await connection.getTokenAccountBalance(account,"confirmed");
  return BigInt(token.value.amount);
}
async function simulate(connection:Connection,tx:Transaction){
  const serialized=tx.serialize({requireAllSignatures:false,verifySignatures:false});
  const simulation:any=await (connection as any)._rpcRequest("simulateTransaction",[
    serialized.toString("base64"),
    {encoding:"base64",commitment:"confirmed",sigVerify:false,replaceRecentBlockhash:false}
  ]);
  const value=simulation?.result?.value;
  if(value?.err){
    const logs=Array.isArray(value.logs)?value.logs:[];
    const useful=logs.filter((line:string)=>/error|failed|insufficient|rent|funds|custom program error/i.test(line)).slice(-6);
    const raw=JSON.stringify(value.err);
    throw new Error(useful.length?`Transaction simulation failed. ${useful.join(" · ")}`:`Transaction simulation failed. ${raw}`);
  }
  return serialized;
}

export default async function handler(req:any,res:any){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  try{
    const wallet=new PublicKey(String(req.body?.wallet||""));
    const marketAddress=new PublicKey(String(req.body?.market||""));
    const action=String(req.body?.action||"SPLIT").toUpperCase();
    const amount=BigInt(String(req.body?.amountBaseUnits||"0"));
    if(!["SPLIT","MERGE"].includes(action))throw new Error("action must be SPLIT or MERGE");
    if(amount<=0n)throw new Error("Amount must be positive");

    const connection=new Connection(RPC_URL,"confirmed");
    const marketInfo=await connection.getAccountInfo(marketAddress,"confirmed");
    if(!marketInfo)throw new Error("Market not found on Devnet");
    const market=decodeMarket(Buffer.from(marketInfo.data));

    const [collateralInfo,yesInfo,noInfo]=await Promise.all([
      connection.getAccountInfo(market.collateralMint,"confirmed"),
      connection.getAccountInfo(market.yesMint,"confirmed"),
      connection.getAccountInfo(market.noMint,"confirmed"),
    ]);
    if(!collateralInfo||!yesInfo||!noInfo)throw new Error("Market token mint unavailable");
    const tokenProgram=collateralInfo.owner;
    if(!yesInfo.owner.equals(tokenProgram)||!noInfo.owner.equals(tokenProgram))throw new Error("Market token program mismatch");

    const userCollateral=getAssociatedTokenAddressSync(market.collateralMint,wallet,false,tokenProgram);
    const userYes=getAssociatedTokenAddressSync(market.yesMint,wallet,false,tokenProgram);
    const userNo=getAssociatedTokenAddressSync(market.noMint,wallet,false,tokenProgram);

    if(action==="SPLIT"){
      const available=await balance(connection,userCollateral);
      if(available<amount){
        return res.status(400).json({
          error:"Insufficient Devnet USDG to create outcome shares.",
          code:"INSUFFICIENT_COLLATERAL",
          availableBaseUnits:available.toString(),
          requiredBaseUnits:amount.toString(),
          stage:"complete-set-balance",
        });
      }
    }else{
      const [yesBalance,noBalance]=await Promise.all([balance(connection,userYes),balance(connection,userNo)]);
      if(yesBalance<amount||noBalance<amount){
        return res.status(400).json({
          error:"Merge requires the same amount of YES and NO shares.",
          code:"INSUFFICIENT_COMPLETE_SET",
          yesBaseUnits:yesBalance.toString(),
          noBaseUnits:noBalance.toString(),
          requiredBaseUnits:amount.toString(),
          stage:"complete-set-balance",
        });
      }
    }

    const ix=new TransactionInstruction({
      programId:PROGRAM_ID,
      keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},
        {pubkey:market.config,isSigner:false,isWritable:false},
        {pubkey:marketAddress,isSigner:false,isWritable:true},
        {pubkey:market.collateralMint,isSigner:false,isWritable:false},
        {pubkey:userCollateral,isSigner:false,isWritable:true},
        {pubkey:market.collateralVault,isSigner:false,isWritable:true},
        {pubkey:market.yesMint,isSigner:false,isWritable:true},
        {pubkey:market.noMint,isSigner:false,isWritable:true},
        {pubkey:userYes,isSigner:false,isWritable:true},
        {pubkey:userNo,isSigner:false,isWritable:true},
        {pubkey:tokenProgram,isSigner:false,isWritable:false},
      ],
      data:Buffer.concat([disc(action==="SPLIT"?"split_complete_set":"merge_complete_set"),u64(amount)]),
    });

    const latest=await connection.getLatestBlockhash("confirmed");
    const tx=new Transaction({feePayer:wallet,recentBlockhash:latest.blockhash})
      .add(createAssociatedTokenAccountIdempotentInstruction(wallet,userCollateral,wallet,market.collateralMint,tokenProgram))
      .add(createAssociatedTokenAccountIdempotentInstruction(wallet,userYes,wallet,market.yesMint,tokenProgram))
      .add(createAssociatedTokenAccountIdempotentInstruction(wallet,userNo,wallet,market.noMint,tokenProgram))
      .add(ix);

    const serialized=await simulate(connection,tx);
    return res.status(200).json({
      transactionBase64:serialized.toString("base64"),
      lastValidBlockHeight:latest.lastValidBlockHeight,
      action,
      amountBaseUnits:amount.toString(),
      userCollateral:userCollateral.toBase58(),
      userYes:userYes.toBase58(),
      userNo:userNo.toBase58(),
    });
  }catch(error:any){
    return res.status(400).json({error:error?.message||String(error),stage:"complete-set"});
  }
}
