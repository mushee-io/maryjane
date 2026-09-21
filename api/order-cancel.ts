import { createHash } from "node:crypto";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

const PROGRAM_ID=new PublicKey("HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL");
const RPC_URL=process.env.SOLANA_RPC_URL||"https://api.devnet.solana.com";
const ORDER_DISC=createHash("sha256").update("account:LimitOrder").digest().subarray(0,8);
function disc(name:string){return createHash("sha256").update(`global:${name}`).digest().subarray(0,8);}

function decodeOrder(raw:Buffer){
  if(raw.length!==198||!raw.subarray(0,8).equals(ORDER_DISC))throw new Error("Invalid order account");
  let o=8;
  const maker=new PublicKey(raw.subarray(o,o+32));o+=32;
  o+=32+32+1+1+2+8+8;
  const escrowMint=new PublicKey(raw.subarray(o,o+32));o+=32;
  const escrowVault=new PublicKey(raw.subarray(o,o+32));
  return{maker,escrowMint,escrowVault};
}

export default async function handler(req:any,res:any){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  try{
    const wallet=new PublicKey(String(req.body?.wallet||""));
    const orderKey=new PublicKey(String(req.body?.order||""));
    const connection=new Connection(RPC_URL,"confirmed");
    const info=await connection.getAccountInfo(orderKey,"confirmed");
    if(!info)throw new Error("Order not found or already closed");
    const order=decodeOrder(Buffer.from(info.data));
    if(!order.maker.equals(wallet))throw new Error("Only the order maker can cancel this order");
    const mintInfo=await connection.getAccountInfo(order.escrowMint,"confirmed");
    if(!mintInfo)throw new Error("Escrow mint unavailable");
    const tokenProgram=mintInfo.owner;
    const destination=getAssociatedTokenAddressSync(order.escrowMint,wallet,false,tokenProgram);
    const ix=new TransactionInstruction({
      programId:PROGRAM_ID,
      keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},
        {pubkey:orderKey,isSigner:false,isWritable:true},
        {pubkey:order.escrowMint,isSigner:false,isWritable:false},
        {pubkey:order.escrowVault,isSigner:false,isWritable:true},
        {pubkey:destination,isSigner:false,isWritable:true},
        {pubkey:tokenProgram,isSigner:false,isWritable:false},
      ],
      data:disc("cancel_order"),
    });
    const latest=await connection.getLatestBlockhash("confirmed");
    const tx=new Transaction({feePayer:wallet,recentBlockhash:latest.blockhash})
      .add(createAssociatedTokenAccountIdempotentInstruction(wallet,destination,wallet,order.escrowMint,tokenProgram))
      .add(ix);
    return res.status(200).json({
      transactionBase64:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString("base64"),
      lastValidBlockHeight:latest.lastValidBlockHeight,
    });
  }catch(error:any){
    return res.status(400).json({error:error?.message||String(error),stage:"cancel-order"});
  }
}
