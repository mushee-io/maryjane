import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function findPackageJsonFromEntry(entry, expectedName) {
  let dir = path.dirname(entry);
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
        if (pkg.name === expectedName) return { path: candidate, pkg };
      } catch {}
    }
    dir = path.dirname(dir);
  }
  throw new Error(`Unable to locate package.json for ${expectedName} from ${entry}`);
}

function resolvedPackage(name, fromRequire = require) {
  const entry = fromRequire.resolve(name);
  return findPackageJsonFromEntry(entry, name);
}

const web3 = resolvedPackage("@solana/web3.js");
const rpc = resolvedPackage("rpc-websockets");
const rpcRequire = createRequire(rpc.path);
const uuid = resolvedPackage("uuid", rpcRequire);

const result = {
  web3: web3.pkg.version,
  rpcWebsockets: rpc.pkg.version,
  rpcNestedUuid: uuid.pkg.version,
};

console.log("[solana-deps]", JSON.stringify(result));

if (rpc.pkg.version !== "9.3.2") {
  throw new Error(`Unsafe rpc-websockets version resolved: ${rpc.pkg.version}; expected 9.3.2`);
}
if (uuid.pkg.version !== "8.3.2") {
  throw new Error(`Unsafe uuid version resolved under rpc-websockets: ${uuid.pkg.version}; expected 8.3.2`);
}

await import("@solana/web3.js");
console.log("[solana-deps] runtime import PASS");
