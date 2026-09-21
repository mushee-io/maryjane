const web3 = await import("@solana/web3.js");
if (!web3.PublicKey || !web3.Transaction || !web3.Connection || !web3.Keypair) {
  throw new Error("@solana/web3.js runtime exports are incomplete");
}
const pk = new web3.PublicKey("11111111111111111111111111111111");
if (pk.toBase58() !== "11111111111111111111111111111111") {
  throw new Error("PublicKey runtime check failed");
}
console.log(JSON.stringify({
  ok: true,
  runtime: process.version,
  publicKey: pk.toBase58(),
}, null, 2));
