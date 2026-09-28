// Browser-only compatibility shim for @arcium-hq/client.
//
// Circuit upload / filesystem helpers belong in deployment tooling, never in the
// Mary Jane browser. These named exports only allow Vite to tree-shake those
// Node-only SDK branches. If invoked, they fail explicitly.

function unsupported(name: string): never {
  throw new Error(`${name} is unavailable in the browser. Run Arcium deployment tooling from Node/CLI.`);
}

export function readFileSync(..._args: unknown[]): never {
  return unsupported("readFileSync");
}

export function writeFileSync(..._args: unknown[]): never {
  return unsupported("writeFileSync");
}

export function existsSync(..._args: unknown[]): false {
  return false;
}

const fs = { readFileSync, writeFileSync, existsSync };
export default fs;
