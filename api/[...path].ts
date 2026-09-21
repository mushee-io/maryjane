import { createMaryJaneApp } from "../server";

let appPromise: ReturnType<typeof createMaryJaneApp> | null = null;

export default async function handler(req: any, res: any) {
  if (!appPromise) {
    appPromise = createMaryJaneApp({ local: false });
  }

  const app = await appPromise;
  return app(req, res);
}
