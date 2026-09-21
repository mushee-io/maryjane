import { createMaryJaneApp } from "../server";

let appPromise: ReturnType<typeof createMaryJaneApp> | null = null;

export const config = {
  maxDuration: 60,
};

export default async function handler(req: any, res: any) {
  const path = String(req.query?.path || "").replace(/^\/+/, "");
  const original = new URL(req.url || "/api", "http://mary-jane.local");

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

  if (!appPromise) {
    appPromise = createMaryJaneApp({ local: false });
  }

  const app = await appPromise;
  return app(req, res);
}
