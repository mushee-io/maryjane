import { createHash, randomBytes } from "node:crypto";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

const PROGRAM_ID=new PublicKey("HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL");
const RPC_URL=process.env.SOLANA_RPC_URL||"https://api.devnet.solana.com";
const MARKET_DISC=createHash("sha256").update("account:Market").digest().subarray(0,8);
function disc(name:string){return createHash("sha256").update(`global:${name}`).digest().subarray(0,8);}
function u16(v:number){const b=Buffer.alloc(2);b.writeUInt16LE(v);return b;}
function u64(v:bigint){const b=Buffer.alloc(8);b.writeBigUInt64LE(v);return b;}
function marketAddresses(seed:Buffer){
  const config=PublicKey.findProgramAddressSync([Buffer.from("config")],PROGRAM_ID)[0];
  const market=PublicKey.findProgramAddressSync([Buffer.from("market"),config.toBuffer(),seed],PROGRAM_ID)[0];
  return{config,market};
}
function decodeMarket(raw:Buffer){
  if(raw.length<420||!raw.subarray(0,8).equals(MARKET_DISC))throw new Error("Invalid Mary Jane market account");
  let o=8+32+32;
  const collateralMint=new PublicKey(raw.subarray(o,o+32));o+=32;
  const marketSeed=Buffer.from(raw.subarray(o,o+32));o+=32+32+32+8+8+1+2;
  const collateralVault=new PublicKey(raw.subarray(o,o+32));o+=32;
  const yesMint=new PublicKey(raw.subarray(o,o+32));o+=32;
  const noMint=new PublicKey(raw.subarray(o,o+32));
  return{collateralMint,marketSeed,collateralVault,yesMint,noMint};
}

const ORDER_DISC=createHash("sha256").update("account:LimitOrder").digest().subarray(0,8);
function decodeOrder(raw:Buffer){
  if(raw.length!==198||!raw.subarray(0,8).equals(ORDER_DISC))throw new Error("Invalid order account");
  let o=8; const maker=new PublicKey(raw.subarray(o,o+32));o+=32;const market=new PublicKey(raw.subarray(o,o+32));o+=32;o+=32;
  const side=raw.readUInt8(o++)===0?"YES":"NO"; const kind=raw.readUInt8(o++)===0?"BUY":"SELL"; const priceBps=raw.readUInt16LE(o);o+=2;
  o+=8; const remainingShares=raw.readBigUInt64LE(o);o+=8; const escrowMint=new PublicKey(raw.subarray(o,o+32));o+=32; const escrowVault=new PublicKey(raw.subarray(o,o+32));
  return{maker,market,side,kind,priceBps,remainingShares,escrowMint,escrowVault};
}
export default async function handler(req:any,res:any){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  try{
    const taker=new PublicKey(String(req.body?.wallet||""));
    const orderKey=new PublicKey(String(req.body?.order||""));
    const shares=BigInt(String(req.body?.sharesBaseUnits||"0")); if(shares<=0n)throw new Error("Shares must be positive");
    const connection=new Connection(RPC_URL,"confirmed");
    const orderInfo=await connection.getAccountInfo(orderKey,"confirmed"); if(!orderInfo)throw new Error("Order not found");
    const order=decodeOrder(Buffer.from(orderInfo.data)); if(shares>order.remainingShares)throw new Error("Cannot fill more than remaining shares");
    const marketInfo=await connection.getAccountInfo(order.market,"confirmed"); if(!marketInfo)throw new Error("Market not found");
    const market=decodeMarket(Buffer.from(marketInfo.data));
    const mintInfo=await connection.getAccountInfo(market.collateralMint,"confirmed"); if(!mintInfo)throw new Error("Collateral mint unavailable");
    const tokenProgram=mintInfo.owner;
    const outcomeMint=order.side==="YES"?market.yesMint:market.noMint;
    const takerCollateral=getAssociatedTokenAddressSync(market.collateralMint,taker,false,tokenProgram);
    const takerOutcome=getAssociatedTokenAddressSync(outcomeMint,taker,false,tokenProgram);
    const makerCollateral=getAssociatedTokenAddressSync(market.collateralMint,order.maker,false,tokenProgram);
    const makerOutcome=getAssociatedTokenAddressSync(outcomeMint,order.maker,false,tokenProgram);

    const config=marketAddresses(market.marketSeed).config;
    const ix=new TransactionInstruction({
      programId:PROGRAM_ID,
      keys:[
        {pubkey:taker,isSigner:true,isWritable:true},{pubkey:config,isSigner:false,isWritable:false},{pubkey:order.market,isSigner:false,isWritable:true},
        {pubkey:orderKey,isSigner:false,isWritable:true},{pubkey:order.maker,isSigner:false,isWritable:false},{pubkey:market.collateralMint,isSigner:false,isWritable:false},
        {pubkey:outcomeMint,isSigner:false,isWritable:false},{pubkey:order.escrowMint,isSigner:false,isWritable:false},{pubkey:order.escrowVault,isSigner:false,isWritable:true},
        {pubkey:takerCollateral,isSigner:false,isWritable:true},{pubkey:takerOutcome,isSigner:false,isWritable:true},{pubkey:makerCollateral,isSigner:false,isWritable:true},
        {pubkey:makerOutcome,isSigner:false,isWritable:true},{pubkey:tokenProgram,isSigner:false,isWritable:false},
      ],
      data:Buffer.concat([disc("fill_limit_order"),u64(shares)]),
    });
    const latest=await connection.getLatestBlockhash("confirmed");
    const tx=new Transaction({feePayer:taker,recentBlockhash:latest.blockhash})
      .add(createAssociatedTokenAccountIdempotentInstruction(taker,takerCollateral,taker,market.collateralMint,tokenProgram))
      .add(createAssociatedTokenAccountIdempotentInstruction(taker,takerOutcome,taker,outcomeMint,tokenProgram))
      .add(createAssociatedTokenAccountIdempotentInstruction(taker,makerCollateral,order.maker,market.collateralMint,tokenProgram))
      .add(createAssociatedTokenAccountIdempotentInstruction(taker,makerOutcome,order.maker,outcomeMint,tokenProgram))
      .add(ix);
    return res.status(200).json({transactionBase64:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString("base64"),lastValidBlockHeight:latest.lastValidBlockHeight});
  }catch(e:any){return res.status(400).json({error:e?.message||String(e),stage:"fill-order"});}
}
