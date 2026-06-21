# Invoice → JSON

Upload an invoice or receipt (image or PDF) and get back **structured line items** —
vendor, invoice number, date, per-item quantity/price/amount, and totals — that you can
edit inline and export as JSON.

The extraction is a single **Claude Opus 4.8** call using **vision + Structured Outputs**,
so the model is constrained to a JSON schema and the result needs no brittle text-parsing.

> This is a clean, standalone demo of a pattern I deploy into production SaaS. In a real
> product I wrap this call with multi-tenant storage + row-level security, a background
> polling worker (so capture and OCR are decoupled), retry/idempotency, and a
> categorization/canonicalization pass over the extracted items. **All sample data here is
> synthetic — no client data or credentials.**

## Stack

- **Next.js 16** (App Router, Route Handler for the API)
- **Claude Opus 4.8** via the official `@anthropic-ai/sdk` — vision + `output_config.format`
- **Tailwind CSS**, TypeScript
- Deploys to **Vercel** with one environment variable

## Run locally

```bash
npm install
cp .env.local.example .env.local   # then paste your Anthropic API key
npm run dev                        # http://localhost:3000
```

Get a key at https://console.anthropic.com/. Click **"load a sample invoice"** to try it
without uploading anything.

## How it works

```
Browser ──(base64 image/PDF)──▶ /api/extract (Route Handler)
                                     │  one client.messages.create() call:
                                     │  • image/document content block
                                     │  • output_config.format = INVOICE_SCHEMA
                                     ▼
                                 Claude Opus 4.8 (vision)
                                     │  returns JSON validated against the schema
                                     ▼
Browser ◀──(structured Invoice)── editable table + JSON export
```

- `src/lib/invoice.ts` — the shared `Invoice` type and the JSON schema Claude is bound to.
- `src/app/api/extract/route.ts` — the extraction call (the whole "AI" of the app).
- `src/app/page.tsx` — upload, preview, editable results, JSON export.
- `scripts/make-sample.mjs` — regenerates the synthetic sample PDF.

## Deploy

Push to GitHub, import into Vercel, set `ANTHROPIC_API_KEY` in project env vars, deploy.
