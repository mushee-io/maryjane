import fs from "node:fs";

const checks = [
  ["api/order-place.ts", 'disc("place_limit_order")'],
  ["api/order-fill.ts", 'disc("fill_limit_order")'],
  ["api/order-cancel.ts", 'disc("cancel_limit_order")'],
  ["solana/sdk/src/transactions.ts", 'instructionDiscriminator("place_limit_order")'],
  ["solana/sdk/src/transactions.ts", 'instructionDiscriminator("fill_limit_order")'],
];

for (const [file, needle] of checks) {
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes(needle)) {
    throw new Error(`${file} missing deployed Anchor instruction ${needle}`);
  }
}

const rust = fs.readFileSync("solana/programs/milady_market/src/lib.rs", "utf8");
for (const name of ["place_limit_order", "fill_limit_order", "cancel_limit_order"]) {
  if (!rust.includes(`pub fn ${name}`)) {
    throw new Error(`Deployed-program source missing ${name}`);
  }
}

const forbidden = [
  ['api/order-place.ts', 'disc("place_order")'],
  ['api/order-fill.ts', 'disc("fill_order")'],
  ['api/order-cancel.ts', 'disc("cancel_order")'],
  ['solana/sdk/src/transactions.ts', 'instructionDiscriminator("place_order")'],
  ['solana/sdk/src/transactions.ts', 'instructionDiscriminator("fill_order")'],
];

for (const [file, needle] of forbidden) {
  const source = fs.readFileSync(file, "utf8");
  if (source.includes(needle)) {
    throw new Error(`${file} still contains stale instruction ${needle}`);
  }
}

const positionSource = fs.readFileSync("solana/programs/milady_market/src/lib.rs", "utf8");
for (const name of ["split_complete_set", "merge_complete_set"]) {
  if (!positionSource.includes(`pub fn ${name}`)) {
    throw new Error(`Deployed-program source missing ${name}`);
  }
}
console.log("limit-order + complete-set instruction names: PASS");


const lifecycle = fs.readFileSync("api/market-action.ts", "utf8");
for (const instruction of [
  "close_market",
  "propose_resolution",
  "dispute_resolution",
  "finalize_uncontested",
  "resolve_dispute",
  "cancel_stalled_dispute",
  "redeem_winnings",
  "refund_invalid",
]) {
  if (!lifecycle.includes(`disc("${instruction}")`)) {
    throw new Error(`api/market-action.ts missing deployed instruction ${instruction}`);
  }
  const programSources = [
    fs.readFileSync("solana/programs/milady_market/src/lib.rs", "utf8"),
    fs.readFileSync("solana/programs/milady_market/src/resolution.rs", "utf8"),
    fs.readFileSync("solana/programs/milady_market/src/settlement.rs", "utf8"),
  ].join("\n");
  if (!programSources.includes(instruction)) {
    throw new Error(`program source missing lifecycle instruction ${instruction}`);
  }
}
console.log("resolution + settlement instruction names: PASS");
