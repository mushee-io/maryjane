import { createMaryJaneApp } from "../server";
import orderCancelHandler from "../src/serverless/orderCancel";

let appPromise: ReturnType<typeof createMaryJaneApp> | null = null;
let miladyAppPromise: Promise<any> | null = null;

async function getMiladyApp() {
  if (!miladyAppPromise) {
    miladyAppPromise = (async () => {
      const [{ default: express }, { Connection }, { registerFortyFourMiladyRoutes }] = await Promise.all([
        import("express"),
        import("@solana/web3.js"),
        import("../src/lib/fortyFourMiladyServer"),
      ]);
      const app = express();
      app.use(express.json({ limit: "64kb" }));
      const connection = new Connection(
        process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
        "confirmed",
      );
      registerFortyFourMiladyRoutes(app, connection);
      return app;
    })();
  }
  return miladyAppPromise;
}

export const config = {
  maxDuration: 60,
};

export default async function handler(req: any, res: any) {
  const path = String(req.query?.path || "").replace(/^\/+/, "");

  if (path === "order-cancel") {
    delete req.query?.path;
    return orderCancelHandler(req, res);
  }

  delete req.query?.path;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, String(item));
    } else if (value != null) {
      query.set(key, String(value));
    }
  }

  const suffix = query.toString();
  req.url = `/api/${path}${suffix ? `?${suffix}` : ""}`;

  if (path.startsWith("v1/44-milady/")) {
    const miladyApp = await getMiladyApp();
    return miladyApp(req, res);
  }

  if (!appPromise) {
    appPromise = createMaryJaneApp({ local: false });
  }

  const app = await appPromise;
  return app(req, res);
}
