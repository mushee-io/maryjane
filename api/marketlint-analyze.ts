import { compileMarketLintReport, type MarketLintInput } from "../src/lib/marketLint";

export const config = {
  maxDuration: 10,
};

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let input = req.body as MarketLintInput;
    if (typeof req.body === "string") {
      input = JSON.parse(req.body) as MarketLintInput;
    }

    if (!input || typeof input !== "object") {
      return res.status(400).json({ error: "MarketLint input is required" });
    }

    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(input.closeTs) || !Number.isInteger(input.resolutionTs)) {
      return res.status(400).json({
        error: "MarketLint requires trading close and resolution timestamps",
      });
    }
    if (Number(input.closeTs) <= now) {
      return res.status(400).json({ error: "Trading close must be in the future" });
    }
    if (Number(input.resolutionTs) < Number(input.closeTs)) {
      return res.status(400).json({
        error: "Resolution time must be at or after the trading close time",
      });
    }

    // This endpoint is intentionally stateless and independent from Solana RPC.
    // Final market creation performs the authoritative duplicate/indexer checks again.
    const report = compileMarketLintReport(input, [], []);
    return res.status(200).json(report);
  } catch (error: any) {
    console.error("[MarketLint Analyze] failed", error);
    return res.status(400).json({
      error: error?.message || "MarketLint analysis failed",
    });
  }
}
