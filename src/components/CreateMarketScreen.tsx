import React, { useState } from "react";
import { CheckCircle2, ExternalLink, Image as ImageIcon, Loader2, Rocket, ShieldCheck, UploadCloud, Wallet, X } from "lucide-react";
import { Connection, Transaction } from "@solana/web3.js";

const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "kbuxvbsa";
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "ml_default";

function provider() { return (window as any).solana; }
function fromBase64(value: string) { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function toUnix(value: string) {
  if (!value) return NaN;
  return Math.floor(new Date(`${value}:00Z`).getTime() / 1000);
}

function responseErrorMessage(data: any, status: number) {
  if (typeof data?.error === "string" && data.error.trim()) return data.error;
  if (typeof data?.error?.message === "string" && data.error.message.trim()) return data.error.message;
  if (typeof data?.message === "string" && data.message.trim()) return data.message;
  return `Request failed (${status})`;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  let data: any = {};
  if (text) {
    try { data = JSON.parse(text); }
    catch {
      const preview = text.replace(/\s+/g, " ").slice(0, 180);
      throw new Error(`API returned ${response.status}: ${preview || "non-JSON response"}`);
    }
  }
  if (!response.ok) throw new Error(responseErrorMessage(data, response.status));
  return data;
}

async function signBuiltTransaction(transactionBase64: string, lastValidBlockHeight?: number) {
  const wallet = provider();
  if (!wallet?.signAndSendTransaction) throw new Error("Wallet cannot sign Solana transactions");
  const tx = Transaction.from(fromBase64(transactionBase64));
  const result = await wallet.signAndSendTransaction(tx);
  const signature = typeof result === "string" ? result : result.signature;
  if (tx.recentBlockhash && lastValidBlockHeight) {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: tx.recentBlockhash,
      lastValidBlockHeight,
    }, "confirmed");
    if (confirmation.value.err) throw new Error("Market transaction failed on Solana.");
  }
  return signature;
}

async function prepareImageForUpload(file: File) {
  const allowed = new Set(["image/jpeg","image/png","image/webp","image/gif"]);
  if (!allowed.has(file.type)) throw new Error("Use a JPG, PNG, WEBP or GIF image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Images must be 5 MB or smaller.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Unable to read this image. Try a JPG, PNG, WEBP or GIF.");
  }

  const width = bitmap.width;
  const height = bitmap.height;
  if (width < 96 || height < 96) {
    bitmap.close();
    throw new Error("Images must be at least 96 × 96 pixels.");
  }
  if (width > 4096 || height > 4096) {
    bitmap.close();
    throw new Error("Images must be 4096 × 4096 pixels or smaller.");
  }

  // Re-encode browser images before upload. This strips problematic metadata and
  // turns WEBP/GIF downloads into a Cloudinary-friendly static PNG/JPEG.
  const maxSide = 2048;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Unable to prepare this image for upload.");
  }
  ctx.drawImage(bitmap, 0, 0, outWidth, outHeight);
  bitmap.close();

  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const extension = outputType === "image/png" ? "png" : "jpg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outputType, outputType === "image/jpeg" ? 0.9 : undefined),
  );
  if (!blob) throw new Error("Unable to prepare this image for upload.");
  const baseName = file.name.replace(/\.[^.]+$/, "") || "maryjane-image";
  return new File([blob], `${baseName}.${extension}`, { type: outputType });
}

async function postCloudinary(form: FormData, resourceType: "image" | "raw") {
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
    { method: "POST", body: form },
  );
  const data = await readJsonResponse(response);
  if (!data.secure_url) throw new Error("Cloudinary did not return a media URL.");
  return String(data.secure_url);
}

async function signedCloudinaryForm(file: File, resourceType: "image" | "raw") {
  const signatureResponse = await fetch("/api/cloudinary-signature", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resourceType }),
  });
  if (!signatureResponse.ok) return null;
  const signed = await readJsonResponse(signatureResponse);
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", String(signed.apiKey));
  form.append("timestamp", String(signed.timestamp));
  form.append("signature", String(signed.signature));
  form.append("upload_preset", String(signed.uploadPreset));
  return form;
}

async function uploadCloudinary(file: File, resourceType: "image" | "raw" = "image") {
  const preparedFile = resourceType === "image" ? await prepareImageForUpload(file) : file;

  const unsignedForm = new FormData();
  unsignedForm.append("file", preparedFile);
  unsignedForm.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  try {
    return await postCloudinary(unsignedForm, resourceType);
  } catch (unsignedError:any) {
    // Some Cloudinary presets are signed-only. If server credentials are
    // configured, retry with a short-lived server-generated signature.
    try {
      const signedForm = await signedCloudinaryForm(preparedFile, resourceType);
      if (signedForm) return await postCloudinary(signedForm, resourceType);
    } catch (signedError:any) {
      throw new Error(signedError?.message || unsignedError?.message || "Unable to upload media.");
    }
    throw new Error(unsignedError?.message || "Unable to upload media.");
  }
}

async function uploadMetadata(metadata: Record<string, unknown>) {
  const blob = new Blob([JSON.stringify(metadata)], { type: "application/json" });
  const file = new File([blob], `maryjane-market-${Date.now()}.json`, { type: "application/json" });
  return uploadCloudinary(file, "raw");
}

function VisualUpload({
  label,
  url,
  uploading,
  onUpload,
  onClear,
}: {
  label: string;
  url: string;
  uploading: boolean;
  onUpload: (file: File) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="text-xs text-white/40">{label}</div>
      {url ? (
        <div className="mt-3">
          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[.03]">
            <img src={url} alt="" className="h-32 w-full object-cover" />
            <button type="button" onClick={onClear} className="absolute right-2 top-2 rounded-full bg-black/70 p-1.5 text-white/70 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2 truncate text-[10px] text-white/25">{url}</div>
        </div>
      ) : (
        <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[.025] px-4 py-8 text-xs text-white/40 hover:border-white/25 hover:text-white/65">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading ? "Uploading…" : "Upload image"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}

export function CreateMarketScreen() {
  const [wallet, setWallet] = useState("");
  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [resolutionType, setResolutionType] = useState<"PYTH"|"OPTIMISTIC">("PYTH");
  const [pythPair, setPythPair] = useState("SOL/USD");
  const [pythTarget, setPythTarget] = useState("300");
  const [deadline, setDeadline] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [resolutionAt, setResolutionAt] = useState("");
  const [category, setCategory] = useState("Crypto");
  const [yesLabel, setYesLabel] = useState("YES");
  const [noLabel, setNoLabel] = useState("NO");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [yesImageUrl, setYesImageUrl] = useState("");
  const [noImageUrl, setNoImageUrl] = useState("");
  const [uploading, setUploading] = useState("");
  const [report, setReport] = useState<any>(null);
  const [market, setMarket] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const connect = async () => {
    const p = provider();
    if (!p?.connect) return setError("No compatible Solana wallet found.");
    const result = await p.connect();
    setWallet(result.publicKey.toString());
  };

  const source = resolutionType === "PYTH"
    ? `Pyth Oracle · ${pythPair} · target ${pythTarget}`
    : "Optimistic resolution · public evidence + challenge window";

  const visualInput = () => ({
    yesLabel: yesLabel.trim() || "YES",
    noLabel: noLabel.trim() || "NO",
    coverImageUrl: coverImageUrl.trim() || undefined,
    yesImageUrl: yesImageUrl.trim() || undefined,
    noImageUrl: noImageUrl.trim() || undefined,
  });

  const input = () => ({
    question,
    description: resolutionType === "PYTH"
      ? `${description}\n\nResolution source: Pyth ${pythPair}. Target: ${pythTarget}. Resolve using the published Pyth observation at the stated resolution time.`.trim()
      : description,
    source,
    deadline,
    category,
    closeTs: closeAt ? toUnix(closeAt) : undefined,
    resolutionTs: resolutionAt ? toUnix(resolutionAt) : undefined,
    ...visualInput(),
  });

  const validateSchedule = () => {
    if (!question.trim()) return "Enter a market question.";
    if (!yesLabel.trim() || !noLabel.trim()) return "Enter both outcome labels.";
    if (yesLabel.trim().toLowerCase() === noLabel.trim().toLowerCase()) return "Outcome labels must be different.";
    if (!closeAt) return "Choose when trading closes.";
    if (!resolutionAt) return "Choose the resolution time.";

    const closeTs = toUnix(closeAt);
    const resolutionTs = toUnix(resolutionAt);
    const now = Math.floor(Date.now() / 1000);

    if (!Number.isFinite(closeTs) || !Number.isFinite(resolutionTs)) return "Enter valid trading-close and resolution dates.";
    if (closeTs <= now) return "Trading close must be in the future.";
    if (resolutionTs < closeTs) return "Resolution time must be at or after the trading close time.";
    return "";
  };

  const uploadVisual = async (kind: "cover" | "yes" | "no", file: File) => {
    setUploading(kind); setError("");
    try {
      const url = await uploadCloudinary(file);
      if (kind === "cover") setCoverImageUrl(url);
      if (kind === "yes") setYesImageUrl(url);
      if (kind === "no") setNoImageUrl(url);
    } catch (e:any) {
      setError(e?.message || "Unable to upload image.");
    } finally {
      setUploading("");
    }
  };

  const analyze = async () => {
    const scheduleError = validateSchedule();
    if (scheduleError) return setError(scheduleError);

    setBusy("analyze"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/marketlint-analyze", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(input()),
      });
      const data = await readJsonResponse(response);
      setReport(data);
    } catch (e:any) { setError(e.message); } finally { setBusy(""); }
  };

  const create = async () => {
    if (!wallet) return setError("Connect a Solana wallet first.");
    const scheduleError = validateSchedule();
    if (scheduleError) return setError(scheduleError);

    setBusy("create"); setError(""); setNotice("Publishing market metadata…");
    try {
      const baseInput = input();
      const metadataUrl = await uploadMetadata({
        v: 2,
        t: "maryjane-market-metadata",
        ...baseInput,
        createdAt: new Date().toISOString(),
      });

      setNotice("Preparing certified Solana transaction…");
      const response = await fetch("/api/prepare-create", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({wallet,input:{...baseInput,metadataUrl}}),
      });
      const data = await readJsonResponse(response);
      setReport(data.report);
      setNotice("Waiting for Solana confirmation…");
      const signature = await signBuiltTransaction(data.transactionBase64, data.lastValidBlockHeight);
      const address = data.addresses?.market;
      if (address) {
        try {
          localStorage.setItem(
            `maryjane:market-meta:${address}`,
            JSON.stringify({
              ...baseInput,
              metadataUrl,
              createdAt: new Date().toISOString(),
            }),
          );
        } catch {}
      }
      setMarket({ ...data, signature, metadataUrl });
      setNotice("Market confirmed on Solana with visual metadata. It will appear in Markets → New on the next feed refresh.");
    } catch (e:any) { setError(e.message); setNotice(""); } finally { setBusy(""); }
  };

  const scheduleValid = Boolean(closeAt && resolutionAt && toUnix(resolutionAt) >= toUnix(closeAt));
  const certifiable = report?.analysis?.verdict === "green" && scheduleValid && !uploading;

  return (
    <div className="min-h-screen bg-[#070707] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <a href="/" className="text-lg font-semibold">Mary Jane</a>
          <button onClick={connect} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"><Wallet className="h-4 w-4"/>{wallet ? `${wallet.slice(0,4)}…${wallet.slice(-4)}` : "Connect wallet"}</button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[1fr_360px]">
        <section className="space-y-5 rounded-3xl border border-white/10 bg-white/[.025] p-6">
          <div><div className="text-xs uppercase tracking-[.18em] text-[#b7ff3c]">Permissionless creation</div><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Create a Solana prediction market</h1><p className="mt-2 text-sm text-white/38">MarketLint checks the specification before the wallet signs the onchain market transaction.</p></div>

          <label className="block text-xs text-white/40">Question<textarea value={question} onChange={e=>setQuestion(e.target.value)} rows={3} placeholder="Will Chelsea beat Manchester United?" className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4 text-base text-white outline-none"/></label>
          <label className="block text-xs text-white/40">Resolution rules<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={4} placeholder="Define exactly what counts as YES, NO and any invalid edge case." className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-4 text-white outline-none"/></label>

          <div className="rounded-3xl border border-white/10 bg-white/[.018] p-5">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-[#b7ff3c]" />
              <div>
                <div className="text-sm font-semibold">Visual outcomes</div>
                <div className="mt-1 text-xs text-white/35">Optional. Rename YES/NO and add images for teams, candidates, tokens or any two-sided matchup.</div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <label className="text-xs text-white/40">Outcome A label<input value={yesLabel} onChange={e=>setYesLabel(e.target.value)} maxLength={48} placeholder="Chelsea" className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label>
              <label className="text-xs text-white/40">Outcome B label<input value={noLabel} onChange={e=>setNoLabel(e.target.value)} maxLength={48} placeholder="Manchester United" className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <VisualUpload label={`${yesLabel || "Outcome A"} image`} url={yesImageUrl} uploading={uploading==="yes"} onUpload={(file)=>void uploadVisual("yes",file)} onClear={()=>setYesImageUrl("")}/>
              <VisualUpload label={`${noLabel || "Outcome B"} image`} url={noImageUrl} uploading={uploading==="no"} onUpload={(file)=>void uploadVisual("no",file)} onClear={()=>setNoImageUrl("")}/>
            </div>

            <div className="mt-3">
              <VisualUpload label="Market cover image" url={coverImageUrl} uploading={uploading==="cover"} onUpload={(file)=>void uploadVisual("cover",file)} onClear={()=>setCoverImageUrl("")}/>
            </div>
          </div>

          <div>
            <div className="text-xs text-white/40">Resolution source</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <button onClick={()=>setResolutionType("PYTH")} className={`rounded-2xl border p-4 text-left ${resolutionType==="PYTH"?"border-[#b7ff3c]/40 bg-[#b7ff3c]/8":"border-white/10"}`}><div className="font-semibold">Pyth market</div><div className="mt-1 text-xs text-white/35">Objective price threshold backed by a Pyth observation.</div></button>
              <button onClick={()=>setResolutionType("OPTIMISTIC")} className={`rounded-2xl border p-4 text-left ${resolutionType==="OPTIMISTIC"?"border-[#b7ff3c]/40 bg-[#b7ff3c]/8":"border-white/10"}`}><div className="font-semibold">Optimistic</div><div className="mt-1 text-xs text-white/35">Public evidence, proposal and challenge window.</div></button>
            </div>
          </div>

          {resolutionType === "PYTH" && <div className="grid gap-3 md:grid-cols-2"><label className="text-xs text-white/40">Pyth pair<input value={pythPair} onChange={e=>setPythPair(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label><label className="text-xs text-white/40">Target value<input value={pythTarget} onChange={e=>setPythTarget(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label></div>}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-white/40">Category<select value={category} onChange={e=>setCategory(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b0b0b] p-3 text-white">{["Crypto","Sports","Tech","Culture","World","Other"].map(x=><option key={x}>{x}</option>)}</select></label>
            <label className="text-xs text-white/40">Human-readable deadline<input value={deadline} onChange={e=>setDeadline(e.target.value)} placeholder="31 Dec 2026, 23:59 UTC" className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label>
            <label className="text-xs text-white/40">Trading closes (UTC)<input type="datetime-local" value={closeAt} onChange={e=>setCloseAt(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label>
            <label className="text-xs text-white/40">Resolution time (UTC)<input type="datetime-local" value={resolutionAt} onChange={e=>setResolutionAt(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-white"/></label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <button onClick={analyze} disabled={!!busy || !!uploading} className="rounded-2xl border border-white/15 py-3 text-sm">{busy==="analyze"?<Loader2 className="mx-auto h-4 w-4 animate-spin"/>:"Run MarketLint"}</button>
            <button onClick={create} disabled={!certifiable || !!busy || !!uploading} className="flex items-center justify-center gap-2 rounded-2xl bg-[#b7ff3c] py-3 text-sm font-semibold text-black disabled:opacity-30"><Rocket className="h-4 w-4"/>{busy==="create"?"Publishing…":"Create on Solana"}</button>
          </div>

          {error && <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</div>}
          {notice && <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">{notice}</div>}
        </section>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/[.025] p-5">
            <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4"/>MarketLint</div>
            {report ? <><div className="mt-4 text-5xl font-semibold">{report.analysis.overallScore}<span className="text-lg text-white/30">/100</span></div><div className="mt-2 text-sm uppercase text-white/50">{report.analysis.verdict}</div><div className="mt-4 text-xs leading-5 text-white/40">{report.analysis.issues.length ? report.analysis.issues.map((x:any)=>x.title).join(" · ") : "No blocking issues."}</div></> : <div className="mt-4 text-sm text-white/35">Compile the market spec before launch.</div>}
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[.025] p-5"><div className="text-sm font-semibold">After creation</div>{["Solana confirms market account","Visual metadata is published","Market appears in New","Traders post bids and asks"].map((x,i)=><div key={x} className="mt-4 flex items-center gap-3 text-xs text-white/45"><CheckCircle2 className="h-4 w-4 text-[#b7ff3c]"/><span>{i+1}. {x}</span></div>)}</div>
          {market && <div className="rounded-3xl border border-[#b7ff3c]/20 bg-[#b7ff3c]/5 p-5"><div className="font-semibold">Market submitted</div><div className="mt-2 break-all font-mono text-[11px] text-white/45">{market.addresses.market}</div><a className="mt-4 flex items-center gap-2 text-xs text-white/60" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/address/${market.addresses.market}?cluster=devnet`}>Explorer <ExternalLink className="h-3 w-3"/></a><a href="/" className="mt-4 block rounded-xl bg-white py-3 text-center text-sm font-semibold text-black">Go to markets</a></div>}
        </aside>
      </main>
    </div>
  );
}
export default CreateMarketScreen;
