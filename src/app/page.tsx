"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Invoice } from "@/lib/invoice";

type Usage = { input_tokens: number; output_tokens: number };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? ""); // strip the data: prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFile = useCallback(async (file: File) => {
    setError(null);
    setInvoice(null);
    setUsage(null);
    if (file.size > 4 * 1024 * 1024) {
      setError("File is larger than 4 MB. Please use a smaller image or PDF.");
      return;
    }
    setFileName(file.name);
    setMediaType(file.type);
    setPreviewUrl(URL.createObjectURL(file));
    setBase64(await fileToBase64(file));
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setLoading(false);
    }
  }, [base64, mediaType]);

  const updateLine = (i: number, key: keyof Invoice["line_items"][number], value: string) => {
    if (!invoice) return;
    const next = key === "description" ? value : Number(value);
    const line_items = invoice.line_items.map((l, idx) => (idx === i ? { ...l, [key]: next } : l));
    setInvoice({ ...invoice, line_items });
  };

  const jsonString = useMemo(() => (invoice ? JSON.stringify(invoice, null, 2) : ""), [invoice]);

  const downloadJson = () => {
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoice?.invoice_number || "invoice"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <header className="mb-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-700">Claude vision · structured output</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-stone-900">Invoice → JSON</h1>
        <p className="mt-3 max-w-2xl text-stone-600">
          Drop an invoice or receipt (image or PDF). Claude reads it and returns structured line items you can
          edit and export. This is the extraction pattern I deploy into production SaaS — minus the multi-tenant
          storage, polling worker, and retry/idempotency layer.
        </p>
      </header>

      <section className="grid gap-8 md:grid-cols-2">
        {/* Upload + preview */}
        <div className="flex flex-col gap-4">
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void acceptFile(f);
            }}
            className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 p-6 text-center transition hover:border-amber-500 hover:bg-amber-50/40"
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void acceptFile(f);
              }}
            />
            <p className="font-medium text-stone-700">{fileName ?? "Click or drop an invoice"}</p>
            <p className="mt-1 text-sm text-stone-500">PNG · JPEG · WebP · GIF · PDF</p>
          </div>

          <button
            onClick={loadSample}
            className="self-start font-mono text-xs text-amber-700 underline-offset-4 hover:underline"
          >
            or load a sample invoice →
          </button>

          {previewUrl && mediaType?.startsWith("image/") && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="invoice preview" className="rounded-lg border border-stone-200" />
          )}
          {previewUrl && mediaType === "application/pdf" && (
            <object data={previewUrl} type="application/pdf" className="h-[420px] w-full rounded-lg border border-stone-200">
              <p className="p-4 text-sm text-stone-500">PDF preview unavailable in this browser.</p>
            </object>
          )}

          <button
            onClick={extract}
            disabled={!base64 || loading}
            className="rounded-lg bg-stone-900 px-5 py-3 font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Reading invoice…" : "Extract with Claude"}
          </button>

          {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        </div>

        {/* Results */}
        <div className="flex flex-col gap-4">
          {!invoice && (
            <div className="flex h-full min-h-[200px] items-center justify-center rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-400">
              Extracted line items appear here.
            </div>
          )}

          {invoice && (
            <>
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm">
                <Field label="Vendor" value={invoice.vendor_name} />
                <Field label="Invoice #" value={invoice.invoice_number} />
                <Field label="Date" value={invoice.invoice_date} />
                <Field label="Currency" value={invoice.currency} />
              </div>

              <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-stone-100 text-left font-mono text-xs uppercase tracking-wider text-stone-500">
                    <tr>
                      <th className="p-2">Item</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Unit</th>
                      <th className="p-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.line_items.map((line, i) => (
                      <tr key={i} className="border-t border-stone-100">
                        <td className="p-1">
                          <input
                            value={line.description}
                            onChange={(e) => updateLine(i, "description", e.target.value)}
                            className="w-full rounded px-1 py-1 hover:bg-stone-50 focus:bg-amber-50 focus:outline-none"
                          />
                        </td>
                        {(["quantity", "unit_price", "amount"] as const).map((k) => (
                          <td key={k} className="p-1">
                            <input
                              value={line[k]}
                              onChange={(e) => updateLine(i, k, e.target.value)}
                              className="w-full rounded px-1 py-1 text-right hover:bg-stone-50 focus:bg-amber-50 focus:outline-none"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-stone-200 font-medium text-stone-700">
                    <tr>
                      <td className="p-2 text-right" colSpan={3}>Subtotal</td>
                      <td className="p-2 text-right">{invoice.subtotal}</td>
                    </tr>
                    <tr>
                      <td className="p-2 text-right" colSpan={3}>Tax</td>
                      <td className="p-2 text-right">{invoice.tax_amount}</td>
                    </tr>
                    <tr className="text-stone-900">
                      <td className="p-2 text-right" colSpan={3}>Total</td>
                      <td className="p-2 text-right">{invoice.total}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <button onClick={downloadJson} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100">
                  Download JSON
                </button>
                {usage && (
                  <span className="font-mono text-xs text-stone-400">
                    {usage.input_tokens} in / {usage.output_tokens} out tokens
                  </span>
                )}
              </div>

              <pre className="max-h-64 overflow-auto rounded-lg bg-stone-900 p-4 font-mono text-xs leading-relaxed text-stone-100">
                {jsonString}
              </pre>
            </>
          )}
        </div>
      </section>

      <footer className="mt-16 border-t border-stone-200 pt-6 font-mono text-xs text-stone-400">
        Built with Next.js 16 · Claude Opus 4.8 vision + Structured Outputs. Sample data is synthetic.
      </footer>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-wider text-stone-400">{label}</p>
      <p className="text-stone-800">{value || "—"}</p>
    </div>
  );
}
