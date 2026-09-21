import { fetchExternalMarkets } from "../src/lib/marketAggregation";

const result = await fetchExternalMarkets(30);
const counts = {
  total: result.items.length,
  polymarket: result.items.filter((item) => item.source === "polymarket").length,
  manifold: result.items.filter((item) => item.source === "manifold").length,
};

console.log(JSON.stringify({ counts, errors: result.errors, sample: result.items.slice(0, 3).map((item) => ({
  source: item.source,
  title: item.title,
  probability: item.outcomes[0]?.probability,
  volume24h: item.volume24h,
})) }, null, 2));

if (counts.total === 0) {
  throw new Error(`External market feed returned zero markets: ${result.errors.join(" | ")}`);
}
