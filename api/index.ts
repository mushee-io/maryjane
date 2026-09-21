import { createMaryJaneApp } from "../server";

let appPromise: ReturnType<typeof createMaryJaneApp> | null = null;

export default async function handler(req: any, res: any) {
  const url = new URL(req.url || "/", "http://mary-jane.local");
  const rewrittenPath = url.searchParams.get("__path");

  if (rewrittenPath) {
    url.searchParams.delete("__path");
    const query = url.searchParams.toString();
    req.url = `/api/${rewrittenPath}${query ? `?${query}` : ""}`;
  }

  if (!appPromise) {
    appPromise = createMaryJaneApp({ local: false });
  }

  const app = await appPromise;
  return app(req, res);
}
