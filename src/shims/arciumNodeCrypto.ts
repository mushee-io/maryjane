// Browser-only compatibility shim for @arcium-hq/client.
//
// Mary Jane confidential orders use Arcium's RescueCipher + x25519 path, which
// relies on Web Crypto / noble primitives. The Arcium package also statically
// imports Node crypto helpers for unrelated AES/file-oriented SDK features.
// Vite still resolves those imports even when those features are tree-shaken.
//
// Keep these exports intentionally narrow. If a future browser code path starts
// using one of the unsupported Node streaming cipher/hash APIs, fail loudly
// rather than silently changing cryptographic behaviour.

export function randomBytes(size: number): Uint8Array {
  if (!Number.isInteger(size) || size < 0) throw new Error("Invalid random byte length");
  const out = new Uint8Array(size);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function unsupported(name: string): never {
  throw new Error(
    `${name} is a Node-only crypto API and is not available in the Mary Jane browser bundle. Use the Arcium RescueCipher/x25519 browser path instead.`
  );
}

export function createHash(..._args: unknown[]): never {
  return unsupported("createHash");
}

export function createCipheriv(..._args: unknown[]): never {
  return unsupported("createCipheriv");
}

export function createDecipheriv(..._args: unknown[]): never {
  return unsupported("createDecipheriv");
}
