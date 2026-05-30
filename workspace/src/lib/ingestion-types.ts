/**
 * TypeScript types for the datasheet ingestion pipeline.
 *
 * Mirrors the Pydantic models in breakthrough_engine/ingestion/models.py.
 * The workspace renders these fields — it does not fabricate or estimate values.
 */

export type SourceType = "pdf" | "text" | "url";
export type IngestionVerdict = "accepted" | "needs_review" | "rejected";
export type ReviewStatus = "pending" | "reviewed" | "submitted" | "evaluated";

export interface ValidationIssue {
  field_name: string;
  severity: "warning" | "error";
  message: string;
  suggested_value?: number | string | null;
}

export interface ExtractionField {
  name: string;
  label: string;
  value: number | string | null;
  unit: string;
  confidence: number;
  source_text: string;
  source_page: number | null;
  validation_status: "valid" | "warning" | "error" | "unknown";
  validation_message: string;
  user_edited: boolean;
}

export interface IngestionPacket {
  packet_id: string;
  created_at: string;

  // Source metadata
  source_type: SourceType;
  source_filename: string | null;
  source_url: string | null;
  source_text_preview: string;

  // Domain detection
  detected_domain: string;
  domain_confidence: number;
  domain_display_name: string;

  // Product identification
  technology_family: string;
  commercial_name: string;
  manufacturer: string;

  // Extracted fields
  fields: ExtractionField[];

  // Validation results
  validation_warnings: ValidationIssue[];
  validation_errors: ValidationIssue[];

  // Overall verdict
  extraction_verdict: IngestionVerdict;
  extraction_confidence: number;

  // Review state
  review_status: ReviewStatus;
  review_notes: string;

  // Evaluation link
  evaluation_id: string | null;
  brief_id: string | null;
}

/**
 * MVP domain definitions — matches breakthrough_engine/ingestion/domains.py
 */
export const MVP_DOMAINS: Record<string, { display_name: string; description: string }> = {
  battery_ecm: { display_name: "Battery Cell (Li-ion)", description: "Lithium-ion cell characterization" },
  pv_iv: { display_name: "Solar PV Module", description: "Photovoltaic module I-V characterization" },
  inverter_dc_ac: { display_name: "DC-AC Inverter", description: "Grid-tied or off-grid inverter" },
  heat_pump_systems: { display_name: "Heat Pump System", description: "Air-source, ground-source, or industrial heat pump" },
  fuel_cell_systems: { display_name: "Fuel Cell System", description: "PEM, SOFC, or other fuel cell system" },
};

/**
 * Type guard — check if a payload looks like an IngestionPacket.
 */
export function isIngestionPacket(data: unknown): data is IngestionPacket {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.packet_id === "string" &&
    typeof d.source_type === "string" &&
    typeof d.detected_domain === "string" &&
    Array.isArray(d.fields)
  );
}

// ---------------------------------------------------------------------------
// Comprehensive Extraction types
// ---------------------------------------------------------------------------

export interface ExtractedParameterFull {
  name: string;
  value: unknown;
  unit: string;
  context: string;
  page: number | null;
  confidence: string;  // "stated" | "derived" | "claimed" | "inferred" | "unverified"
  category: string;
}

export interface PerformanceClaim {
  claim: string;
  value: string;
  evidence: string;  // "self_reported" | "third_party" | "peer_reviewed" | "demonstrated"
  context: string;
}

export interface InformationGap {
  category: string;
  description: string;
  importance: string;  // "critical" | "high" | "medium"
}

export interface TableData {
  title: string;
  headers: string[];
  rows: string[][];
  page: number | null;
}

export interface ComprehensiveExtraction {
  document_type: string;
  title: string;
  company: string;
  product_name: string;
  detected_domain: string;
  domain_confidence: number;
  technology_family: string;

  parameters: ExtractedParameterFull[];
  system_summary: string;
  architecture: string;
  operating_modes: string[];
  operating_conditions: string;

  performance_claims: PerformanceClaim[];
  competitive_comparisons: Array<{ claim: string; benchmark: string; advantage: string }>;

  cost_data: ExtractedParameterFull[];
  economic_summary: string;

  regulatory_status: string;
  safety_claims: string[];
  environmental_claims: string[];
  certifications: string[];

  trl_estimate: string;
  trl_evidence: string;
  demonstrated_scale: string;
  target_scale: string;

  information_gaps: InformationGap[];
  tables: TableData[];

  source_file: string;
  source_type: string;
  extraction_model: string;
  confidence_overall: number;
}

export function isComprehensiveExtraction(data: unknown): data is ComprehensiveExtraction {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    Array.isArray(d.parameters) &&
    typeof d.system_summary === "string" &&
    Array.isArray(d.information_gaps)
  );
}
