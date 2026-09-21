import assert from "node:assert/strict";
import { MiladyDataClient } from "../sdk/src/dataClient.js";

const seen: string[] = [];

const fakeFetch = async (input: string) => {
  seen.push(input);
  return {
    ok: true,
    status: 200,
    async json() {
      return { ok: true, url: input };
    },
  };
};

const client = new MiladyDataClient("https://example.test/", fakeFetch);

const markets = await client.listMarkets({
  q: "abc",
  status: "OPEN",
  sort: "liquidity",
  limit: 20,
  offset: 10,
});
assert.equal(markets.ok, true);
assert.match(seen[0], /^https:\/\/example\.test\/api\/v1\/markets\?/);
assert.match(seen[0], /q=abc/);
assert.match(seen[0], /status=OPEN/);
assert.match(seen[0], /sort=liquidity/);
assert.match(seen[0], /limit=20/);
assert.match(seen[0], /offset=10/);

await client.marketChart("market/address", "7d");
assert.equal(
  seen[1],
  "https://example.test/api/v1/markets/market%2Faddress/chart?range=7d",
);

await client.events({ market: "m1", type: "TradeExecuted", limit: 9 });
assert.match(seen[2], /market=m1/);
assert.match(seen[2], /type=TradeExecuted/);
assert.match(seen[2], /limit=9/);

let messageHandler: ((event: any) => void) | undefined;
let openedUrl = "";
const socket = client.connectRealtime(
  (payload) => {
    assert.equal(payload.kind, "market");
    assert.equal(payload.market.address, "abc");
  },
  (url) => {
    openedUrl = url;
    return {
      close() {},
      addEventListener(type, listener) {
        if (type === "message") messageHandler = listener;
      },
    };
  },
);

assert.equal(openedUrl, "wss://example.test/ws/markets");
assert.ok(socket);
assert.ok(messageHandler);
messageHandler?.({ data: JSON.stringify({ kind: "market", market: { address: "abc" } }) });

console.log("MILESTONE 8 DATA CLIENT TESTS: PASS");
