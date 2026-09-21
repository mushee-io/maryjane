const url = "https://maryjane-blue.vercel.app/api/discovery-feed?limit=40";
const expected = "B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF";
let last = "";

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
        process.exit(0);
      }
    }
  } catch (error) {
    console.log(`attempt ${attempt} error=${error?.message || error}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

throw new Error(`Production discovery did not expose ${expected}. Last response: ${last.slice(0, 1500)}`);
