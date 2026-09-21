import { createHash } from "node:crypto";

type Verdict = "green" | "yellow" | "red";
type Input = {
  question?: string;
  description?: string;
  source?: string;
  category?: string;
  deadline?: string;
  closeTs?: number;
  resolutionTs?: number;
};

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalize(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function analyze(input: Input) {
  const question = normalize(input.question);
  const description = normalize(input.description);
  const source = normalize(input.source);
  const deadline = normalize(input.deadline);
  const combined = `${question} ${description}`.toLowerCase();

  if (!question) throw new Error("Question is required");
  if (question.length > 512) throw new Error("Question is too long");
  if (description.length > 4096) throw new Error("Resolution rules are too long");
  if (!Number.isInteger(input.closeTs) || !Number.isInteger(input.resolutionTs)) {
    throw new Error("Trading close and resolution time are required");
  }

  const now = Math.floor(Date.now() / 1000);
  if (Number(input.closeTs) <= now) throw new Error("Trading close must be in the future");
  if (Number(input.resolutionTs) < Number(input.closeTs)) {
    throw new Error("Resolution time must be at or after the trading close time");
  }

  const ambiguousWords = [
    "soon","pump","crash","big","huge","likely","major","significant",
    "quickly","rapidly","eventually","sometime","anytime","much","many",
  ].filter((word) => new RegExp(`\\b${word}\\b`, "i").test(combined));

  const hasSource = source.length > 2 || /(pyth|coinbase|binance|reuters|bloomberg|official)/i.test(combined);
  const hasMetric = /(\$[\d,.]+|[\d,.]+%|above|below|exceed|under|over|at least|more than|less than|equal to|close at|reach\s+\d)/i.test(question);
  const hasDeadline = deadline.length >= 4 || /(\d{4}|utc|january|february|march|april|may|june|july|august|september|october|november|december)/i.test(combined);

  const issues: any[] = [];
  if (ambiguousWords.length) issues.push({ type:"ambiguity", severity:"medium", title:"Ambiguous language detected", description:`Replace vague terms: ${ambiguousWords.slice(0,4).join(", ")}` });
  if (!hasSource) issues.push({ type:"source", severity:"medium", title:"No trusted source specified", description:"Name the exact oracle or public source used for resolution." });
  if (!hasMetric) issues.push({ type:"clarity", severity:"high", title:"Missing specific metric", description:"Specify an exact threshold or objectively verifiable event." });
  if (!hasDeadline) issues.push({ type:"deadline", severity:"high", title:"No resolution deadline", description:"Add a specific date and UTC time." });

  const ambiguityScore = Math.min(100, ambiguousWords.length * 22 + (hasMetric ? 0 : 25));
  const resolutionClarityScore = Math.max(0, 100 - (hasDeadline ? 0 : 30) - (hasSource ? 0 : 25) - (hasMetric ? 0 : 20));
  const overallScore = Math.max(0, Math.min(100, 100 - ambiguousWords.length * 12 - (hasDeadline ? 0 : 20) - (hasSource ? 0 : 15) - (hasMetric ? 0 : 20)));
  const verdict: Verdict = overallScore >= 80 && resolutionClarityScore >= 70 ? "green" : overallScore >= 55 ? "yellow" : "red";

  const normalizedInput = {
    question,
    description,
    source,
    category: normalize(input.category),
    deadline,
    closeTs: Number(input.closeTs),
    resolutionTs: Number(input.resolutionTs),
  };

  const questionHash = sha(question);
  const marketSeed = sha(`33milady:market:${questionHash}:${normalizedInput.closeTs}`);
  const metadataHash = sha(JSON.stringify({
    description: normalizedInput.description,
    source: normalizedInput.source,
    category: normalizedInput.category,
    deadline: normalizedInput.deadline,
  }));
  const sourceHash = sha(normalizedInput.source);
  const spec = {
    version:"33milady-market-spec-v1",
    question,
    description,
    source,
    category: normalizedInput.category,
    deadline,
    marketType:"binary",
    outcomes:["YES","NO"],
    closeTs: normalizedInput.closeTs,
    resolutionTs: normalizedInput.resolutionTs,
    resolutionPolicy:{ sourceRequired:true, source, deadline, fallback:"INVALID_IF_SOURCE_UNAVAILABLE" },
  };
  const specHash = sha(JSON.stringify(spec));
  const analysis = {
    overallScore,
    verdict,
    ambiguityScore,
    duplicateProbability:0,
    resolutionClarityScore,
    missingSource:!hasSource,
    issues,
    contradictions:[],
    similarMarkets:[],
    rewriteSuggestion: question,
    structuredBreakdown:{
      subject: question.match(/\b(BTC|ETH|SOL|bitcoin|ethereum|solana)\b/i)?.[0] ?? null,
      metric: question.match(/\b(above|below|exceed|reach|price|close)\b/i)?.[0] ?? null,
      threshold: question.match(/\$[\d,.]+(?:\.\d+)?|[\d.]+%/)?.[0] ?? null,
      source: source || null,
      deadline: deadline || null,
      marketType:"binary",
    },
    resolutionSuggestions: issues.map((issue) => issue.description).slice(0,5),
  };
  const reportHash = sha(JSON.stringify({analysis,spec,marketSeed,questionHash,metadataHash,sourceHash,specHash}));

  return {
    id: reportHash,
    createdAt: Date.now(),
    input: normalizedInput,
    analysis,
    spec,
    hashes:{ marketSeed, questionHash, metadataHash, sourceHash, specHash, reportHash },
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({ status:"ok", service:"mary-jane-marketlint", runtime:"standalone" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error:"Method not allowed" });
  }

  try {
    const input = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    return res.status(200).json(analyze(input || {}));
  } catch (error: any) {
    return res.status(400).json({ error:error?.message || "MarketLint analysis failed" });
  }
}
