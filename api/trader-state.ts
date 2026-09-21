import { createHash } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const RPC_URL=process.env.SOLANA_RPC_URL||"https://api.devnet.solana.com";
const MARKET_DISC=createHash("sha256").update("account:Market").digest().subarray(0,8);

function decodeMarket(raw:Buffer){
  if(raw.length<420||!raw.subarray(0,8).equals(MARKET_DISC))throw new Error("Invalid Mary Jane market account");
  let o=8+32+32;
  const collateralMint=new PublicKey(raw.subarray(o,o+32));o+=32+32+32+32+8+8+1+2+32;
  const yesMint=new PublicKey(raw.subarray(o,o+32));o+=32;
  const noMint=new PublicKey(raw.subarray(o,o+32));
  return{collateralMint,yesMint,noMint};
}

async function tokenBalance(connection:Connection,mint:PublicKey,owner:PublicKey,tokenProgram:PublicKey){
  const ata=getAssociatedTokenAddressSync(mint,owner,false,tokenProgram);
  const info=await connection.getAccountInfo(ata,"confirmed");
  if(!info)return{amount:"0",decimals:6,uiAmount:0,ata:ata.toBase58()};
  try{
    const balance=await connection.getTokenAccountBalance(ata,"confirmed");
    return{
      amount:balance.value.amount,
      decimals:balance.value.decimals,
      uiAmount:Number(balance.value.uiAmountString||"0"),
      ata:ata.toBase58(),
    };
  }catch{
    return{amount:"0",decimals:6,uiAmount:0,ata:ata.toBase58()};
  }
}

export default async function handler(req:any,res:any){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  try{
    const marketAddress=new PublicKey(String(req.query?.market||""));
    const wallet=new PublicKey(String(req.query?.wallet||""));
    const connection=new Connection(RPC_URL,"confirmed");
    const info=await connection.getAccountInfo(marketAddress,"confirmed");
    if(!info)throw new Error("Market not found on Devnet");
    const market=decodeMarket(Buffer.from(info.data));
    const collateralInfo=await connection.getAccountInfo(market.collateralMint,"confirmed");
    const yesInfo=await connection.getAccountInfo(market.yesMint,"confirmed");
    const noInfo=await connection.getAccountInfo(market.noMint,"confirmed");
    if(!collateralInfo||!yesInfo||!noInfo)throw new Error("Market token mint unavailable");

    const [usd,yes,no]=await Promise.all([
      tokenBalance(connection,market.collateralMint,wallet,collateralInfo.owner),
      tokenBalance(connection,market.yesMint,wallet,yesInfo.owner),
      tokenBalance(connection,market.noMint,wallet,noInfo.owner),
    ]);

    return res.status(200).json({
      wallet:wallet.toBase58(),
      market:marketAddress.toBase58(),
      collateral:{symbol:"USDG",mint:market.collateralMint.toBase58(),...usd},
      yes:{symbol:"YES",mint:market.yesMint.toBase58(),...yes},
      no:{symbol:"NO",mint:market.noMint.toBase58(),...no},
      updatedAt:Date.now(),
    });
  }catch(error:any){
    return res.status(400).json({error:error?.message||String(error),stage:"trader-state"});
  }
}
