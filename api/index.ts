import { createHash } from "node:crypto";
import { createMaryJaneApp } from "../server";

let appPromise: ReturnType<typeof createMaryJaneApp> | null = null;

export const config = {
  maxDuration: 60,
};

function readCloudinaryConfig() {
  let cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "kbuxvbsa").trim();
  let apiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
  let apiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();

  const cloudinaryUrl = String(process.env.CLOUDINARY_URL || "").trim();
  if (cloudinaryUrl) {
    try {
      const parsed = new URL(cloudinaryUrl);
      if (parsed.protocol === "cloudinary:") {
        apiKey = decodeURIComponent(parsed.username || apiKey);
        apiSecret = decodeURIComponent(parsed.password || apiSecret);
        cloudName = parsed.hostname || cloudName;
      }
    } catch {
      // Fall through to explicit environment variables.
    }
  }

  const uploadPreset = String(process.env.CLOUDINARY_UPLOAD_PRESET || "ml_default").trim();
  return { cloudName, apiKey, apiSecret, uploadPreset };
}

function handleCloudinarySignature(req: any, res: any) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { cloudName, apiKey, apiSecret, uploadPreset } = readCloudinaryConfig();
  if (!cloudName || !apiKey || !apiSecret || !uploadPreset) {
    return res.status(503).json({
      error: "Signed Cloudinary upload fallback is not configured.",
      configured: false,
    });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = `timestamp=${timestamp}&upload_preset=${uploadPreset}`;
  const signature = createHash("sha1")
    .update(`${paramsToSign}${apiSecret}`)
    .digest("hex");

  return res.status(200).json({
    configured: true,
    cloudName,
    apiKey,
    timestamp,
    signature,
    uploadPreset,
  });
}

export default async function handler(req: any, res: any) {
  const path = String(req.query?.path || "").replace(/^\/+/, "");

  // Keep Cloudinary signing inside the existing catch-all API function so the
  // project remains within Vercel Hobby's 12 Serverless Function limit.
  if (path === "cloudinary-signature") {
    return handleCloudinarySignature(req, res);
  }

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
