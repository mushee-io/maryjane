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
