"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Invoice, InvoiceLine } from "@/lib/invoice";

type Usage = { input_tokens: number; output_tokens: number };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const fmt = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const formatSize = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

// Opus 4.8 pricing: $5 / 1M input, $25 / 1M output
const costOf = (u: Usage) => (u.input_tokens / 1e6) * 5 + (u.output_tokens / 1e6) * 25;

// Map raw server error → friendly title + body
function classifyError(msg: string): { title: string; body: string } {
  const m = msg.toLowerCase();
  if (m.includes("anthropic_api_key"))
    return { title: "No API key configured", body: "The server can't reach the model. Add ANTHROPIC_API_KEY to the environment and redeploy, then try again." };
  if (m.includes("larger than") || m.includes("4 mb"))
    return { title: "File too large", body: msg };
  if (m.includes("too many") || m.includes("declined"))
    return { title: "Couldn't read this invoice", body: "Too many line items, or the model declined. Try a clearer scan or a shorter invoice." };
  return { title: "Something went wrong", body: msg || "Extraction failed unexpectedly. Retrying usually works." };
}

export default function Home() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number>(0);
  const [mediaType, setMediaType] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFile = useCallback(async (file: File) => {
    setError(null);
    setInvoice(null);
    setUsage(null);
    setElapsed(null);
    if (file.size > 4 * 1024 * 1024) {
      setError(`Max 4 MB — yours is ${(file.size / 1024 / 1024).toFixed(1)} MB. Try a compressed export or a lower-resolution photo.`);
      return;
    }
    setFileName(file.name);
    setFileSize(file.size);
    setMediaType(file.type);
    setPreviewUrl(URL.createObjectURL(file));
    setBase64(await fileToBase64(file));
  }, []);

  const clearFile = useCallback(() => {
    setFileName(null);
    setFileSize(0);
    setMediaType(null);
    setPreviewUrl(null);
    setBase64(null);
    setInvoice(null);
    setUsage(null);
    setElapsed(null);
    setError(null);
  }, []);

  const loadSample = useCallback(async () => {
    setError(null);
    const res = await fetch("/samples/sample-invoice.pdf");
    const blob = await res.blob();
    await acceptFile(new File([blob], "sample-invoice.pdf", { type: "application/pdf" }));
  }, [acceptFile]);

  const extract = useCallback(async () => {
    if (!base64 || !mediaType) return;
    setLoading(true);
    setError(null);
    const started = performance.now();
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: base64, mediaType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Extraction failed");
      setInvoice(json.invoice as Invoice);
      setUsage(json.usage as Usage);
      setElapsed((performance.now() - started) / 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setLoading(false);
    }
  }, [base64, mediaType]);

  const updateLine = (i: number, key: keyof InvoiceLine, value: string) => {
    if (!invoice) return;
    const next = key === "description" ? value : Number(value) || 0;
    const line_items = invoice.line_items.map((l, idx) => (idx === i ? { ...l, [key]: next } : l));
    setInvoice({ ...invoice, line_items });
  };

  const addLine = () => {
    if (!invoice) return;
    setInvoice({ ...invoice, line_items: [...invoice.line_items, { description: "", quantity: 0, unit_price: 0, amount: 0 }] });
  };

  const removeLine = (i: number) => {
    if (!invoice) return;
    setInvoice({ ...invoice, line_items: invoice.line_items.filter((_, idx) => idx !== i) });
  };

  // Live-computed amounts & totals
  const computed = useMemo(() => {
    if (!invoice) return null;
    const lines = invoice.line_items.map((l) => ({ ...l, amount: round2(l.quantity * l.unit_price) }));
    const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
    const tax = round2(invoice.tax_amount);
    return { lines, subtotal, tax, total: round2(subtotal + tax) };
  }, [invoice]);

  const exportObject = useMemo(() => {
    if (!invoice || !computed) return null;
    return {
      vendor_name: invoice.vendor_name,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      currency: invoice.currency,
      line_items: computed.lines,
      subtotal: computed.subtotal,
      tax_amount: computed.tax,
      total: computed.total,
    };
  }, [invoice, computed]);

  const jsonString = useMemo(() => (exportObject ? JSON.stringify(exportObject, null, 2) : ""), [exportObject]);

  const downloadJson = () => {
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoice?.invoice_number || "invoice"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyJson = () => navigator.clipboard?.writeText(jsonString);

  const status = error
    ? { label: "extraction failed", color: "var(--color-error)", pulse: false }
    : loading
      ? { label: "extracting", color: "var(--color-accent)", pulse: true }
      : invoice
        ? { label: `extracted · ${invoice.line_items.length} line items`, color: "var(--color-success)", pulse: false }
        : dragging
          ? { label: "drop detected", color: "var(--color-accent)", pulse: false }
          : { label: "idle", color: "#c9c5bb", pulse: false };

  const cur = invoice?.currency?.trim();

  return (
    <main className="flex min-h-full justify-center bg-board px-4 py-8 sm:px-8 sm:py-12">
      <div className="w-full max-w-[1100px]">
        {/* Card */}
        <div className="overflow-hidden rounded-md border border-line bg-surface shadow-[0_4px_24px_rgba(28,28,26,0.08)]">
          {/* indeterminate progress bar while extracting */}
          {loading && (
            <div className="relative h-[3px] overflow-hidden bg-[#f0ede5]">
              <div className="absolute inset-y-0 w-[40%] bg-accent" style={{ animation: "ie-prog 1.3s ease-in-out infinite" }} />
            </div>
          )}

          {/* Masthead */}
          <header className="flex items-center justify-between border-b-2 border-rule px-5 py-5 sm:px-10">
            <h1 className="font-sans text-[26px] font-extrabold tracking-[-0.025em] sm:text-[34px]">
              Invoice<span className="text-accent">→</span>JSON
            </h1>
            <div className="flex items-center gap-3 font-mono text-xs text-muted">
              <span className="hidden sm:inline">structured extraction · v2</span>
              <span className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-ink2">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: status.color, animation: status.pulse ? "ie-pulse 1.1s ease-in-out infinite" : undefined }} />
                {status.label}
              </span>
            </div>
          </header>

          {/* Upload band */}
          <div className="grid grid-cols-1 md:grid-cols-2">
            {/* 01 / Source */}
            <section className="border-b-2 border-rule px-5 py-6 sm:px-10 md:border-r-2">
              <StageLabel n="01" label="Source" />
              {!fileName ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => inputRef.current?.click()}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void acceptFile(f); }}
                  className="flex h-[168px] cursor-pointer flex-col items-center justify-center gap-2.5 rounded-[7px] border-2 border-dashed outline-none transition"
                  style={
                    dragging
                      ? { borderColor: "var(--color-accent)", background: "var(--color-accentsoft)", boxShadow: "0 0 0 4px rgba(194,65,12,.12)" }
                      : { borderColor: "#c9c5bb", background: "#fcfbf8" }
                  }
                >
                  <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full border-2 font-mono text-xl" style={{ borderColor: dragging ? "var(--color-accent)" : "#c9c5bb", color: dragging ? "var(--color-accent)" : "var(--color-muted)" }}>
                    {dragging ? "↓" : "↑"}
                  </div>
                  <div className="font-sans text-[15px] font-semibold" style={dragging ? { color: "var(--color-accent)" } : undefined}>
                    {dragging ? "Release to upload" : (<>Drop invoice, or <span className="text-accent underline underline-offset-[3px]">browse</span></>)}
                  </div>
                  <div className="font-mono text-[11px] text-muted">PNG · JPG · PDF — max 4 MB</div>
                  <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void acceptFile(f); }} />
                </div>
              ) : (
                <div className="flex items-center gap-3.5 rounded-lg border border-line p-3.5">
                  <FilePreview mediaType={mediaType} previewUrl={previewUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-sans text-[15px] font-semibold">{fileName}</div>
                    <div className="mt-1 font-mono text-xs text-muted">
                      {mediaType || "file"} · {formatSize(fileSize)}
                    </div>
                    <div className="mt-2.5 flex gap-3.5">
                      <button onClick={() => inputRef.current?.click()} className="font-mono text-xs text-accent hover:underline">Replace</button>
                      <button onClick={clearFile} className="font-mono text-xs text-ink2 hover:underline">✕ Remove</button>
                    </div>
                    <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void acceptFile(f); }} />
                  </div>
                </div>
              )}
            </section>

            {/* 02 / Extract */}
            <section className="flex flex-col justify-center gap-3.5 border-b-2 border-rule px-5 py-6 sm:px-10">
              <StageLabel n="02" label="Extract" />
              <button
                onClick={extract}
                disabled={!base64 || loading}
                className="flex h-[50px] items-center justify-center gap-2.5 rounded-[7px] font-sans text-[15px] font-bold transition"
                style={
                  loading
                    ? { background: "var(--color-accentsoft)", border: "1px solid rgba(194,65,12,.3)", color: "var(--color-accent)" }
                    : base64
                      ? { background: "var(--color-accent)", color: "#fff", boxShadow: "0 1px 2px rgba(194,65,12,.4)" }
                      : { background: "#ece9e1", color: "var(--color-muted)", cursor: "not-allowed" }
                }
              >
                {loading ? (<><span className="inline-block h-4 w-4 rounded-full border-2" style={{ borderColor: "rgba(194,65,12,.3)", borderTopColor: "var(--color-accent)", animation: "ie-spin .7s linear infinite" }} />Extracting…</>) : "Extract data →"}
              </button>
              <p className="font-mono text-xs leading-relaxed text-ink2">
                {loading ? "Reading the document and structuring line items…" : base64 ? "Ready. Typical run takes 2–10 s." : "Upload a file to enable extraction."}
                {!base64 && (<> <button onClick={loadSample} className="text-accent hover:underline">load a sample →</button></>)}
              </p>
            </section>
          </div>

          {/* Error banner (above result) */}
          {error && <ErrorBanner raw={error} onRetry={base64 ? extract : undefined} onDismiss={() => setError(null)} />}

          {/* 03 / Result */}
          <section className="px-5 py-6 sm:px-10">
            <StageLabel n="03" label="Result" />
            {!invoice && !loading && <EmptyResult />}
            {loading && <SkeletonResult />}
            {invoice && computed && (
              <>
                {/* compact source + re-extract */}
                <div className="-mx-5 mb-6 flex items-center justify-between border-y-2 border-rule bg-sunken px-5 py-3 sm:-mx-10 sm:px-10">
                  <div className="font-mono text-xs text-ink2">
                    {fileName} {elapsed != null && <span className="text-muted">· extracted in {elapsed.toFixed(1)} s</span>}
                  </div>
                  <button onClick={extract} className="rounded-md border border-line bg-surface px-3.5 py-2 font-mono text-xs text-accent hover:bg-accentsoft">↻ Re-extract</button>
                </div>

                {/* header fields */}
                <div className="mb-6 grid grid-cols-2 gap-5 md:grid-cols-4">
                  <Field label="Vendor" value={invoice.vendor_name} onChange={(v) => setInvoice({ ...invoice, vendor_name: v })} />
                  <Field label="Invoice #" mono value={invoice.invoice_number} onChange={(v) => setInvoice({ ...invoice, invoice_number: v })} />
                  <Field label="Date" mono value={invoice.invoice_date} onChange={(v) => setInvoice({ ...invoice, invoice_date: v })} />
                  <Field label="Currency" mono value={invoice.currency} onChange={(v) => setInvoice({ ...invoice, currency: v })} />
                </div>

                {/* DESKTOP table */}
                <div className="hidden border-t-2 border-rule md:block">
                  <div className="grid grid-cols-[2.6fr_0.6fr_1fr_1fr] border-b border-rule">
                    {["DESCRIPTION", "QTY", "UNIT", "AMOUNT"].map((h, i) => (
                      <span key={h} className={`px-2 py-2.5 font-mono text-[11px] tracking-[0.06em] text-muted ${i ? "text-right" : ""}`}>{h}</span>
                    ))}
                  </div>
                  {computed.lines.map((line, i) => (
                    <div key={i} className="group relative grid grid-cols-[2.6fr_0.6fr_1fr_1fr] border-b border-line">
                      <CellInput value={invoice.line_items[i].description} sans onChange={(v) => updateLine(i, "description", v)} />
                      <CellInput value={String(invoice.line_items[i].quantity)} right onChange={(v) => updateLine(i, "quantity", v)} />
                      <CellInput value={String(invoice.line_items[i].unit_price)} right onChange={(v) => updateLine(i, "unit_price", v)} />
                      <div className="px-2 py-[11px] text-right font-mono text-sm text-ink2">{fmt(line.amount)}</div>
                      <button onClick={() => removeLine(i)} className="absolute -right-6 top-1/2 hidden -translate-y-1/2 font-mono text-sm text-muted opacity-0 transition hover:text-error group-hover:opacity-100 md:block" aria-label="Remove line">✕</button>
                    </div>
                  ))}
                </div>

                {/* MOBILE cards */}
                <div className="border-t-2 border-rule pt-4 md:hidden">
                  <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Line items · tap to edit</div>
                  {computed.lines.map((line, i) => (
                    <div key={i} className="mb-2.5 rounded-lg border border-line p-3">
                      <input value={invoice.line_items[i].description} onChange={(e) => updateLine(i, "description", e.target.value)} className="w-full border-none bg-transparent pb-2.5 font-sans text-sm font-semibold text-ink outline-none focus:text-accent" />
                      <div className="grid grid-cols-3 gap-2 border-t border-line pt-2.5">
                        <MobileCell label="QTY" value={String(invoice.line_items[i].quantity)} onChange={(v) => updateLine(i, "quantity", v)} />
                        <MobileCell label="UNIT" value={String(invoice.line_items[i].unit_price)} onChange={(v) => updateLine(i, "unit_price", v)} />
                        <div>
                          <div className="mb-0.5 font-mono text-[9px] text-muted">AMOUNT</div>
                          <div className="p-1.5 font-mono text-[13px] text-ink2">{fmt(line.amount)}</div>
                        </div>
                      </div>
                      <button onClick={() => removeLine(i)} className="mt-2 font-mono text-[11px] text-ink2 hover:text-error">✕ Remove</button>
                    </div>
                  ))}
                </div>

                <button onClick={addLine} className="mt-3 flex items-center gap-2 font-mono text-xs text-accent hover:underline">
                  <span className="text-[15px] leading-none">+</span> Add line item
                </button>

                {/* totals */}
                <div className="mt-4 flex justify-end">
                  <div className="w-full sm:w-[300px]">
                    <TotalRow label="Subtotal" value={fmt(computed.subtotal)} />
                    <TotalRow label="Tax" value={fmt(computed.tax)} />
                    <div className="mt-1 flex justify-between border-t-2 border-rule px-2 py-2.5 font-mono text-lg font-bold">
                      <span>Total</span><span>{cur ? `${cur} ` : ""}{fmt(computed.total)}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* 04 / output.json */}
          <div className="bg-jsonbg px-5 py-5 sm:px-10">
            {invoice && exportObject ? (
              <>
                <div className="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs text-white">output.json</span>
                    <button onClick={copyJson} className="rounded border border-[#2e2d2a] px-2 py-0.5 font-mono text-[11px] text-jsondim hover:text-white">copy</button>
                  </div>
                  <div className="flex items-center gap-4">
                    {usage && (
                      <span className="font-mono text-[11px] text-jsondim">
                        tokens · in {usage.input_tokens.toLocaleString()} out {usage.output_tokens.toLocaleString()} · ~${costOf(usage).toFixed(4)}
                      </span>
                    )}
                    <button onClick={downloadJson} className="rounded-md bg-accent px-4 py-2 font-sans text-[13px] font-bold text-white">↓ Download JSON</button>
                  </div>
                </div>
                <pre className="m-0 overflow-x-auto font-mono text-[13px] leading-[1.7] text-jsonink"><HighlightedJson json={jsonString} /></pre>
              </>
            ) : (
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-xs text-jsondim">04 / output.json — {loading ? "streaming" : "awaiting extraction"}</span>
                {loading && <span className="inline-block h-3.5 w-[7px] bg-accent" style={{ animation: "ie-caret 1s steps(1) infinite" }} />}
              </div>
            )}
          </div>
        </div>

        <footer className="mt-6 px-1 font-mono text-[11px] text-muted">
          Next.js 16 · Claude Opus 4.8 vision + Structured Outputs · sample data is synthetic.
        </footer>
      </div>
    </main>
  );
}

function StageLabel({ n, label }: { n: string; label: string }) {
  return (
    <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
      <span className="text-accent">{n}</span> / {label}
    </div>
  );
}

function FilePreview({ mediaType, previewUrl }: { mediaType: string | null; previewUrl: string | null }) {
  if (mediaType?.startsWith("image/") && previewUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={previewUrl} alt="preview" className="h-20 w-16 flex-none rounded border border-line object-cover" />;
  }
  // PDF / other glyph
  return (
    <div className="relative flex h-20 w-16 flex-none flex-col gap-1 rounded border border-line bg-white p-[7px]">
      {[70, 90, 80, 60].map((w, i) => (<div key={i} className="h-1 rounded-sm bg-line" style={{ width: `${w}%` }} />))}
      <span className="absolute bottom-[5px] left-[5px] rounded-sm bg-error px-1 py-px font-mono text-[8px] text-white">PDF</span>
    </div>
  );
}

function Field({ label, value, mono, onChange }: { label: string; value: string; mono?: boolean; onChange: (v: string) => void }) {
  return (
    <div className="border-t-2 border-rule pt-2.5">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full border-none bg-transparent text-[17px] text-ink outline-none focus:bg-accentsoft ${mono ? "font-mono font-medium" : "font-sans font-semibold"}`}
      />
    </div>
  );
}

function CellInput({ value, right, sans, onChange }: { value: string; right?: boolean; sans?: boolean; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full border-none bg-transparent px-2 py-[11px] text-sm text-ink outline-none transition hover:bg-bg focus:rounded-sm focus:bg-accentsoft focus:outline-2 focus:-outline-offset-2 focus:outline-accent ${right ? "text-right font-mono" : sans ? "font-sans" : "font-mono"}`}
    />
  );
}

function MobileCell({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-0.5 font-mono text-[9px] text-muted">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-line bg-white p-1.5 font-mono text-[13px] outline-none focus:-outline-offset-1 focus:bg-accentsoft focus:outline-2 focus:outline-accent" />
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-2 py-1.5 font-mono text-sm">
      <span className="text-ink2">{label}</span><span>{value}</span>
    </div>
  );
}

function EmptyResult() {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-12 opacity-70">
      <div className="font-mono text-[26px] text-[#c9c5bb]">{"{ }"}</div>
      <div className="font-sans text-sm text-muted">Extracted fields &amp; line items will appear here</div>
    </div>
  );
}

function SkeletonResult() {
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-5 md:grid-cols-4">
        {["Vendor", "Invoice #", "Date", "Currency"].map((l) => (
          <div key={l} className="border-t-2 border-rule pt-2.5">
            <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{l}</div>
            <div className="ie-shimmer h-[18px] rounded-sm" />
          </div>
        ))}
      </div>
      <div className="border-y-2 border-rule">
        <div className="grid grid-cols-[2.6fr_0.6fr_1fr_1fr] border-b border-line">
          {["DESCRIPTION", "QTY", "UNIT", "AMOUNT"].map((h, i) => (
            <span key={h} className={`px-1 py-2.5 font-mono text-[11px] text-muted ${i ? "text-right" : ""}`}>{h}</span>
          ))}
        </div>
        {[0, 1].map((r) => (
          <div key={r} className="grid grid-cols-[2.6fr_0.6fr_1fr_1fr]">
            {[0, 1, 2, 3].map((c) => (<span key={c} className="ie-shimmer m-3 h-[13px] rounded-sm" style={{ width: c === 0 ? "70%" : undefined }} />))}
          </div>
        ))}
      </div>
    </>
  );
}

function ErrorBanner({ raw, onRetry, onDismiss }: { raw: string; onRetry?: () => void; onDismiss: () => void }) {
  const { title, body } = classifyError(raw);
  return (
    <div className="px-5 py-6 sm:px-10">
      <div className="flex gap-4 rounded-lg border border-errorline border-l-[5px] border-l-error bg-errorsoft p-5">
        <div className="mt-px flex h-6 w-6 flex-none items-center justify-center rounded-full bg-error font-sans text-[15px] font-extrabold text-white">!</div>
        <div className="flex-1">
          <div className="font-sans text-base font-bold text-error">{title}</div>
          <div className="mt-1.5 font-mono text-[13px] leading-relaxed text-errorink">{body}</div>
          <div className="mt-3.5 flex gap-2.5">
            {onRetry && <button onClick={onRetry} className="rounded-md bg-error px-4 py-2 font-sans text-[13px] font-bold text-white">Retry</button>}
          </div>
        </div>
        <button onClick={onDismiss} className="font-mono text-base leading-none text-[#b58f89] hover:text-error" aria-label="Dismiss">✕</button>
      </div>
    </div>
  );
}

function HighlightedJson({ json }: { json: string }) {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\b(?:true|false|null)\b)|([{}[\],])/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(json)) !== null) {
    if (m.index > last) nodes.push(json.slice(last, m.index));
    if (m[1] !== undefined && m[2] !== undefined) {
      nodes.push(<span key={i++} style={{ color: "#E8A87C" }}>{m[1]}</span>);
      nodes.push(<span key={i++} style={{ color: "#56544e" }}>{m[2]}</span>);
    } else if (m[1] !== undefined) {
      nodes.push(<span key={i++} style={{ color: "#9DBF9E" }}>{m[1]}</span>);
    } else if (m[3] !== undefined) {
      nodes.push(<span key={i++} style={{ color: "#86B8CE" }}>{m[3]}</span>);
    } else if (m[4] !== undefined) {
      nodes.push(<span key={i++} style={{ color: "#86B8CE" }}>{m[4]}</span>);
    } else if (m[5] !== undefined) {
      nodes.push(<span key={i++} style={{ color: "#56544e" }}>{m[5]}</span>);
    }
    last = re.lastIndex;
  }
  if (last < json.length) nodes.push(json.slice(last));
  return <>{nodes}</>;
}
