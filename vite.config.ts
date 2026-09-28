import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "crypto": path.resolve(__dirname, "src/shims/arciumNodeCrypto.ts"),
      "node:crypto": path.resolve(__dirname, "src/shims/arciumNodeCrypto.ts"),
      "fs": path.resolve(__dirname, "src/shims/arciumFs.ts"),
      "node:fs": path.resolve(__dirname, "src/shims/arciumFs.ts"),
    },
  },
});
