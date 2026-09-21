import fs from "node:fs";
import path from "node:path";

const programId = process.argv[2]?.trim();
if (!programId || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(programId)) {
  console.error("Usage: node scripts/sync-program-id.mjs <PROGRAM_ID>");
  process.exit(1);
}

const root = process.cwd();

function update(relative, transform) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return;
  const before = fs.readFileSync(file, "utf8");
  const after = transform(before);
  fs.writeFileSync(file, after);
  console.log(`synced ${relative}`);
}

update("server.ts", (s) =>
  s.replace(
    /const MILADY_MARKET_PROGRAM_ID = new PublicKey\("[1-9A-HJ-NP-Za-km-z]{32,44}"\);/,
    `const MILADY_MARKET_PROGRAM_ID = new PublicKey("${programId}");`,
  ),
);

update("solana/Anchor.toml", (s) =>
  s.replace(
    /milady_market = "[1-9A-HJ-NP-Za-km-z]{32,44}"/g,
    `milady_market = "${programId}"`,
  ),
);

update("solana/programs/milady_market/src/lib.rs", (s) =>
  s.replace(
    /declare_id!\("[1-9A-HJ-NP-Za-km-z]{32,44}"\)/,
    `declare_id!("${programId}")`,
  ),
);

update("solana/sdk/src/index.ts", (s) =>
  s.replace(
    /(MILADY_MARKET_PROGRAM_ID = new PublicKey\(\s*")[1-9A-HJ-NP-Za-km-z]{32,44}("\s*,?\s*\))/,
    `$1${programId}$2`,
  ),
);

for (const relative of [
  "solana/scripts/marketlint-init.ts",
  "solana/scripts/beta-keeper.ts",
]) {
  update(relative, (s) =>
    s.replace(
      /(const PROGRAM_ID = new PublicKey\(")[1-9A-HJ-NP-Za-km-z]{32,44}("\);)/,
      `$1${programId}$2`,
    ),
  );
}

console.log(`Mary Jane program ID: ${programId}`);
