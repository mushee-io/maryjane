import handler from "../api/marketlint-analyze";

function makeResponse() {
  let statusCode = 200;
  let body: any;
  return {
    status(code: number) { statusCode = code; return this; },
    setHeader() { return this; },
    json(value: any) { body = value; return this; },
    read() { return { statusCode, body }; },
  };
}

const res: any = makeResponse();
await handler({
  method:"POST",
  body:{
    question:"Will SOL/USD be above $250 at 12:00 UTC on 30 November 2026?",
    description:"YES if Pyth SOL/USD is at or above $250. NO otherwise.",
    source:"Pyth Oracle · SOL/USD · target 250",
    category:"Crypto",
    deadline:"30 Nov 2026, 12:00 UTC",
    closeTs:1796039700,
    resolutionTs:1796040000,
  },
}, res);

const result = res.read();
console.log(JSON.stringify(result, null, 2));
if (result.statusCode !== 200) throw new Error("MarketLint function did not return 200");
if (!result.body?.analysis?.verdict) throw new Error("MarketLint function returned no verdict");
if (!result.body?.hashes?.marketSeed) throw new Error("MarketLint function returned no market seed");
