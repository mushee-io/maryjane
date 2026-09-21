import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileCheck2,
  Fingerprint,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';

type Issue = {
  type: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
};

type SimilarMarket = {
  title: string;
  similarity: number;
  category: string;
  address?: string;
};

type Report = {
  id: string;
  createdAt: number;
  input: {
    question: string;
    description?: string;
    source?: string;
    category?: string;
    deadline?: string;
    closeTs?: number;
    resolutionTs?: number;
  };
  analysis: {
    overallScore: number;
    verdict: 'green' | 'yellow' | 'red';
    ambiguityScore: number;
    duplicateProbability: number;
    resolutionClarityScore: number;
    missingSource: boolean;
    issues: Issue[];
    contradictions: Array<{ description: string; conflictWith?: string }>;
    similarMarkets: SimilarMarket[];
    rewriteSuggestion: string;
    structuredBreakdown: Record<string, string | null>;
    resolutionSuggestions: string[];
  };
  spec: Record<string, unknown>;
  hashes: {
    marketSeed: string;
    questionHash: string;
    metadataHash: string;
    sourceHash: string;
    specHash: string;
    reportHash: string;
  };
};

const categories = ['Crypto', 'Macro', 'Sports', 'Product', 'RWA', 'Other'];

function verdictStyle(verdict: Report['analysis']['verdict']) {
  if (verdict === 'green') {
    return {
      label: 'PASS',
      icon: CheckCircle2,
      tone: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
    };
  }
  if (verdict === 'yellow') {
    return {
      label: 'FIX',
      icon: AlertTriangle,
      tone: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
    };
  }
  return {
    label: 'REJECT',
    icon: XCircle,
    tone: 'border-rose-400/20 bg-rose-400/10 text-rose-300',
  };
}

function shortHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export function MarketLintScreen() {
  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const [deadline, setDeadline] = useState('');
  const [closeAt, setCloseAt] = useState('');
  const [resolutionAt, setResolutionAt] = useState('');
  const [category, setCategory] = useState('Crypto');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const analyze = async () => {
    if (!question.trim()) {
      setError('Enter a market question first.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/v1/marketlint/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          description,
          source,
          deadline,
          category,
          closeTs: closeAt ? Math.floor(new Date(closeAt).getTime() / 1000) : undefined,
          resolutionTs: resolutionAt
            ? Math.floor(new Date(resolutionAt).getTime() / 1000)
            : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'MarketLint analysis failed');
      setReport(data);
    } catch (err: any) {
      setError(err?.message || 'MarketLint analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const useRewrite = () => {
    if (!report) return;
    setQuestion(report.analysis.rewriteSuggestion);
    setReport(null);
  };

  const copyBundle = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          spec: report.spec,
          hashes: report.hashes,
          analysis: report.analysis,
        },
        null,
        2,
      ),
    );
  };

  const visual = report ? verdictStyle(report.analysis.verdict) : null;
  const scheduleIsCertifiable = Boolean(
    report?.input.closeTs &&
      report?.input.resolutionTs &&
      report.input.closeTs > Math.floor(Date.now() / 1000) &&
      report.input.resolutionTs >= report.input.closeTs,
  );
  const isCertifiable =
    report?.analysis.verdict === 'green' && scheduleIsCertifiable;

  return (
    <div className="min-h-screen bg-[#080808] text-white">
      <header className="border-b border-white/10 bg-[#080808]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
          <div>
            <div className="text-[10px] uppercase tracking-[0.34em] text-white/35">33milady</div>
            <div className="mt-1 flex items-center gap-2 text-xl font-semibold">
              MarketLint
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] uppercase tracking-wider text-white/40">
                compiler
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <a href="/markets" className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/55 hover:text-white">
              Markets
            </a>
            <a href="/33-beta" className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/55 hover:text-white">
              33 Beta
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 md:p-8">
          <div className="flex items-center gap-2 text-sm text-white/50">
            <Sparkles className="h-4 w-4" />
            Natural language → deterministic market spec
          </div>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
            Prediction markets should begin with a good question.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/40">
            MarketLint checks ambiguity, duplicate risk, resolution clarity, source quality and deadline completeness before 33milady will certify a market for creation.
          </p>

          <div className="mt-8 space-y-4">
            <label className="block">
              <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/35">Market question</div>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={4}
                placeholder="Will SOL/USD close above $300 by 23:59 UTC on 31 December 2026, using the Pyth SOL/USD price feed?"
                className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-4 text-base outline-none placeholder:text-white/20 focus:border-white/25"
              />
            </label>

            <label className="block">
              <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/35">Description / resolution criteria</div>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                placeholder="Define edge cases, observation window and INVALID behavior."
                className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-white/20 focus:border-white/25"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label>
                <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/35">Resolution source</div>
                <input
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="Pyth SOL/USD"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-white/20"
                />
              </label>
              <label>
                <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/35">Deadline</div>
                <input
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                  placeholder="31 Dec 2026, 23:59 UTC"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-white/20"
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label>
                <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/35">Market closes</div>
                <input
                  type="datetime-local"
                  value={closeAt}
                  onChange={(event) => setCloseAt(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none"
                />
              </label>
              <label>
                <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/35">Resolution starts</div>
                <input
                  type="datetime-local"
                  value={resolutionAt}
                  onChange={(event) => setResolutionAt(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none"
                />
              </label>
            </div>

            <div>
              <div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/35">Category</div>
              <div className="flex flex-wrap gap-2">
                {categories.map((value) => (
                  <button
                    key={value}
                    onClick={() => setCategory(value)}
                    className={`rounded-full border px-3 py-1.5 text-xs ${
                      category === value
                        ? 'border-white/30 bg-white text-black'
                        : 'border-white/10 text-white/45 hover:text-white'
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={analyze}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-4 text-sm font-semibold text-black disabled:opacity-50"
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {loading ? 'Compiling market…' : 'Run MarketLint'}
            </button>

            {error && <div className="text-sm text-rose-300">{error}</div>}
          </div>

          {report && visual && (
            <div className="mt-8 border-t border-white/10 pt-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${visual.tone}`}>
                    <visual.icon className="h-4 w-4" />
                    {visual.label}
                  </div>
                  <div className="mt-4 text-5xl font-semibold">{report.analysis.overallScore}<span className="text-xl text-white/25">/100</span></div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ['Ambiguity', report.analysis.ambiguityScore],
                    ['Duplicate', report.analysis.duplicateProbability],
                    ['Resolution', report.analysis.resolutionClarityScore],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="min-w-24 rounded-xl border border-white/10 bg-black/20 p-3 text-center">
                      <div className="text-[10px] text-white/30">{String(label)}</div>
                      <div className="mt-1 text-lg font-semibold">{String(value)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {report.analysis.issues.length > 0 && (
                <div className="mt-6 space-y-2">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/35">Issues</div>
                  {report.analysis.issues.map((issue, index) => (
                    <div key={`${issue.type}-${index}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">{issue.title}</div>
                        <span className="text-[10px] uppercase text-white/30">{issue.severity}</span>
                      </div>
                      <div className="mt-1 text-xs leading-5 text-white/40">{issue.description}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-white/35">Suggested rewrite</div>
                <div className="mt-3 text-sm leading-6 text-white/70">{report.analysis.rewriteSuggestion}</div>
                <button onClick={useRewrite} className="mt-3 text-xs font-medium text-white underline underline-offset-4">
                  Use rewrite
                </button>
              </div>

              {report.analysis.similarMarkets.length > 0 && (
                <div className="mt-6">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/35">Similar markets</div>
                  <div className="mt-2 space-y-2">
                    {report.analysis.similarMarkets.map((market, index) => (
                      <div key={index} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 px-4 py-3">
                        <div className="text-xs text-white/55">{market.title}</div>
                        <div className="text-xs font-semibold">{market.similarity}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileCheck2 className="h-4 w-4" />
              Certification policy
            </div>
            <div className="mt-4 space-y-3 text-xs text-white/45">
              <div className="flex justify-between"><span>Minimum score</span><span className="text-white">80</span></div>
              <div className="flex justify-between"><span>Max duplicate risk</span><span className="text-white">60</span></div>
              <div className="flex justify-between"><span>Min resolution clarity</span><span className="text-white">70</span></div>
              <div className="flex justify-between"><span>Required verdict</span><span className="text-emerald-300">GREEN</span></div>
            </div>
            <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-3 text-[11px] leading-5 text-white/35">
              The browser never holds the MarketLint attestor key. Certification is signed by the protected server/agent service and consumed once by the Solana market factory.
            </div>
          </div>

          {report ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Fingerprint className="h-4 w-4" />
                Publish bundle
              </div>
              <div className="mt-4 space-y-3 text-xs">
                {[
                  ['Market seed', report.hashes.marketSeed],
                  ['Question', report.hashes.questionHash],
                  ['Metadata', report.hashes.metadataHash],
                  ['Spec', report.hashes.specHash],
                  ['Report', report.hashes.reportHash],
                  ['Source', report.hashes.sourceHash],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="text-white/30">{label}</div>
                    <div className="mt-1 font-mono text-[11px] text-white/65">{shortHash(value)}</div>
                  </div>
                ))}
              </div>
              <button
                onClick={copyBundle}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 py-3 text-xs text-white/60 hover:bg-white/[0.04] hover:text-white"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy publish bundle
              </button>

              <div className={`mt-4 rounded-xl border p-3 text-xs ${
                isCertifiable
                  ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                  : 'border-white/10 bg-black/20 text-white/35'
              }`}>
                {isCertifiable
                  ? 'Publish-ready. The protected attestor can certify this exact question, metadata, close time and resolution time.'
                  : report.analysis.verdict !== 'green'
                    ? 'Not certifiable yet. Fix the flagged MarketLint issues and compile again.'
                    : 'Lint PASS, but certification still needs a future market close time and a resolution time at or after close.'}
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/10 p-5 text-sm leading-6 text-white/30">
              Run MarketLint to generate a deterministic market spec and its onchain certification hashes.
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

export default MarketLintScreen;
