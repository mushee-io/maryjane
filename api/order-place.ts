import { createHash, randomBytes } from "node:crypto";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import {
  getArciumProgramId,
  getArciumSignerAccAddress,
  getClockAccAddress,
  getClusterAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getMempoolAccAddress,
  getMXEAccAddress,
} from "@arcium-hq/client";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

const PROGRAM_ID=new PublicKey("HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL");
const RPC_URL=process.env.SOLANA_RPC_URL||"https://api.devnet.solana.com";
const MARKET_DISC=createHash("sha256").update("account:Market").digest().subarray(0,8);
function disc(name:string){return createHash("sha256").update(`global:${name}`).digest().subarray(0,8);}
function u16(v:number){const b=Buffer.alloc(2);b.writeUInt16LE(v);return b;}
function u64(v:bigint){const b=Buffer.alloc(8);b.writeBigUInt64LE(v);return b;}
function u128(v:bigint){
  if(v<0n||v>=(1n<<128n))throw new Error("u128 out of range");
  const b=Buffer.alloc(16);
  const mask=(1n<<64n)-1n;
  b.writeBigUInt64LE(v&mask,0);
  b.writeBigUInt64LE(v>>64n,8);
  return b;
}
function bytes32(value:any,label:string){
  if(!Array.isArray(value)||value.length!==32)throw new Error(`${label} must contain 32 bytes`);
  const bytes=value.map((n:any)=>Number(n));
  if(bytes.some((n:number)=>!Number.isInteger(n)||n<0||n>255))throw new Error(`${label} contains invalid bytes`);
  return Buffer.from(bytes);
}
function confidentialConfig(){
  const enabled=
    process.env.CONFIDENTIAL_MARKETS==="true"||
    process.env.VITE_CONFIDENTIAL_MARKETS==="true";
  const programText=String(
    process.env.ARCIUM_CONFIDENTIAL_PROGRAM_ID||
    process.env.VITE_ARCIUM_PROGRAM_ID||
    ""
  ).trim();
  const clusterText=String(
    process.env.ARCIUM_CLUSTER_OFFSET||
    process.env.VITE_ARCIUM_CLUSTER_OFFSET||
    ""
  ).trim();
  if(!enabled)return{enabled:false as const,reason:"Confidential markets are disabled"};
  if(!programText)return{enabled:false as const,reason:"Arcium confidential program ID is not configured"};
  if(!/^\d+$/.test(clusterText))return{enabled:false as const,reason:"Arcium cluster offset is not configured"};
  return{
    enabled:true as const,
    programId:new PublicKey(programText),
    clusterOffset:Number(clusterText),
  };
}
function confidentialStateNonce(raw:Buffer){
  // discriminator(8) + bump(1) + public_market(32) + authority(32)
  if(raw.length<89)return 0n;
  const lo=raw.readBigUInt64LE(73);
  const hi=raw.readBigUInt64LE(81);
  return lo+(hi<<64n);
}
function arciumAccounts(programId:PublicKey,clusterOffset:number,computationOffset:bigint,circuitName:string){
  const offsetBn=new BN(computationOffset.toString());
  return{
    signPda:getArciumSignerAccAddress(programId),
    mxe:getMXEAccAddress(programId),
    mempool:getMempoolAccAddress(clusterOffset),
    executingPool:getExecutingPoolAccAddress(clusterOffset),
    computation:getComputationAccAddress(clusterOffset,offsetBn),
    compDef:getCompDefAccAddress(programId,getCompDefAccOffset(circuitName)),
    cluster:getClusterAccAddress(clusterOffset),
    feePool:getFeePoolAccAddress(),
    clock:getClockAccAddress(),
    arciumProgram:getArciumProgramId(),
  };
}
async function serializeUnsigned(connection:Connection,wallet:PublicKey,ix:TransactionInstruction){
  const latest=await connection.getLatestBlockhash("confirmed");
  const tx=new Transaction({feePayer:wallet,recentBlockhash:latest.blockhash}).add(ix);
  const serialized=tx.serialize({requireAllSignatures:false,verifySignatures:false});
  return{
    transactionBase64:serialized.toString("base64"),
    lastValidBlockHeight:latest.lastValidBlockHeight,
  };
}
async function handleConfidential(req:any,res:any){
  const cfg=confidentialConfig();
  if(!cfg.enabled)return res.status(503).json({error:cfg.reason,stage:"confidential-config"});

  const wallet=new PublicKey(String(req.body?.wallet||req.body?.envelope?.trader||""));
  const publicMarket=new PublicKey(String(req.body?.market||req.body?.envelope?.market||""));
  const connection=new Connection(RPC_URL,"confirmed");
  const publicInfo=await connection.getAccountInfo(publicMarket,"confirmed");
  if(!publicInfo)throw new Error("Mary Jane market not found on Devnet");

  const [confidentialMarket]=PublicKey.findProgramAddressSync(
    [Buffer.from("confidential-market"),publicMarket.toBuffer()],
    cfg.programId,
  );
  const stateInfo=await connection.getAccountInfo(confidentialMarket,"confirmed");
  const stateNonce=stateInfo?confidentialStateNonce(Buffer.from(stateInfo.data)):0n;
  const action=String(req.body?.action||"status").toLowerCase();

  if(action==="status"){
    return res.status(200).json({
      enabled:true,
      configured:true,
      status:!stateInfo?"missing":stateNonce===0n?"initializing":"ready",
      publicMarket:publicMarket.toBase58(),
      confidentialMarket:confidentialMarket.toBase58(),
      programId:cfg.programId.toBase58(),
      clusterOffset:cfg.clusterOffset,
    });
  }

  if(action==="prepare"){
    if(stateInfo){
      return res.status(200).json({
        enabled:true,
        configured:true,
        status:stateNonce===0n?"initializing":"ready",
        confidentialMarket:confidentialMarket.toBase58(),
      });
    }
    const computationOffset=BigInt("0x"+randomBytes(8).toString("hex"));
    const a=arciumAccounts(cfg.programId,cfg.clusterOffset,computationOffset,"init_confidential_state");
    const ix=new TransactionInstruction({
      programId:cfg.programId,
      keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},
        {pubkey:confidentialMarket,isSigner:false,isWritable:true},
        {pubkey:a.signPda,isSigner:false,isWritable:true},
        {pubkey:a.mxe,isSigner:false,isWritable:false},
        {pubkey:a.mempool,isSigner:false,isWritable:true},
        {pubkey:a.executingPool,isSigner:false,isWritable:true},
        {pubkey:a.computation,isSigner:false,isWritable:true},
        {pubkey:a.compDef,isSigner:false,isWritable:false},
        {pubkey:a.cluster,isSigner:false,isWritable:true},
        {pubkey:a.feePool,isSigner:false,isWritable:true},
        {pubkey:a.clock,isSigner:false,isWritable:true},
        {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
        {pubkey:a.arciumProgram,isSigner:false,isWritable:false},
      ],
      data:Buffer.concat([
        disc("create_confidential_market"),
        u64(computationOffset),
        publicMarket.toBuffer(),
      ]),
    });
    return res.status(200).json({
      ...(await serializeUnsigned(connection,wallet,ix)),
      status:"setup-transaction",
      computationOffset:computationOffset.toString(),
      confidentialMarket:confidentialMarket.toBase58(),
    });
  }

  if(action==="submit"){
    if(!stateInfo||stateNonce===0n){
      return res.status(409).json({
        error:"Confidential market state is not ready yet",
        status:!stateInfo?"missing":"initializing",
        stage:"confidential-state",
      });
    }
    const envelope=req.body?.envelope||{};
    if(String(envelope.programId||"")!==cfg.programId.toBase58())throw new Error("Confidential envelope targets the wrong Arcium program");
    if(String(envelope.market||"")!==publicMarket.toBase58())throw new Error("Confidential envelope targets the wrong market");
    if(String(envelope.trader||"")!==wallet.toBase58())throw new Error("Confidential envelope targets the wrong wallet");
    const computationOffset=BigInt(String(envelope.computationOffset||"0"));
    const nonce=BigInt(String(envelope.nonceU128||"0"));
    if(computationOffset<=0n)throw new Error("Invalid Arcium computation offset");
    const a=arciumAccounts(cfg.programId,cfg.clusterOffset,computationOffset,"apply_private_order");
    const ix=new TransactionInstruction({
      programId:cfg.programId,
      keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},
        {pubkey:confidentialMarket,isSigner:false,isWritable:true},
        {pubkey:a.signPda,isSigner:false,isWritable:true},
        {pubkey:a.mxe,isSigner:false,isWritable:false},
        {pubkey:a.mempool,isSigner:false,isWritable:true},
        {pubkey:a.executingPool,isSigner:false,isWritable:true},
        {pubkey:a.computation,isSigner:false,isWritable:true},
        {pubkey:a.compDef,isSigner:false,isWritable:false},
        {pubkey:a.cluster,isSigner:false,isWritable:true},
        {pubkey:a.feePool,isSigner:false,isWritable:true},
        {pubkey:a.clock,isSigner:false,isWritable:true},
        {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
        {pubkey:a.arciumProgram,isSigner:false,isWritable:false},
      ],
      data:Buffer.concat([
        disc("submit_private_order"),
        u64(computationOffset),
        bytes32(envelope?.ciphertext?.side,"encrypted side"),
        bytes32(envelope?.ciphertext?.kind,"encrypted order kind"),
        bytes32(envelope?.ciphertext?.priceBps,"encrypted price"),
        bytes32(envelope?.ciphertext?.sharesBaseUnits,"encrypted shares"),
        bytes32(envelope?.clientPublicKey,"client public key"),
        u128(nonce),
      ]),
    });
    return res.status(200).json({
      ...(await serializeUnsigned(connection,wallet,ix)),
      status:"confidential-order-transaction",
      computationOffset:computationOffset.toString(),
      confidentialMarket:confidentialMarket.toBase58(),
      privacy:{
        encrypted:["side","direction","limit price","order size"],
        public:["market","signing wallet","transaction metadata","computation existence"],
      },
    });
  }

  throw new Error("Unknown confidential order action");
}
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
    if(String(req.body?.mode||"").toLowerCase()==="confidential"){
      return await handleConfidential(req,res);
    }
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
      data:Buffer.concat([disc("place_limit_order"),orderSeed,Buffer.from([side==="YES"?0:1]),Buffer.from([kind==="BUY"?0:1]),u16(priceBps),u64(shares)]),
    });

    const latest=await connection.getLatestBlockhash("confirmed");
    const tx=new Transaction({feePayer:wallet,recentBlockhash:latest.blockhash})
      .add(createAssociatedTokenAccountIdempotentInstruction(wallet,makerSource,wallet,escrowMint,tokenProgram))
      .add(ix);

    const serialized=tx.serialize({requireAllSignatures:false,verifySignatures:false});
    try{
      const simulation:any=await (connection as any)._rpcRequest("simulateTransaction",[
        serialized.toString("base64"),
        {encoding:"base64",commitment:"confirmed",sigVerify:false,replaceRecentBlockhash:false}
      ]);
      const value=simulation?.result?.value;
      if(value?.err){
        const logs=Array.isArray(value.logs)?value.logs:[];
        const useful=logs.filter((line:string)=>/error|failed|insufficient|rent|funds|custom program error/i.test(line)).slice(-6);
        const raw=JSON.stringify(value.err);
        let friendly="Transaction simulation failed.";
        const joined=logs.join(" ").toLowerCase();
        if(/insufficient.*funds|insufficient lamports|rent/.test(joined)||/insufficientfundsforfee/.test(raw.toLowerCase())){
          friendly="Insufficient Devnet SOL for transaction fees or account rent.";
        }else if(/accountnotfound/.test(raw.toLowerCase())){
          friendly="A required Solana account is missing.";
        }
        return res.status(400).json({
          error: useful.length ? `${friendly} ${useful.join(" · ")}` : `${friendly} ${raw}`,
          code:"SIMULATION_FAILED",
          simulationError:value.err,
          logs,
          stage:"order-simulation",
        });
      }
    }catch(simError:any){
      return res.status(400).json({
        error:`Unable to simulate order: ${simError?.message||String(simError)}`,
        code:"SIMULATION_UNAVAILABLE",
        stage:"order-simulation",
      });
    }

    return res.status(200).json({transactionBase64:serialized.toString("base64"),lastValidBlockHeight:latest.lastValidBlockHeight,order:order.toBase58()});
  }catch(e:any){return res.status(400).json({error:e?.message||String(e),stage:"place-order"});}
}
