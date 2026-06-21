// Shared invoice shape + the JSON schema Claude is constrained to.
// Keeping the schema next to the TS type means the API route and the UI
// agree on exactly one contract.

export type InvoiceLine = {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
};

export type Invoice = {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  currency: string;
  line_items: InvoiceLine[];
  subtotal: number;
  tax_amount: number;
  total: number;
};

// JSON Schema passed to Claude via output_config.format. Structured Outputs
// guarantee the model returns JSON that validates against this exact shape —
// no brittle string-parsing of the model's prose.
export const INVOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendor_name: { type: "string", description: "Supplier / seller name on the document" },
    invoice_number: { type: "string", description: "Invoice or bill number" },
    invoice_date: { type: "string", description: "Issue date, ISO 8601 (YYYY-MM-DD) if determinable" },
    currency: { type: "string", description: "ISO 4217 code or symbol shown on the document" },
    line_items: {
      type: "array",
      description: "One entry per purchased line item",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          unit_price: { type: "number" },
          amount: { type: "number", description: "Line total (quantity x unit_price)" },
        },
        required: ["description", "quantity", "unit_price", "amount"],
      },
    },
    subtotal: { type: "number" },
    tax_amount: { type: "number", description: "Total tax / GST / VAT, 0 if none shown" },
    total: { type: "number", description: "Grand total payable" },
  },
  required: [
    "vendor_name",
    "invoice_number",
    "invoice_date",
    "currency",
    "line_items",
    "subtotal",
    "tax_amount",
    "total",
  ],
} as const;
