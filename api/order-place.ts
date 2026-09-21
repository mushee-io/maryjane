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

export default async function handler(req:any,res:any){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  try{
    const wallet=new PublicKey(String(req.body?.wallet||""));
    const marketAddress=new PublicKey(String(req.body?.market||""));
    const side=String(req.body?.side||"").toUpperCase();
    const kind=String(req.body?.kind||"").toUpperCase();
    const priceBps=Number(req.body?.priceBps||0);
    const shares=BigInt(String(req.body?.sharesBaseUnits||"0"));
    if(!["YES","NO"].includes(side)||!["BUY","SELL"].includes(kind))throw new Error("Invalid side or order kind");
    if(!Number.isInteger(priceBps)||priceBps<1||priceBps>9999)throw new Error("Price must be between 0.01¢ and 99.99¢");
    if(shares<=0n)throw new Error("Shares must be positive");

    const connection=new Connection(RPC_URL,"confirmed");
    const info=await connection.getAccountInfo(marketAddress,"confirmed"); if(!info)throw new Error("Market not found on Devnet");
    const market=decodeMarket(Buffer.from(info.data));
    const mintInfo=await connection.getAccountInfo(market.collateralMint,"confirmed"); if(!mintInfo)throw new Error("Collateral mint unavailable");
    const tokenProgram=mintInfo.owner;
    const orderSeed=randomBytes(32);
    const [order]=PublicKey.findProgramAddressSync([Buffer.from("order"),marketAddress.toBuffer(),wallet.toBuffer(),orderSeed],PROGRAM_ID);
    const [escrowVault]=PublicKey.findProgramAddressSync([Buffer.from("order-vault"),order.toBuffer()],PROGRAM_ID);
    const escrowMint=kind==="BUY"?market.collateralMint:(side==="YES"?market.yesMint:market.noMint);
    const makerSource=getAssociatedTokenAddressSync(escrowMint,wallet,false,tokenProgram);

    const requiredAmount=kind==="BUY"
      ? (shares*BigInt(priceBps))/10_000n
      : shares;
    let availableAmount=0n;
    let decimals=6;
    const sourceInfo=await connection.getAccountInfo(makerSource,"confirmed");
    if(sourceInfo){
      try{
        const balance=await connection.getTokenAccountBalance(makerSource,"confirmed");
        availableAmount=BigInt(balance.value.amount);
        decimals=balance.value.decimals;
      }catch{}
    }
    if(availableAmount<requiredAmount){
      const scale=10**decimals;
      const available=(Number(availableAmount)/scale).toFixed(Math.min(decimals,6));
      const required=(Number(requiredAmount)/scale).toFixed(Math.min(decimals,6));
      const asset=kind==="BUY"?"Devnet USDG":`${side} shares`;
      return res.status(400).json({
        error:`Insufficient ${asset}. Need ${required}, wallet has ${available}.`,
        code:"INSUFFICIENT_BALANCE",
        asset,
        requiredBaseUnits:requiredAmount.toString(),
        availableBaseUnits:availableAmount.toString(),
        decimals,
        mint:escrowMint.toBase58(),
        tokenAccount:makerSource.toBase58(),
        stage:"order-balance",
      });
    }

    const ix=new TransactionInstruction({
      programId:PROGRAM_ID,
      keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},
        {pubkey:marketAddresses(market.marketSeed).config,isSigner:false,isWritable:false},
        {pubkey:marketAddress,isSigner:false,isWritable:false},
        {pubkey:market.collateralMint,isSigner:false,isWritable:false},
        {pubkey:market.yesMint,isSigner:false,isWritable:false},
        {pubkey:market.noMint,isSigner:false,isWritable:false},
        {pubkey:escrowMint,isSigner:false,isWritable:false},
        {pubkey:makerSource,isSigner:false,isWritable:true},
        {pubkey:order,isSigner:false,isWritable:true},
        {pubkey:escrowVault,isSigner:false,isWritable:true},
        {pubkey:tokenProgram,isSigner:false,isWritable:false},
        {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      ],
      data:Buffer.concat([disc("place_order"),orderSeed,Buffer.from([side==="YES"?0:1]),Buffer.from([kind==="BUY"?0:1]),u16(priceBps),u64(shares)]),
    });

    const latest=await connection.getLatestBlockhash("confirmed");
    const tx=new Transaction({feePayer:wallet,recentBlockhash:latest.blockhash})
      .add(createAssociatedTokenAccountIdempotentInstruction(wallet,makerSource,wallet,escrowMint,tokenProgram))
      .add(ix);
    return res.status(200).json({transactionBase64:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString("base64"),lastValidBlockHeight:latest.lastValidBlockHeight,order:order.toBase58()});
  }catch(e:any){return res.status(400).json({error:e?.message||String(e),stage:"place-order"});}
}
