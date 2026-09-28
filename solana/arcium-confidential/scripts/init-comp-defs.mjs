import * as anchor from "@anchor-lang/core";
import {
  getArciumAccountBaseSeed,
  getArciumProgram,
  getArciumProgramId,
  getCompDefAccOffset,
  getLookupTableAddress,
  getMXEAccAddress,
  uploadCircuit,
} from "@arcium-hq/client";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root=path.resolve(process.cwd());
const rpc=process.env.ANCHOR_PROVIDER_URL || process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const keypairPath=(process.env.ANCHOR_WALLET || path.join(os.homedir(),".config","solana","id.json"))
  .replace(/^~(?=$|\/)/,os.homedir());

function readKeypair(file){
  const bytes=JSON.parse(fs.readFileSync(file,"utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

const payer=readKeypair(keypairPath);
const connection=new Connection(rpc,"confirmed");
const wallet={
  publicKey:payer.publicKey,
  signTransaction:async(tx)=>{
    if("partialSign" in tx) tx.partialSign(payer);
    else tx.sign([payer]);
    return tx;
  },
  signAllTransactions:async(txs)=>Promise.all(txs.map(async(tx)=>{
    if("partialSign" in tx) tx.partialSign(payer);
    else tx.sign([payer]);
    return tx;
  })),
};
const provider=new anchor.AnchorProvider(connection,wallet,{commitment:"confirmed",preflightCommitment:"confirmed"});
anchor.setProvider(provider);

const programKeypairPath=path.join(root,"target","deploy","maryjane_confidential-keypair.json");
if(!fs.existsSync(programKeypairPath)){
  throw new Error("Missing target/deploy/maryjane_confidential-keypair.json. Run arcium build first.");
}
const programId=readKeypair(programKeypairPath).publicKey;

const idlPath=path.join(root,"target","idl","maryjane_confidential.json");
if(!fs.existsSync(idlPath)){
  throw new Error("Missing target/idl/maryjane_confidential.json. Run arcium build first.");
}
const idl=JSON.parse(fs.readFileSync(idlPath,"utf8"));
idl.address=programId.toBase58();
const program=new anchor.Program(idl,provider);

async function waitForMxe(){
  const arciumProgram=getArciumProgram(provider);
  const mxe=getMXEAccAddress(programId);
  let last;
  for(let i=0;i<60;i+=1){
    try{
      const account=await arciumProgram.account.mxeAccount.fetch(mxe);
      return {arciumProgram,mxe,account};
    }catch(error){
      last=error;
      await new Promise(r=>setTimeout(r,2000));
    }
  }
  throw new Error(`MXE account did not become readable: ${String(last?.message||last||"unknown")}`);
}

const {mxe,account:mxeAccount}=await waitForMxe();
const lutAddress=getLookupTableAddress(programId,mxeAccount.lutOffsetSlot);
const baseSeed=getArciumAccountBaseSeed("ComputationDefinitionAccount");

const circuits=[
  ["init_confidential_state","initConfidentialStateCompDef"],
  ["apply_private_order","initApplyPrivateOrderCompDef"],
  ["reveal_aggregate","initRevealAggregateCompDef"],
];

for(const [circuitName,methodName] of circuits){
  const offset=getCompDefAccOffset(circuitName);
  const compDefAccount=PublicKey.findProgramAddressSync(
    [baseSeed,programId.toBuffer(),offset],
    getArciumProgramId(),
  )[0];

  const existing=await connection.getAccountInfo(compDefAccount,"confirmed");
  if(!existing){
    const builder=program.methods[methodName]();
    const signature=await builder
      .accounts({
        payer:payer.publicKey,
        mxeAccount:mxe,
        compDefAccount,
        addressLookupTable:lutAddress,
      })
      .signers([payer])
      .rpc({preflightCommitment:"confirmed",commitment:"confirmed"});
    console.log(`[comp-def] initialized ${circuitName}: ${signature}`);
  }else{
    console.log(`[comp-def] already exists ${circuitName}: ${compDefAccount.toBase58()}`);
  }

  const circuitPath=path.join(root,"build",`${circuitName}.arcis`);
  if(!fs.existsSync(circuitPath)){
    throw new Error(`Missing circuit artifact: ${circuitPath}`);
  }
  const raw=fs.readFileSync(circuitPath);
  try{
    await uploadCircuit(provider,circuitName,programId,raw,true);
    console.log(`[comp-def] uploaded ${circuitName}`);
  }catch(error){
    const message=String(error?.message||error||"");
    if(/already|exists|finalized/i.test(message)){
      console.log(`[comp-def] upload already finalized for ${circuitName}`);
    }else{
      throw error;
    }
  }
}

console.log(JSON.stringify({
  status:"READY",
  rpc,
  payer:payer.publicKey.toBase58(),
  programId:programId.toBase58(),
  mxe:getMXEAccAddress(programId).toBase58(),
  circuits:circuits.map(([name])=>name),
},null,2));
