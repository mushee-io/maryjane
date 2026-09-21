import fs from "node:fs";
import path from "node:path";

const programId = process.argv[2]?.trim();
if (!programId) {
  console.error("Usage: node scripts/sync-program-id.mjs <PROGRAM_ID>");
  process.exit(1);
}

const root = process.cwd();
const files = [
  "server.ts",
  "solana/Anchor.toml",
  "solana/programs/milady_market/src/lib.rs",
  "solana/sdk/src/index.ts",
  "solana/scripts/marketlint-init.ts",
  "solana/scripts/beta-keeper.ts",
];

const patterns = [
  /9tELwXSuJCP5vNrvBfo1PxGorDbMCGBQBEcsWTJtpHMy/g,
  /declare_id!\("[1-9A-HJ-NP-Za-km-z]{32,44}"\)/g,
];

for (const relative of files) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;

  let content = fs.readFileSync(file, "utf8");
  content = content.replace(patterns[0], programId);

  if (relative.endsWith("lib.rs")) {
    content = content.replace(
      /declare_id!\("[1-9A-HJ-NP-Za-km-z]{32,44}"\)/,
      `declare_id!("${programId}")`,
    );
  }

  if (relative.endsWith("Anchor.toml")) {
    content = content.replace(
      /milady_market = "[1-9A-HJ-NP-Za-km-z]{32,44}"/g,
      `milady_market = "${programId}"`,
    );
  }

  fs.writeFileSync(file, content);
  console.log(`synced ${relative}`);
}

console.log(`Mary Jane program ID: ${programId}`);
