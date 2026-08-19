import pkg from "pg";
const { Pool } = pkg;

// ---------------------------------------------------------------------------
// Connection pool — reads DATABASE_URL (PostgreSQL connection string).
// In production this points to the production database, which is kept in sync
// by scraper/sync_to_prod.py running at the end of every refresh cycle.
// ---------------------------------------------------------------------------

const pool = new Pool({
  connectionString: process.env["DATABASE_URL"],
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err);
});

// ---------------------------------------------------------------------------
// Stage mapping
// ---------------------------------------------------------------------------

const DISPOSED_STAGES = new Set([
  "DISPOSED OFF",
  "DISMISSED",
  "ALLOWED",
  "DISMISSED IN NON-PROSECUTION",
  "DISMISSED IN DEFAULT",
  "DISMISSED IN LIMINE",
  "REMANDED BACK TO DISTRICT COMMISSION",
  "REMAND",
]);

const REGISTERED_STAGES = new Set([
  "REGISTERED",
  "ADMIT",
  "ISSUE NOTICE",
  "OBJECTION",
]);

const HEARING_STAGES = new Set([
  "ADJOURN",
  "PART HEARD",
  "HEARING",
  "EVIDENCE",
  "FINAL HEARING",
  "FOR FILING AFFIDAVIT / EVIDENCE",
  "MOVED TO COURTROOM",
  "SINE-DIE",
  "STAY",
  "STAY ORDER",
  "RESTORED",
]);

const ARGUMENTS_STAGES = new Set([
  "FOR ARGUMENTS",
  "WRITTEN ARGUMENTS",
  "WRITTEN VERSION",
  "W/S",
  "REPLY",
]);

const ORDER_RESERVED_STAGES = new Set([
  "FOR ORDER",
  "JUDGEMENT RESERVED",
  "FOR COMPLIANCE",
]);

type CanonicalStage =
  | "Disposed"
  | "Registered / Admission"
  | "Hearing / Evidence"
  | "Arguments"
  | "Order Reserved"
  | "Other";

function toCanonicalStage(raw: string | null): CanonicalStage {
  if (!raw) return "Other";
  const upper = raw.toUpperCase().trim();
  if (DISPOSED_STAGES.has(upper)) return "Disposed";
  if (REGISTERED_STAGES.has(upper)) return "Registered / Admission";
  if (HEARING_STAGES.has(upper)) return "Hearing / Evidence";
  if (ARGUMENTS_STAGES.has(upper)) return "Arguments";
  if (ORDER_RESERVED_STAGES.has(upper)) return "Order Reserved";
  return "Other";
}

// ---------------------------------------------------------------------------
// Region mapping
// ---------------------------------------------------------------------------

const NORTH_STATES = new Set([
  "HARYANA", "PUNJAB", "HIMACHAL PRADESH", "UTTAR PRADESH",
  "CHANDIGARH", "UTTARAKHAND", "J&K", "JAMMU AND KASHMIR",
  "DELHI", "RAJASTHAN",
]);

const WEST_STATES = new Set([
  "MAHARASHTRA", "MADHYA PRADESH", "GUJARAT", "GOA",
]);

const SOUTH_STATES = new Set([
  "ANDHRA PRADESH", "TELANGANA", "KARNATAKA", "KERALA",
  "TAMIL NADU", "PUDUCHERRY", "PONDICHERRY",
]);

const EAST_STATES = new Set([
  "WEST BENGAL", "ODISHA", "BIHAR", "ASSAM", "JHARKHAND",
  "CHHATTISGARH", "TRIPURA", "SIKKIM", "MEGHALAYA", "MANIPUR",
  "NAGALAND", "ARUNACHAL PRADESH", "MIZORAM",
]);

type Region = "North" | "South" | "East" | "West" | "National";

function toRegion(state: string): Region {
  const upper = state.toUpperCase().trim();
  if (upper === "INDIA" || upper === "NCDRC") return "National";
  if (NORTH_STATES.has(upper)) return "North";
  if (WEST_STATES.has(upper)) return "West";
  if (SOUTH_STATES.has(upper)) return "South";
  if (EAST_STATES.has(upper)) return "East";
  return "East";
}

// ---------------------------------------------------------------------------
// Title-case helper
// ---------------------------------------------------------------------------
function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Extracted fields (parsed from JSON blob)
// ---------------------------------------------------------------------------
interface ExtractedFields {
  issue_type?: string | null;
  sales_or_service?: string | null;
  warranty_related?: boolean | null;
  product_model?: string | null;
  is_ev?: boolean | null;
  part_involved?: string | null;
  part_category?: string | null;
  dealership?: string | null;
  outcome?: string | null;
  claim_amount?: number | null;
  amount_awarded?: number | null;
  grounds_taken?: string[] | null;
  confidence?: number | null;
  source_snippet?: string | null;
}

function parseExtracted(raw: string | null): ExtractedFields {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ExtractedFields;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Row type returned from PostgreSQL query
// ---------------------------------------------------------------------------
interface RawCase {
  case_number: string;
  commission: string | null;
  level: string | null;
  state: string | null;
  case_type: string | null;
  case_stage: string | null;
  filing_date: string | null;
  next_hearing: string | null;
  complainant: string | null;
  respondent: string | null;
  comp_advocate: string | null;
  resp_advocate: string | null;
  extracted: string | null;
  extraction_status: string | null;
  dealership_canonical: string | null;
  // Judgment fields (null when no matching judgement row)
  disposal_date: string | null;
  judgement_date: string | null;
  order_body: string | null;
  bench: string | null;
  co_respondents: string | null;
  judgment_text_len: number | null;
}

// ---------------------------------------------------------------------------
// Public: fetch all cases
// ---------------------------------------------------------------------------
export interface CaseRow {
  case_number: string;
  commission: string;
  level: "district" | "state" | "national";
  state: string;
  region: Region;
  case_type: string;
  case_stage: string;
  canonical_stage: CanonicalStage;
  filing_date: string | null;
  next_hearing: string | null;
  complainant: string | null;
  respondent: string | null;
  comp_advocate: string | null;
  resp_advocate: string | null;
  // LLM-extracted fields
  extraction_status: string | null;
  issue_type: string | null;
  sales_or_service: string | null;
  warranty_related: boolean | null;
  product_model: string | null;
  is_ev: boolean | null;
  part_involved: string | null;
  part_category: string | null;
  dealership_extracted: string | null;
  dealership_canonical: string | null;
  outcome: string | null;
  claim_amount: number | null;
  amount_awarded: number | null;
  grounds_taken: string[] | null;
  confidence: number | null;
  source_snippet: string | null;
  // Judgment fields
  disposal_date: string | null;
  judgement_date: string | null;
  order_body: string | null;
  bench: string[] | null;
  co_respondents: string[] | null;
  has_judgment: boolean;
}

function parseJsonArray(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
    return null;
  } catch {
    return null;
  }
}

export async function getAllCases(): Promise<CaseRow[]> {
  const { rows } = await pool.query<RawCase>(`
    SELECT
      c.case_number, c.commission, c.level, c.state, c.case_type, c.case_stage,
      c.filing_date, c.next_hearing, c.complainant, c.respondent,
      c.comp_advocate, c.resp_advocate,
      c.extracted, c.extraction_status,
      c.dealership_canonical,
      j.disposal_date, j.judgement_date,
      substr(j.order_body, 1, 800) AS order_body,
      j.bench, j.co_respondents,
      length(j.order_body) AS judgment_text_len
    FROM cases c
    LEFT JOIN judgements j ON j.case_number = c.case_number
  `);

  console.info(`[db] getAllCases returned ${rows.length} rows from PostgreSQL`);

  return rows.map((r): CaseRow => {
    const rawState = r.state ?? "UNKNOWN";
    const normState =
      rawState.toUpperCase() === "INDIA" ? "NCDRC" : toTitleCase(rawState);
    const level = (r.level ?? "district") as "district" | "state" | "national";
    const ex = parseExtracted(r.extracted);

    return {
      case_number: r.case_number,
      commission: r.commission ?? "",
      level,
      state: normState,
      region: toRegion(rawState),
      case_type: r.case_type ?? "Unknown",
      case_stage: r.case_stage ?? "",
      canonical_stage: toCanonicalStage(r.case_stage),
      filing_date: r.filing_date ?? null,
      next_hearing: r.next_hearing ?? null,
      complainant: r.complainant ?? null,
      respondent: r.respondent ?? null,
      comp_advocate: r.comp_advocate ?? null,
      resp_advocate: r.resp_advocate ?? null,
      // Extraction fields
      extraction_status: r.extraction_status ?? null,
      issue_type: ex.issue_type ?? null,
      sales_or_service: ex.sales_or_service ?? null,
      warranty_related: ex.warranty_related ?? null,
      product_model: ex.product_model ?? null,
      is_ev: ex.is_ev ?? null,
      part_involved: ex.part_involved ?? null,
      part_category: ex.part_category ?? null,
      dealership_extracted: ex.dealership ?? null,
      dealership_canonical: r.dealership_canonical ?? null,
      outcome: ex.outcome ?? null,
      claim_amount: ex.claim_amount ?? null,
      amount_awarded: ex.amount_awarded ?? null,
      grounds_taken: ex.grounds_taken ?? null,
      confidence: ex.confidence ?? null,
      source_snippet: ex.source_snippet ?? null,
      // Judgment fields
      disposal_date: r.disposal_date ?? null,
      judgement_date: r.judgement_date ?? null,
      order_body: r.order_body ?? null,
      bench: parseJsonArray(r.bench),
      co_respondents: parseJsonArray(r.co_respondents),
      has_judgment: (r.judgment_text_len ?? 0) > 100,
    };
  });
}
