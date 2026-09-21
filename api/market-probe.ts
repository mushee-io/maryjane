import { createHash } from "node:crypto";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const MARKET_DISC = createHash("sha256").update("account:Market").digest().subarray(0,8);

export default async function handler(req:any,res:any) {
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});

  const address=String(req.query?.address||"").trim();
  if(!address) return res.status(400).json({error:"address is required"});

  try {
    const {Connection,PublicKey}=await import("@solana/web3.js");
    const connection=new Connection(RPC_URL,"confirmed");
    const key=new PublicKey(address);
    const info:any=await Promise.race([
      connection.getAccountInfo(key,"confirmed"),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error("RPC timeout")),8_000)),
    ]);
    if(!info) {
      return res.status(200).json({
        address,
        exists:false,
        rpcHost:new URL(RPC_URL).host,
      });
    }
    const raw=Buffer.from(info.data);
    return res.status(200).json({
      address,
      exists:true,
      owner:info.owner.toBase58(),
      lamports:info.lamports,
      dataLength:raw.length,
      discriminator:raw.subarray(0,8).toString("hex"),
      expectedMarketDiscriminator:MARKET_DISC.toString("hex"),
      isMarket:raw.length===420 && raw.subarray(0,8).equals(MARKET_DISC),
      rpcHost:new URL(RPC_URL).host,
    });
  } catch(error:any) {
    return res.status(502).json({address,error:error?.message||String(error)});
  }
}
