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

console.log("limit-order instruction names: PASS");
