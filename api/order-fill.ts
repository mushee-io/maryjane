import crypto from "node:crypto";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const PROGRAM_ID = new PublicKey("HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL");
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const ORDER_DISC = crypto
  .createHash("sha256")
  .update("account:LimitOrder")
  .digest()
  .subarray(0, 8);

function disc(name: string) {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}
function u64(value: bigint) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const taker = new PublicKey(String(req.body?.wallet || ""));
    const orderKey = new PublicKey(String(req.body?.order || ""));
    const requested = BigInt(String(req.body?.sharesBaseUnits || "0"));
    const connection = new Connection(RPC_URL, "confirmed");

    const orderInfo = await connection.getAccountInfo(orderKey, "confirmed");
    if (!orderInfo) throw new Error("Order not found");
    const raw = Buffer.from(orderInfo.data);
    if (raw.length !== 198 || !raw.subarray(0, 8).equals(ORDER_DISC)) {
      throw new Error("Invalid order account");
    }

    const maker = new PublicKey(raw.subarray(8, 40));
    const market = new PublicKey(raw.subarray(40, 72));
    const side = raw.readUInt8(104) === 0 ? "YES" : "NO";
    const remaining = raw.readBigUInt64LE(116);
    const escrowMint = new PublicKey(raw.subarray(124, 156));
    const escrowVault = new PublicKey(raw.subarray(156, 188));
    if (raw.readUInt8(196) !== 0) throw new Error("Order is no longer active");

    const shares = requested > 0n ? requested : remaining;
    if (shares <= 0n || shares > remaining) throw new Error("Invalid fill size");

    const marketInfo = await connection.getAccountInfo(market, "confirmed");
    if (!marketInfo || marketInfo.data.length !== 420) throw new Error("Market not found");
    const marketRaw = Buffer.from(marketInfo.data);
    if (marketRaw.readUInt8(216) !== 0) throw new Error("Market is not open");

    const collateralMint = new PublicKey(marketRaw.subarray(72, 104));
    const yesMint = new PublicKey(marketRaw.subarray(251, 283));
    const noMint = new PublicKey(marketRaw.subarray(283, 315));
    const outcomeMint = side === "YES" ? yesMint : noMint;
    const mintInfo = await connection.getAccountInfo(collateralMint, "confirmed");
    if (!mintInfo) throw new Error("Collateral mint unavailable");
    const tokenProgram = mintInfo.owner;
    const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);

    const takerCollateral = getAssociatedTokenAddressSync(collateralMint, taker, false, tokenProgram);
    const takerOutcome = getAssociatedTokenAddressSync(outcomeMint, taker, false, tokenProgram);
    const makerCollateral = getAssociatedTokenAddressSync(collateralMint, maker, false, tokenProgram);
    const makerOutcome = getAssociatedTokenAddressSync(outcomeMint, maker, false, tokenProgram);

    const instruction = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: taker, isSigner: true, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: orderKey, isSigner: false, isWritable: true },
        { pubkey: maker, isSigner: false, isWritable: false },
        { pubkey: collateralMint, isSigner: false, isWritable: false },
        { pubkey: outcomeMint, isSigner: false, isWritable: false },
        { pubkey: escrowMint, isSigner: false, isWritable: false },
        { pubkey: escrowVault, isSigner: false, isWritable: true },
        { pubkey: takerCollateral, isSigner: false, isWritable: true },
        { pubkey: takerOutcome, isSigner: false, isWritable: true },
        { pubkey: makerCollateral, isSigner: false, isWritable: true },
        { pubkey: makerOutcome, isSigner: false, isWritable: true },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc("fill_order"), u64(shares)]),
    });

    const latest = await connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({
      feePayer: taker,
      recentBlockhash: latest.blockhash,
    })
      .add(
        createAssociatedTokenAccountIdempotentInstruction(
          taker,
          takerCollateral,
          taker,
          collateralMint,
          tokenProgram,
        ),
      )
      .add(
        createAssociatedTokenAccountIdempotentInstruction(
          taker,
          takerOutcome,
          taker,
          outcomeMint,
          tokenProgram,
        ),
      )
      .add(
        createAssociatedTokenAccountIdempotentInstruction(
          taker,
          makerCollateral,
          maker,
          collateralMint,
          tokenProgram,
        ),
      )
      .add(
        createAssociatedTokenAccountIdempotentInstruction(
          taker,
          makerOutcome,
          maker,
          outcomeMint,
          tokenProgram,
        ),
      )
      .add(instruction);

    return res.status(200).json({
      transactionBase64: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      lastValidBlockHeight: latest.lastValidBlockHeight,
      sharesBaseUnits: shares.toString(),
    });
  } catch (error: any) {
    return res.status(400).json({
      error: error?.message || "Unable to build fill transaction",
    });
  }
}
