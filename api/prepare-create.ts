import { createHash } from "node:crypto";

const PROGRAM_ID_STRING = "HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL";
const USDG_MINT_STRING = "4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7";
const MEMO_PROGRAM_ID_STRING = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

type Input = {
  question?: string;
  description?: string;
  source?: string;
  category?: string;
  deadline?: string;
  closeTs?: number;
  resolutionTs?: number;
};

function sha(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
function normalize(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
function hex32(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("Expected 32-byte hex");
  return Buffer.from(value, "hex");
}
function i64(value: bigint) {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(value);
  return out;
}
function discriminator(name: string) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0,8);
}

function compileReport(input: Input) {
  const question=normalize(input.question);
  const description=normalize(input.description);
  const source=normalize(input.source);
  const category=normalize(input.category);
  const deadline=normalize(input.deadline);
  if(!question) throw new Error("Question is required");
  if(!Number.isInteger(input.closeTs)||!Number.isInteger(input.resolutionTs)) {
    throw new Error("Trading close and resolution time are required");
  }
  const closeTs=Number(input.closeTs);
  const resolutionTs=Number(input.resolutionTs);
  const now=Math.floor(Date.now()/1000);
  if(closeTs<=now) throw new Error("Trading close must be in the future");
  if(resolutionTs<closeTs) throw new Error("Resolution time must be at or after trading close");

  const combined=`${question} ${description}`.toLowerCase();
  const ambiguous=["soon","pump","crash","big","huge","likely","major","significant","quickly","rapidly","eventually","sometime","anytime","much","many"]
    .filter(word=>new RegExp(`\\b${word}\\b`,"i").test(combined));
  const hasSource=source.length>2||/(pyth|coinbase|binance|reuters|bloomberg|official)/i.test(combined);
  const hasMetric=/(\$[\d,.]+|[\d,.]+%|above|below|exceed|under|over|at least|more than|less than|equal to|close at|reach\s+\d)/i.test(question);
  const hasDeadline=deadline.length>=4||/(\d{4}|utc)/i.test(combined);
  const ambiguityScore=Math.min(100,ambiguous.length*22+(hasMetric?0:25));
  const resolutionClarityScore=Math.max(0,100-(hasDeadline?0:30)-(hasSource?0:25)-(hasMetric?0:20));
  const overallScore=Math.max(0,Math.min(100,100-ambiguous.length*12-(hasDeadline?0:20)-(hasSource?0:15)-(hasMetric?0:20)));
  const verdict=overallScore>=80&&resolutionClarityScore>=70?"green":overallScore>=55?"yellow":"red";
  if(verdict!=="green") {
    const err:any=new Error(`MarketLint report is ${verdict.toUpperCase()}, not GREEN`);
    err.statusCode=422;
    throw err;
  }

  const normalizedInput={question,description,source,category,deadline,closeTs,resolutionTs};
  const questionHash=sha(question);
  const marketSeed=sha(`33milady:market:${questionHash}:${closeTs}`);
  const metadataHash=sha(JSON.stringify({description,source,category,deadline}));
  const sourceHash=sha(source);
  const spec={
    version:"33milady-market-spec-v1",
    question,description,source,category,deadline,
    marketType:"binary",
    outcomes:["YES","NO"],
    closeTs,resolutionTs,
    resolutionPolicy:{sourceRequired:true,source,deadline,fallback:"INVALID_IF_SOURCE_UNAVAILABLE"},
  };
  const specHash=sha(JSON.stringify(spec));
  const analysis={
    overallScore,verdict,ambiguityScore,duplicateProbability:0,resolutionClarityScore,
    missingSource:!hasSource,issues:[],contradictions:[],similarMarkets:[],
    rewriteSuggestion:question,structuredBreakdown:{source,deadline,marketType:"binary"},
    resolutionSuggestions:[],
  };
  const reportHash=sha(JSON.stringify({analysis,spec,marketSeed,questionHash,metadataHash,sourceHash,specHash}));
  return {
    id:reportHash,createdAt:Date.now(),input:normalizedInput,analysis,spec,
    hashes:{marketSeed,questionHash,metadataHash,sourceHash,specHash,reportHash},
  };
}

function parseAttestorSecret(Keypair:any) {
  const raw=process.env.MARKETLINT_ATTESTOR_SECRET_KEY?.trim();
  if(!raw) {
    const err:any=new Error("MARKETLINT_ATTESTOR_SECRET_KEY is not configured in Vercel");
    err.statusCode=503;
    throw err;
  }
  let bytes:number[];
  try {
    bytes=raw.startsWith("[")
      ? JSON.parse(raw)
      : JSON.parse(Buffer.from(raw,"base64").toString("utf8"));
  } catch {
    const err:any=new Error("MARKETLINT_ATTESTOR_SECRET_KEY must be a JSON byte array or base64-encoded JSON byte array");
    err.statusCode=503;
    throw err;
  }
  if(!Array.isArray(bytes) || (bytes.length!==64 && bytes.length!==32)) {
    const err:any=new Error(`MARKETLINT_ATTESTOR_SECRET_KEY decoded to ${Array.isArray(bytes)?bytes.length:"non-array"} bytes; expected 64-byte secret key or 32-byte seed`);
    err.statusCode=503;
    throw err;
  }
  return bytes.length===32
    ? Keypair.fromSeed(Uint8Array.from(bytes))
    : Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export default async function handler(req:any,res:any) {
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");

  if(req.method==="GET") {
    return res.status(200).json({
      status:"ok",
      service:"mary-jane-prepare-create",
      network:"devnet",
      programId:PROGRAM_ID_STRING,
      attestorConfigured:Boolean(process.env.MARKETLINT_ATTESTOR_SECRET_KEY),
      publicCertificationEnabled:process.env.MARKETLINT_PUBLIC_CERTIFY==="true",
      rpcConfigured:Boolean(process.env.SOLANA_RPC_URL),
      rpcHost:(() => { try { return new URL(RPC_URL).host; } catch { return "invalid"; } })(),
    });
  }
  if(req.method!=="POST") {
    res.setHeader("Allow","GET, POST");
    return res.status(405).json({error:"Method not allowed"});
  }

  let stage="request";
  try {
    if(process.env.MARKETLINT_PUBLIC_CERTIFY!=="true") {
      const err:any=new Error("Public MarketLint certification is disabled on this deployment");
      err.statusCode=403;
      throw err;
    }

    const body=typeof req.body==="string"?JSON.parse(req.body):req.body||{};
    const report=compileReport(body.input||{});

    stage="load-web3";
    const web3=await import("@solana/web3.js");
    const {
      Connection,Keypair,PublicKey,SystemProgram,
      Transaction,TransactionInstruction,
    }=web3;

    stage="parse-wallet";
    const wallet=new PublicKey(String(body.wallet||""));
    const programId=new PublicKey(PROGRAM_ID_STRING);
    const collateralMint=new PublicKey(USDG_MINT_STRING);
    const memoProgramId=new PublicKey(MEMO_PROGRAM_ID_STRING);
    const marketSeed=hex32(report.hashes.marketSeed);
    const questionHash=hex32(report.hashes.questionHash);
    const metadataHash=hex32(report.hashes.metadataHash);
    const sourceHash=hex32(report.hashes.sourceHash);
    const specHash=hex32(report.hashes.specHash);
    const reportHash=hex32(report.hashes.reportHash);

    const deriveConfig=()=>PublicKey.findProgramAddressSync([Buffer.from("config")],programId)[0];
    const deriveMarketLintConfig=()=>PublicKey.findProgramAddressSync([Buffer.from("marketlint-config")],programId)[0];
    const deriveCertification=()=>PublicKey.findProgramAddressSync([Buffer.from("marketlint-cert"),marketSeed],programId)[0];
    const config=deriveConfig();
    const marketLintConfig=deriveMarketLintConfig();
    const certification=deriveCertification();

    const market=PublicKey.findProgramAddressSync([Buffer.from("market"),config.toBuffer(),marketSeed],programId)[0];
    const addresses={
      market,
      collateralVault:PublicKey.findProgramAddressSync([Buffer.from("collateral-vault"),market.toBuffer()],programId)[0],
      yesMint:PublicKey.findProgramAddressSync([Buffer.from("yes-mint"),market.toBuffer()],programId)[0],
      noMint:PublicKey.findProgramAddressSync([Buffer.from("no-mint"),market.toBuffer()],programId)[0],
      yesReserveVault:PublicKey.findProgramAddressSync([Buffer.from("yes-vault"),market.toBuffer()],programId)[0],
      noReserveVault:PublicKey.findProgramAddressSync([Buffer.from("no-vault"),market.toBuffer()],programId)[0],
    };

    stage="load-attestor";
    const attestor=parseAttestorSecret(Keypair);

    stage="rpc-connect";
    const connection=new Connection(RPC_URL,"confirmed");

    stage="rpc-readiness";
    const [programAccount,configAccount,lintAccount,mintAccount,certAccount]=await Promise.all([
      connection.getAccountInfo(programId,"confirmed"),
      connection.getAccountInfo(config,"confirmed"),
      connection.getAccountInfo(marketLintConfig,"confirmed"),
      connection.getAccountInfo(collateralMint,"confirmed"),
      connection.getAccountInfo(certification,"confirmed"),
    ]);
    if(!programAccount?.executable) {
      const err:any=new Error("Mary Jane program is not deployed/executable on Devnet");
      err.statusCode=409; throw err;
    }
    if(!configAccount) {
      const err:any=new Error("ProtocolConfig is not initialized on Devnet");
      err.statusCode=409; throw err;
    }
    if(!lintAccount) {
      const err:any=new Error("MarketLint config is not initialized on Devnet");
      err.statusCode=409; throw err;
    }
    if(!mintAccount) {
      const err:any=new Error("USDG Devnet collateral mint was not found");
      err.statusCode=409; throw err;
    }

    let certificationSignature:string|null=null;
    if(!certAccount) {
      stage="certify";
      const ttlSecs=Math.min(7*24*60*60,Math.max(300,Number(process.env.MARKETLINT_CERT_TTL_SECS||"86400")));
      const expiresAt=BigInt(Math.floor(Date.now()/1000)+ttlSecs);
      const certifyIx=new TransactionInstruction({
        programId,
        keys:[
          {pubkey:attestor.publicKey,isSigner:true,isWritable:true},
          {pubkey:marketLintConfig,isSigner:false,isWritable:false},
          {pubkey:certification,isSigner:false,isWritable:true},
          {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
        ],
        data:Buffer.concat([
          discriminator("certify_market"),
          marketSeed,wallet.toBuffer(),questionHash,metadataHash,specHash,reportHash,sourceHash,
          i64(BigInt(report.input.closeTs)),i64(BigInt(report.input.resolutionTs)),
          Buffer.from([report.analysis.overallScore]),
          Buffer.from([0]),
          Buffer.from([report.analysis.ambiguityScore]),
          Buffer.from([0]),
          Buffer.from([report.analysis.resolutionClarityScore]),
          i64(expiresAt),
        ]),
      });

      const latestCert=await connection.getLatestBlockhash("confirmed");
      const certTx=new Transaction({
        feePayer:attestor.publicKey,
        recentBlockhash:latestCert.blockhash,
      }).add(certifyIx);
      certTx.sign(attestor);
      const raw=certTx.serialize();

      certificationSignature=await connection.sendRawTransaction(raw,{
        skipPreflight:false,
        preflightCommitment:"confirmed",
        maxRetries:3,
      });
      await connection.confirmTransaction({
        signature:certificationSignature,
        blockhash:latestCert.blockhash,
        lastValidBlockHeight:latestCert.lastValidBlockHeight,
      },"confirmed");
    }

    stage="build-transaction";
    const createIx=new TransactionInstruction({
      programId,
      keys:[
        {pubkey:wallet,isSigner:true,isWritable:true},
        {pubkey:config,isSigner:false,isWritable:false},
        {pubkey:collateralMint,isSigner:false,isWritable:false},
        {pubkey:marketLintConfig,isSigner:false,isWritable:false},
        {pubkey:certification,isSigner:false,isWritable:true},
        {pubkey:addresses.market,isSigner:false,isWritable:true},
        {pubkey:addresses.collateralVault,isSigner:false,isWritable:true},
        {pubkey:addresses.yesMint,isSigner:false,isWritable:true},
        {pubkey:addresses.noMint,isSigner:false,isWritable:true},
        {pubkey:addresses.yesReserveVault,isSigner:false,isWritable:true},
        {pubkey:addresses.noReserveVault,isSigner:false,isWritable:true},
        {pubkey:mintAccount.owner,isSigner:false,isWritable:false},
        {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      ],
      data:Buffer.concat([
        discriminator("create_market"),
        marketSeed,questionHash,metadataHash,
        i64(BigInt(report.input.closeTs)),i64(BigInt(report.input.resolutionTs)),
      ]),
    });
    const memoPayload = JSON.stringify({
      v: 1,
      t: "maryjane-market",
      m: addresses.market.toBase58(),
      q: String(report.input.question || "").slice(0, 180),
      c: String(report.input.category || "").slice(0, 32),
      s: String(report.input.source || "").slice(0, 80),
      d: String(report.input.deadline || "").slice(0, 64),
    });
    const memoIx = new TransactionInstruction({
      programId: memoProgramId,
      keys: [],
      data: Buffer.from(memoPayload, "utf8"),
    });

    const latest=await connection.getLatestBlockhash("confirmed");
    const tx=new Transaction({feePayer:wallet,recentBlockhash:latest.blockhash})
      .add(createIx)
      .add(memoIx);

    return res.status(200).json({
      report,
      certificationSignature,
      certification:certification.toBase58(),
      transactionBase64:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString("base64"),
      lastValidBlockHeight:latest.lastValidBlockHeight,
      addresses:Object.fromEntries(Object.entries(addresses).map(([k,v]:any)=>[k,v.toBase58()])),
      tokenProgram:mintAccount.owner.toBase58(),
    });
  } catch(error:any) {
    console.error("[Prepare Create]",{stage,error:error?.message});
    return res.status(error?.statusCode||400).json({
      error:error?.message||"Unable to prepare certified market",
      stage,
    });
  }
}
