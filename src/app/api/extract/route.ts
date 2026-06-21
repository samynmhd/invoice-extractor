import Anthropic from "@anthropic-ai/sdk";
import { checkBotId } from "botid/server";
import { INVOICE_SCHEMA, type Invoice } from "@/lib/invoice";
import { getRatelimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Reject base64 payloads whose decoded size exceeds ~4 MB (base64 ≈ 4/3 of bytes).
const MAX_BYTES = 4 * 1024 * 1024;

type ExtractRequest = {
  data: string; // base64 (no data: prefix)
  mediaType: string; // image/png | image/jpeg | image/webp | image/gif | application/pdf
};

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  // 1. Reject automated traffic before spending anything.
  const verification = await checkBotId();
  if (verification.isBot) {
    return Response.json({ error: "Automated traffic is not allowed." }, { status: 403 });
  }

  // 2. Per-IP rate limit (active once the Upstash store is connected).
  const limiter = getRatelimit();
  if (limiter) {
    const { success, reset } = await limiter.limit(clientIp(request));
    if (!success) {
      const retry = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return Response.json(
        { error: `Too many requests. Try again in ${retry}s.` },
        { status: 429, headers: { "retry-after": String(retry) } },
      );
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Server is missing ANTHROPIC_API_KEY. Copy .env.local.example to .env.local and add your key." },
      { status: 500 },
    );
  }

  let body: ExtractRequest;
  try {
    body = (await request.json()) as ExtractRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { data, mediaType } = body;
  if (!data || !mediaType) {
    return Response.json({ error: "Expected { data, mediaType }." }, { status: 400 });
  }
  if (!IMAGE_TYPES.has(mediaType) && mediaType !== "application/pdf") {
    return Response.json(
      { error: `Unsupported type "${mediaType}". Use PNG, JPEG, WebP, GIF, or PDF.` },
      { status: 400 },
    );
  }
  // Enforce the size limit server-side too — the client check can be bypassed.
  if (Math.floor((data.length * 3) / 4) > MAX_BYTES) {
    return Response.json({ error: "File exceeds the 4 MB limit." }, { status: 413 });
  }

  const client = new Anthropic({ apiKey });

  // PDFs go in a document block; images in an image block. Either way the
  // file lands in the same user turn, before the instruction.
  const fileBlock =
    mediaType === "application/pdf"
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } }
      : {
          type: "image" as const,
          source: { type: "base64" as const, media_type: mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data },
        };

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8192,
      // Structured Outputs: the response is guaranteed to validate against
      // INVOICE_SCHEMA, so we can JSON.parse it without defensive scrubbing.
      output_config: { format: { type: "json_schema", schema: INVOICE_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            fileBlock,
            {
              type: "text",
              text: "Extract the invoice header and every line item from this document. Use the numbers exactly as printed; if a value is missing, use an empty string for text and 0 for numbers.",
            },
          ],
        },
      ],
    });

    if (message.stop_reason === "refusal") {
      return Response.json({ error: "The model declined to process this document." }, { status: 422 });
    }
    if (message.stop_reason === "max_tokens") {
      return Response.json(
        { error: "Document had too many line items to extract in one pass. Try a shorter invoice." },
        { status: 422 },
      );
    }

    const text = message.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return Response.json({ error: "No structured output returned." }, { status: 502 });
    }

    const invoice = JSON.parse(text.text) as Invoice;
    return Response.json({ invoice, usage: message.usage });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return Response.json({ error: `Claude API error (${err.status}): ${err.message}` }, { status: 502 });
    }
    return Response.json({ error: "Extraction failed unexpectedly." }, { status: 500 });
  }
}
