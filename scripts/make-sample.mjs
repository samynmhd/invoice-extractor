// Generates a synthetic invoice PDF (no real client data) for the demo's
// "load a sample" button. Hand-built minimal PDF so there are no extra deps.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "samples");
mkdirSync(outDir, { recursive: true });

// Each entry: [x, y, fontSize, text]. y grows upward from the page bottom.
const lines = [
  [50, 740, 18, "NORTHWIND WHOLESALE PVT LTD"],
  [50, 722, 10, "Dry Goods & Provisions  -  Hulhumale, Maldives"],
  [50, 690, 13, "INVOICE  INV-2026-0042"],
  [50, 674, 10, "Date: 2026-06-15"],
  [50, 660, 10, "Bill To: Sunrise Cafe, Male"],
  [50, 646, 10, "Currency: MVR (Maldivian Rufiyaa)"],
  [50, 624, 10, "Description"],
  [330, 624, 10, "Qty"],
  [400, 624, 10, "Unit"],
  [490, 624, 10, "Amount"],
  [50, 604, 10, "Basmati Rice 25kg sack"],
  [340, 604, 10, "10"],
  [395, 604, 10, "45.00"],
  [485, 604, 10, "450.00"],
  [50, 588, 10, "Sunflower Oil 5L bottle"],
  [345, 588, 10, "6"],
  [395, 588, 10, "62.50"],
  [485, 588, 10, "375.00"],
  [50, 572, 10, "Tomato Paste 800g tin"],
  [340, 572, 10, "24"],
  [400, 572, 10, "8.75"],
  [485, 572, 10, "210.00"],
  [50, 556, 10, "Paper Napkins pack"],
  [345, 556, 10, "5"],
  [395, 556, 10, "12.00"],
  [490, 556, 10, "60.00"],
  [400, 520, 10, "Subtotal:"],
  [485, 520, 10, "1095.00"],
  [400, 506, 10, "GST 8%:"],
  [490, 506, 10, "87.60"],
  [400, 490, 12, "Total:"],
  [482, 490, 12, "1182.60"],
];

const content =
  "BT\n" +
  lines
    .map(([x, y, size, text]) => `/F1 ${size} Tf\n1 0 0 1 ${x} ${y} Tm\n(${text}) Tj`)
    .join("\n") +
  "\nET";

const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
];

let pdf = "%PDF-1.4\n";
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf, "latin1"));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});

const xrefStart = Buffer.byteLength(pdf, "latin1");
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += "0000000000 65535 f \n";
offsets.forEach((off) => {
  pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
});
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

const out = join(outDir, "sample-invoice.pdf");
writeFileSync(out, Buffer.from(pdf, "latin1"));
console.log("Wrote", out, `(${Buffer.byteLength(pdf, "latin1")} bytes)`);
