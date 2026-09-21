import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type MarketLintVerdict = "green" | "yellow" | "red";

export type MarketLintIssue = {
  type: "ambiguity" | "duplicate" | "contradiction" | "clarity" | "source" | "deadline";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
};

export type MarketLintContradiction = {
  description: string;
  conflictWith?: string;
};

export type MarketLintSimilarMarket = {
  title: string;
  similarity: number;
  category: string;
  address?: string;
};

export type MarketLintStructuredBreakdown = {
  subject: string | null;
  metric: string | null;
  threshold: string | null;
  source: string | null;
  deadline: string | null;
  marketType: string | null;
};

export type MarketLintAnalysisResult = {
  overallScore: number;
  verdict: MarketLintVerdict;
  ambiguityScore: number;
  duplicateProbability: number;
  resolutionClarityScore: number;
  missingSource: boolean;
  issues: MarketLintIssue[];
  contradictions: MarketLintContradiction[];
  similarMarkets: MarketLintSimilarMarket[];
  rewriteSuggestion: string;
  structuredBreakdown: MarketLintStructuredBreakdown;
  resolutionSuggestions: string[];
};

export type MarketLintInput = {
  question: string;
  description?: string;
  source?: string;
  category?: string;
  deadline?: string;
  closeTs?: number;
  resolutionTs?: number;
};

export type MarketLintSpec = {
  version: "33milady-market-spec-v1";
  question: string;
  description: string;
  source: string;
  category: string;
  deadline: string;
  marketType: "binary";
  outcomes: ["YES", "NO"];
  closeTs: number | null;
  resolutionTs: number | null;
  resolutionPolicy: {
    sourceRequired: true;
    source: string;
    deadline: string;
    fallback: "INVALID_IF_SOURCE_UNAVAILABLE";
  };
};

export type MarketLintCompiledReport = {
  id: string;
  createdAt: number;
  certifiedAt?: number;
  input: MarketLintInput;
  analysis: MarketLintAnalysisResult;
  spec: MarketLintSpec;
  hashes: {
    marketSeed: string;
    questionHash: string;
    metadataHash: string;
    sourceHash: string;
    specHash: string;
    reportHash: string;
  };
};

type PriorMarket = {
  questionHash: string;
  address?: string;
  title?: string;
  category?: string;
};

const AMBIGUITY_TERMS = [
  "soon",
  "pump",
  "crash",
  "big",
  "huge",
  "win",
  "fail",
  "moon",
  "likely",
  "major",
  "significant",
  "shortly",
  "quickly",
  "rapidly",
  "imminent",
  "spike",
  "dump",
  "surge",
  "tank",
  "eventually",
  "sometime",
  "anytime",
  "much",
  "many",
  "few",
  "some",
  "more",
  "less",
];

function sha256Hex(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`);
  return `{${entries.join(",")}}`;
}

function validateInputLimits(input: MarketLintInput) {
  const limits: Array<[string, string | undefined, number]> = [
    ["question", input.question, 512],
    ["description", input.description, 4096],
    ["source", input.source, 512],
    ["category", input.category, 64],
    ["deadline", input.deadline, 160],
  ];

  for (const [field, value, max] of limits) {
    if ((value || "").length > max) {
      throw new Error(`${field} exceeds MarketLint maximum length of ${max}`);
    }
  }
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizedQuestion(value: string) {
  return normalizeText(value);
}

function questionHash(question: string) {
  return sha256Hex(normalizedQuestion(question));
}

function metadataPayload(input: MarketLintInput) {
  return {
    description: normalizeText(input.description || ""),
    source: normalizeText(input.source || ""),
    category: normalizeText(input.category || ""),
    deadline: normalizeText(input.deadline || ""),
  };
}

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9$%.]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

function similarity(a: string, b: string) {
  const aa = tokenize(a);
  const bb = tokenize(b);
  if (aa.size === 0 || bb.size === 0) return 0;
  let overlap = 0;
  for (const token of aa) {
    if (bb.has(token)) overlap += 1;
  }
  return overlap / Math.max(aa.size, bb.size);
}

function detectAmbiguityTerms(text: string) {
  const lower = text.toLowerCase();
  return AMBIGUITY_TERMS.filter((term) =>
    new RegExp(`\\b${term}\\b`, "i").test(lower),
  );
}

function hasDeadline(text: string, explicit?: string) {
  if (explicit && explicit.trim().length >= 4) return true;
  return /(\d{4}-\d{2}-\d{2}|\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b.{0,12}\d{4}|q[1-4]\s*\d{4}|by\s+\d{4}|before\s+\d{4}|23:59\s*utc|end of \d{4})/i.test(
    text,
  );
}

function hasSource(text: string, explicit?: string) {
  if (explicit && explicit.trim().length > 2) return true;
  return /(binance|coinbase|pyth|reuters|bloomberg|bbc|ap news|sec|federal reserve|fed|ecb|official release|official website|according to|reported by|per\s+[a-z])/i.test(
    text,
  );
}

function hasSpecificMetric(text: string) {
  return /(\$[\d,.]+|[\d,.]+%|above|below|exceed|under|over|at least|more than|less than|equal to|close at|close above|close below|reach\s+\d)/i.test(
    text,
  );
}

function extractStructure(input: MarketLintInput): MarketLintStructuredBreakdown {
  const combined = `${input.question} ${input.description || ""}`;
  const subject =
    combined.match(/\b(BTC|ETH|SOL|XRP|bitcoin|ethereum|solana|S&P|federal reserve|fed|apple|tesla|nvidia|openai|gpt|gold|oil|nasdaq)\b/i)?.[0] ??
    null;
  const metric =
    combined.match(/\b(close above|close below|exceed|reach|fall below|drop below|price|market cap|sales|interest rate|inflation|volume)\b/i)?.[0] ??
    null;
  const threshold =
    combined.match(/(\$[\d,]+(?:\.\d+)?(?:k|m|b|t)?|[\d.]+%|\d+\s*points?|\d+,\d+\s+units?)/i)?.[0] ??
    null;

  return {
    subject,
    metric,
    threshold,
    source: input.source?.trim() || null,
    deadline: input.deadline?.trim() || null,
    marketType: "binary",
  };
}

function generateRewrite(input: MarketLintInput, structure: MarketLintStructuredBreakdown) {
  const subject = structure.subject || "[subject]";
  const metric = structure.metric || "metric";
  const threshold = structure.threshold || "[specific threshold]";
  const source = input.source?.trim() || "[trusted source]";
  const deadline = input.deadline?.trim() || "[specific date and UTC time]";
  return `Will ${subject} ${metric} ${threshold} by ${deadline}, as determined by ${source}?`;
}

function sameMarketLintInput(a: MarketLintInput, b: MarketLintInput) {
  return (
    normalizeText(a.question || "") === normalizeText(b.question || "") &&
    normalizeText(a.description || "") === normalizeText(b.description || "") &&
    normalizeText(a.source || "") === normalizeText(b.source || "") &&
    normalizeText(a.category || "") === normalizeText(b.category || "") &&
    normalizeText(a.deadline || "") === normalizeText(b.deadline || "") &&
    a.closeTs === b.closeTs &&
    a.resolutionTs === b.resolutionTs
  );
}

function scoreDuplicates(
  input: MarketLintInput,
  qHash: string,
  priorMarkets: PriorMarket[],
  priorReports: MarketLintCompiledReport[],
) {
  const question = normalizedQuestion(input.question || "");
  const similar: MarketLintSimilarMarket[] = [];
  let probability = 0;

  for (const market of priorMarkets) {
    if (market.questionHash === qHash) {
      probability = 100;
      similar.push({
        title: market.title || `Onchain market ${market.address || qHash.slice(0, 10)}`,
        similarity: 100,
        category: market.category || "onchain",
        address: market.address,
      });
    }
  }

  for (const report of priorReports) {
    if (!report.certifiedAt) continue;
    if (sameMarketLintInput(input, report.input)) continue;
    const value = Math.round(similarity(question, report.input.question) * 100);
    if (value <= 10) continue;
    probability = Math.max(probability, value);
    similar.push({
      title: report.input.question,
      similarity: value,
      category: report.input.category || "marketlint",
    });
  }

  similar.sort((a, b) => b.similarity - a.similarity);
  return {
    duplicateProbability: probability,
    similarMarkets: similar.slice(0, 5),
  };
}

export function analyzeMarketLint(
  input: MarketLintInput,
  priorMarkets: PriorMarket[] = [],
  priorReports: MarketLintCompiledReport[] = [],
): MarketLintAnalysisResult {
  validateInputLimits(input);
  const question = normalizedQuestion(input.question || "");
  if (!question) throw new Error("Question is required");

  const combined = `${question} ${input.description || ""}`;
  const ambiguousTerms = detectAmbiguityTerms(combined);
  const deadlinePresent = hasDeadline(combined, input.deadline);
  const sourcePresent = hasSource(combined, input.source);
  const metricPresent = hasSpecificMetric(question);
  const duplicate = scoreDuplicates(
    input,
    questionHash(question),
    priorMarkets,
    priorReports,
  );

  const ambiguityScore = Math.min(
    100,
    ambiguousTerms.length * 22 + (metricPresent ? 0 : 25),
  );
  const clarityPenalty = ambiguousTerms.length * 12;
  const deadlinePenalty = deadlinePresent ? 0 : 20;
  const sourcePenalty = sourcePresent ? 0 : 15;
  const metricPenalty = metricPresent ? 0 : 20;
  const duplicatePenalty = duplicate.duplicateProbability > 60 ? 10 : 0;

  const overallScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          clarityPenalty -
          deadlinePenalty -
          sourcePenalty -
          metricPenalty -
          duplicatePenalty,
      ),
    ),
  );

  const resolutionClarityScore = Math.max(
    0,
    Math.min(
      100,
      100 -
        (deadlinePresent ? 0 : 30) -
        (sourcePresent ? 0 : 25) -
        (metricPresent ? 0 : 20),
    ),
  );

  const issues: MarketLintIssue[] = [];
  if (ambiguousTerms.length > 0) {
    issues.push({
      type: "ambiguity",
      severity: ambiguousTerms.length >= 3 ? "high" : "medium",
      title: "Ambiguous language detected",
      description: `Found vague terms: "${ambiguousTerms.slice(0, 4).join('", "')}"`,
    });
  }
  if (!deadlinePresent) {
    issues.push({
      type: "deadline",
      severity: "high",
      title: "No resolution deadline",
      description: "Add a specific date and UTC time so the market can close deterministically.",
    });
  }
  if (!sourcePresent) {
    issues.push({
      type: "source",
      severity: "medium",
      title: "No trusted source specified",
      description: "Name the exact source or oracle used to resolve the outcome.",
    });
  }
  if (!metricPresent) {
    issues.push({
      type: "clarity",
      severity: "high",
      title: "Missing specific metric",
      description: "Specify an exact threshold or binary event that can be objectively checked.",
    });
  }
  if (duplicate.duplicateProbability > 60) {
    issues.push({
      type: "duplicate",
      severity: duplicate.duplicateProbability === 100 ? "high" : "medium",
      title: "Potential duplicate market",
      description: `${duplicate.duplicateProbability}% similarity to an existing or previously compiled market.`,
    });
  }

  const contradictions: MarketLintContradiction[] = [];
  if (/\bnot\b.+\band\b.+\bnot\b/i.test(question)) {
    contradictions.push({
      description: "Double-negative structure may produce an ambiguous YES/NO interpretation.",
    });
  }
  if (duplicate.duplicateProbability >= 90 && duplicate.similarMarkets[0]) {
    contradictions.push({
      description: `Near-duplicate of "${duplicate.similarMarkets[0].title}"`,
      conflictWith: duplicate.similarMarkets[0].title,
    });
  }

  const verdict: MarketLintVerdict =
    overallScore >= 80 &&
    resolutionClarityScore >= 70 &&
    duplicate.duplicateProbability <= 60
      ? "green"
      : overallScore >= 55
        ? "yellow"
        : "red";

  const structuredBreakdown = extractStructure(input);
  const resolutionSuggestions: string[] = [];
  if (!deadlinePresent) resolutionSuggestions.push("Add a precise resolution deadline in UTC.");
  if (!sourcePresent) resolutionSuggestions.push("Name a trusted source or oracle.");
  if (!metricPresent) resolutionSuggestions.push("Add an exact threshold or objectively verifiable event.");
  if (ambiguousTerms.length > 0) {
    resolutionSuggestions.push(
      `Replace vague terms: "${ambiguousTerms.slice(0, 3).join('", "')}"`,
    );
  }
  resolutionSuggestions.push("Define INVALID behavior if the source is unavailable or contradictory.");

  return {
    overallScore,
    verdict,
    ambiguityScore,
    duplicateProbability: duplicate.duplicateProbability,
    resolutionClarityScore,
    missingSource: !sourcePresent,
    issues,
    contradictions,
    similarMarkets: duplicate.similarMarkets,
    rewriteSuggestion: generateRewrite(input, structuredBreakdown),
    structuredBreakdown,
    resolutionSuggestions: resolutionSuggestions.slice(0, 5),
  };
}

export function compileMarketLintReport(
  input: MarketLintInput,
  priorMarkets: PriorMarket[] = [],
  priorReports: MarketLintCompiledReport[] = [],
): MarketLintCompiledReport {
  validateInputLimits(input);
  const normalizedInput: MarketLintInput = {
    question: normalizedQuestion(input.question),
    description: normalizeText(input.description || ""),
    source: normalizeText(input.source || ""),
    category: normalizeText(input.category || ""),
    deadline: normalizeText(input.deadline || ""),
    closeTs: input.closeTs,
    resolutionTs: input.resolutionTs,
  };

  const analysis = analyzeMarketLint(normalizedInput, priorMarkets, priorReports);
  const spec: MarketLintSpec = {
    version: "33milady-market-spec-v1",
    question: normalizedInput.question,
    description: normalizedInput.description || "",
    source: normalizedInput.source || "",
    category: normalizedInput.category || "",
    deadline: normalizedInput.deadline || "",
    marketType: "binary",
    outcomes: ["YES", "NO"],
    closeTs: normalizedInput.closeTs ?? null,
    resolutionTs: normalizedInput.resolutionTs ?? null,
    resolutionPolicy: {
      sourceRequired: true,
      source: normalizedInput.source || "",
      deadline: normalizedInput.deadline || "",
      fallback: "INVALID_IF_SOURCE_UNAVAILABLE",
    },
  };

  const qHash = questionHash(normalizedInput.question);
  const metadataHash = sha256Hex(canonicalize(metadataPayload(normalizedInput)));
  const sourceHash = sha256Hex(normalizedInput.source || "");
  const specHash = sha256Hex(canonicalize(spec));
  const marketSeed = sha256Hex(
    `33milady:market:${qHash}:${normalizedInput.closeTs ?? normalizedInput.deadline ?? ""}`,
  );
  const reportBody = {
    analysis,
    spec,
    hashes: {
      marketSeed,
      questionHash: qHash,
      metadataHash,
      sourceHash,
      specHash,
    },
  };
  const reportHash = sha256Hex(canonicalize(reportBody));

  return {
    id: reportHash,
    createdAt: Date.now(),
    input: normalizedInput,
    analysis,
    spec,
    hashes: {
      marketSeed,
      questionHash: qHash,
      metadataHash,
      sourceHash,
      specHash,
      reportHash,
    },
  };
}

export class MarketLintReportStore {
  private reports: MarketLintCompiledReport[] = [];

  constructor(
    private readonly filePath = path.join(process.cwd(), "data", "marketlint-reports.json"),
  ) {
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (Array.isArray(parsed)) this.reports = parsed;
    } catch (error) {
      console.warn("[MarketLint] failed to load report store", error);
    }
  }

  private save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.reports.slice(-5000), null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }

  list(limit = 100) {
    return this.reports.slice(-Math.min(500, Math.max(1, limit))).reverse();
  }

  get(reportHash: string) {
    return this.reports.find((report) => report.hashes.reportHash === reportHash) ?? null;
  }

  upsert(report: MarketLintCompiledReport) {
    const existing = this.reports.findIndex(
      (item) => item.hashes.reportHash === report.hashes.reportHash,
    );
    if (existing >= 0) this.reports[existing] = report;
    else this.reports.push(report);
    this.save();
    return report;
  }
}

export function hex32(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error("Expected a 32-byte hex value");
  }
  return Buffer.from(value, "hex");
}

export function canonicalMarketLintJson(value: unknown) {
  return canonicalize(value);
}

export type { PriorMarket };
