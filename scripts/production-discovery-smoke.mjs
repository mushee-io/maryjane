const url = "https://maryjane-blue.vercel.app/api/discovery-feed?limit=40";
const expected = "B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF";
let last = "";
let discoveryPassed = false;

for (let attempt = 1; attempt <= 18; attempt++) {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "MaryJane-CI/production-smoke" },
      cache: "no-store",
    });
    last = await response.text();
    console.log(`attempt ${attempt} status=${response.status} body=${last.slice(0, 1200)}`);
    if (response.ok) {
      const data = JSON.parse(last);
      const item = (data.items || []).find(
        (market) => market.nativeAddress === expected || market.sourceMarketId === expected,
      );
      if (item) {
        console.log(JSON.stringify({
          productionDiscovery: "PASS",
          native: data.sources?.maryjane,
          external: (data.sources?.polymarket || 0) + (data.sources?.manifold || 0),
          market: item.title,
          address: expected,
        }, null, 2));
        discoveryPassed = true;
        break;
      }
    }
  } catch (error) {
    console.log(`attempt ${attempt} error=${error?.message || error}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

if (!discoveryPassed) {
  throw new Error(`Production discovery did not expose ${expected}. Last response: ${last.slice(0, 1500)}`);
}

let analyticsPassed = false;
for (let attempt = 1; attempt <= 18; attempt++) {
  const response = await fetch("https://maryjane-blue.vercel.app/api/analytics-feed?limit=100", {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  const text = response ? await response.text() : "";
  console.log(`analytics attempt ${attempt} status=${response?.status || 0} body=${text.slice(0, 500)}`);
  if (response?.ok) {
    let data;
    try { data = JSON.parse(text); } catch {}
    if (data?.analytics?.totalMarkets >= 1 && Array.isArray(data?.markets) && data.markets.length >= 1) {
      console.log(JSON.stringify({ productionAnalytics: "PASS", markets: data.analytics.totalMarkets }));
      analyticsPassed = true;
      break;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 10000));
}
if (!analyticsPassed) throw new Error("production analytics feed did not expose native markets");


const knownMarket = "B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF";
let lifecyclePassed = false;
for (let attempt = 1; attempt <= 18; attempt++) {
  const response = await fetch(`https://maryjane-blue.vercel.app/api/market-action?market=${knownMarket}`, {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  const body = response ? await response.text() : "";
  console.log(`lifecycle attempt ${attempt} status=${response?.status || 0} body=${body.slice(0, 500)}`);
  if (response?.ok) {
    try {
      const data = JSON.parse(body);
      if (data?.market?.address === knownMarket && data?.resolutionConfig?.address) {
        console.log(JSON.stringify({ productionMarketAction: "PASS", status: data.market.status }));
        lifecyclePassed = true;
        break;
      }
    } catch {}
  }
  await new Promise((resolve) => setTimeout(resolve, 10000));
}
if (!lifecyclePassed) throw new Error("production lifecycle endpoint did not become healthy");

let portfolioPassed = false;
for (let attempt = 1; attempt <= 12; attempt++) {
  const response = await fetch(`https://maryjane-blue.vercel.app/api/trader-state?wallet=${knownMarket}`, {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  const body = response ? await response.text() : "";
  console.log(`portfolio attempt ${attempt} status=${response?.status || 0} body=${body.slice(0, 500)}`);
  if (response?.ok) {
    try {
      const data = JSON.parse(body);
      if (data?.wallet === knownMarket && Array.isArray(data?.positions) && Array.isArray(data?.openOrders) && Array.isArray(data?.history)) {
        console.log(JSON.stringify({ productionPortfolio: "PASS", positions: data.positions.length }));
        portfolioPassed = true;
        break;
      }
    } catch {}
  }
  await new Promise((resolve) => setTimeout(resolve, 10000));
}
if (!portfolioPassed) throw new Error("production portfolio endpoint did not become healthy");
