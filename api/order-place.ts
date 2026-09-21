import crypto from "node:crypto";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const PROGRAM_ID = new PublicKey("HriJWSipKzjya2ScJ8f2AyVwrkbugLtmVELwvb2w7vRL");
const COLLATERAL_MINT = new PublicKey("4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7");
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

function disc(name: string) {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}
function u16(value: number) {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}
function u64(value: bigint) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}
function hex32(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("invalid market seed");
  return Buffer.from(value, "hex");
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const wallet = new PublicKey(String(req.body?.wallet || ""));
    const marketSeed = hex32(String(req.body?.marketSeed || ""));
    const side = String(req.body?.side || "").toUpperCase();
    const kind = String(req.body?.kind || "").toUpperCase();
    const priceBps = Number(req.body?.priceBps || 0);
    const shares = BigInt(String(req.body?.sharesBaseUnits || "0"));

    if (!["YES", "NO"].includes(side) || !["BUY", "SELL"].includes(kind)) {
      throw new Error("Invalid side or order type");
    }
    if (!Number.isInteger(priceBps) || priceBps < 1 || priceBps > 9_999) {
      throw new Error("Price must be 0.01¢–99.99¢");
    }
    if (shares <= 0n) throw new Error("Shares must be positive");

    connection = new Connection(RPC_URL, "confirmed");
    const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
    const [market] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), config.toBuffer(), marketSeed],
      PROGRAM_ID,
    );

    const marketInfo = await connection.getAccountInfo(market, "confirmed");
    if (!marketInfo || marketInfo.data.length !== 420) throw new Error("Market not found");
    const raw = Buffer.from(marketInfo.data);
    if (raw.readUInt8(216) !== 0) throw new Error("Market is not open");
    if (Number(raw.readBigInt64LE(200)) <= Math.floor(Date.now() / 1000)) {
      throw new Error("Market trading is closed");
    }

    const marketCollateral = new PublicKey(raw.subarray(72, 104));
    if (!marketCollateral.equals(COLLATERAL_MINT)) throw new Error("Unsupported collateral mint");
    const yesMint = new PublicKey(raw.subarray(251, 283));
    const noMint = new PublicKey(raw.subarray(283, 315));
    const mintInfo = await connection.getAccountInfo(COLLATERAL_MINT, "confirmed");
    if (!mintInfo) throw new Error("Collateral mint unavailable");
    const tokenProgram = mintInfo.owner;

    const orderSeed = crypto.randomBytes(32);
    const [order] = PublicKey.findProgramAddressSync(
      [Buffer.from("order"), market.toBuffer(), wallet.toBuffer(), orderSeed],
      PROGRAM_ID,
    );
    const [escrowVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("order-vault"), order.toBuffer()],
      PROGRAM_ID,
    );

    const outcomeMint = side === "YES" ? yesMint : noMint;
    const escrowMint = kind === "BUY" ? COLLATERAL_MINT : outcomeMint;
    const makerSource = getAssociatedTokenAddressSync(escrowMint, wallet, false, tokenProgram);

    const instruction = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: wallet, isSigner: true, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: market, isSigner: false, isWritable: false },
        { pubkey: COLLATERAL_MINT, isSigner: false, isWritable: false },
        { pubkey: yesMint, isSigner: false, isWritable: false },
        { pubkey: noMint, isSigner: false, isWritable: false },
        { pubkey: escrowMint, isSigner: false, isWritable: false },
        { pubkey: makerSource, isSigner: false, isWritable: true },
        { pubkey: order, isSigner: false, isWritable: true },
        { pubkey: escrowVault, isSigner: false, isWritable: true },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        disc("place_order"),
        orderSeed,
        Buffer.from([side === "YES" ? 0 : 1]),
        Buffer.from([kind === "BUY" ? 0 : 1]),
        u16(priceBps),
        u64(shares),
      ]),
    });

    const latest = await connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({
      feePayer: wallet,
      recentBlockhash: latest.blockhash,
    })
      .add(
        createAssociatedTokenAccountIdempotentInstruction(
          wallet,
          makerSource,
          wallet,
          escrowMint,
          tokenProgram,
        ),
      )
      .add(instruction);

    return res.status(200).json({
      transactionBase64: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      lastValidBlockHeight: latest.lastValidBlockHeight,
      order: order.toBase58(),
      market: market.toBase58(),
      expectedQuoteBaseUnits:
        kind === "BUY" ? ((shares * BigInt(priceBps)) / 10_000n).toString() : null,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || "Unable to build order" });
  }
}
