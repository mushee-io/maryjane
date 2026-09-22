import { createHash } from "node:crypto";

function readCloudinaryConfig() {
  let cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "kbuxvbsa").trim();
  let apiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
  let apiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();

  const cloudinaryUrl = String(process.env.CLOUDINARY_URL || "").trim();
  if (cloudinaryUrl) {
    const match = cloudinaryUrl.match(/^cloudinary:\/\/([^:]+):(.+)@([^/]+)\/?$/);
    if (match) {
      apiKey = decodeURIComponent(match[1] || apiKey);
      apiSecret = decodeURIComponent(match[2] || apiSecret);
      cloudName = decodeURIComponent(match[3] || cloudName);
    }
  }

  const uploadPreset = String(process.env.CLOUDINARY_UPLOAD_PRESET || "ml_default").trim();
  return { cloudName, apiKey, apiSecret, uploadPreset };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { cloudName, apiKey, apiSecret, uploadPreset } = readCloudinaryConfig();

    if (!cloudName || !apiKey || !apiSecret || !uploadPreset) {
      return res.status(503).json({
        error: "Cloudinary credentials are missing. Set CLOUDINARY_URL in Vercel and redeploy.",
      });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = `timestamp=${timestamp}&upload_preset=${uploadPreset}`;
    const signature = createHash("sha1")
      .update(`${paramsToSign}${apiSecret}`)
      .digest("hex");

    return res.status(200).json({
      cloudName,
      apiKey,
      timestamp,
      signature,
      uploadPreset,
    });
  } catch (error: any) {
    console.error("[cloudinary-signature]", error?.message || error);
    return res.status(500).json({
      error: error?.message || "Unable to prepare Cloudinary upload.",
    });
  }
}
