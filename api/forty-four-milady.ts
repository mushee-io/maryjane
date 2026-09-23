import express from "express";
import { Connection } from "@solana/web3.js";
import { registerFortyFourMiladyRoutes } from "../src/lib/fortyFourMiladyServer";

const app = express();
app.use(express.json({ limit: "64kb" }));
const connection = new Connection(
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  "confirmed",
);
registerFortyFourMiladyRoutes(app, connection);

export const config = {
  maxDuration: 60,
};

export default async function handler(req: any, res: any) {
  const action = String(req.query?.action || "").replace(/^\/+/, "");
  delete req.query?.action;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, String(item));
    } else if (value != null) {
      query.set(key, String(value));
    }
  }

  const suffix = query.toString();
  req.url = `/api/v1/44-milady/${action}${suffix ? `?${suffix}` : ""}`;
  return app(req, res);
}
