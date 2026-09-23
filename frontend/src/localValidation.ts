import { LocalRecord } from "./localData";

export type EvidenceItem = {
  dataset_id: string;
  dataset_version: string;
  source: string;
  source_url: string;
  source_version: string;
  record_id: string;
  input: Record<string, unknown>;
  matched_record: Record<string, unknown> | null;
  timestamp: string;
  result: string;
};

export type LocalValidationProfile = {
  sample_id: string;
  result_id: string;
  timestamp: string;
  analyte: string;
  loinc_code: string | null;
  value: number;
  unit: string;
  method: string;
  instrument: string;
  data_quality: { issues: string[] };
  specimen_quality: { status: string; evidence: string };
  qc_status: string;
  reference_interval: Record<string, unknown> | null;
  delta_check: { status: string; reason: string };
  interference_assessment: { status: string; evidence: string };
  consistency_assessment: { status: string; evidence: string };
  triggered_rules: string[];
  evidence_chain: EvidenceItem[];
  final_status: "VALIDATION_COMPLETE" | "REVIEW_REQUIRED" | "INSUFFICIENT_DATA" | "CONFIGURATION_REQUIRED" | "DATA_ERROR";
  professional_review: {
    reviewed_by: null;
    review_timestamp: null;
    professional_comment: null;
    professional_decision: "not_recorded";
  };
  knowledge_base_versions: Record<string, string>;
};

export type WorkspaceAlert = { id: string; title: string; status: string; reason: string; evidence: EvidenceItem[] };
export type WorkspaceContext = {
  patientId: string;
  sampleId: string;
  current: LocalRecord | null;
  patientRecords: LocalRecord[];
  historicalRecords: LocalRecord[];
  profile: LocalValidationProfile | null;
  completeness: Array<{ field: string; status: "AVAILABLE" | "MISSING" | "OPTIONAL" | "REQUIRED" }>;
  alerts: WorkspaceAlert[];
};

const engineVersion = "frontend-local-0.1.0";

function stableTimestamp(record: LocalRecord): string {
  return `${record.date}T${record.time}:00.000Z`;
}

function evidence(record: LocalRecord, datasetId: string, result: string, input: Record<string, unknown>): EvidenceItem {
  return {
    dataset_id: datasetId,
    dataset_version: "NOT_INSTALLED",
    source: "Local dataset registry",
    source_url: "",
    source_version: engineVersion,
    record_id: record.id,
    input,
    matched_record: null,
    timestamp: stableTimestamp(record),
    result,
  };
}

export function validateLocally(record: LocalRecord): LocalValidationProfile {
  const issues: string[] = [];
  const evidenceChain: EvidenceItem[] = [];
  if (!record.analyte) issues.push("INSUFFICIENT_DATA");
  if (!record.loinc_code) {
    issues.push("LOINC_MAPPING_REQUIRED");
    evidenceChain.push(evidence(record, "LOINC", "LOINC_MAPPING_REQUIRED", { analyte: record.analyte, specimen: record.specimen, method: record.method }));
  }
  issues.push("REFERENCE_INTERVAL_UNAVAILABLE");
  evidenceChain.push(evidence(record, "reference_intervals", "REFERENCE_INTERVAL_UNAVAILABLE", { analyte: record.analyte, unit: record.unit, specimen: record.specimen, method: record.method }));
  const hasPrevious = record.previous_value !== null && record.previous_date !== null;
  if (!hasPrevious) {
    issues.push("DELTA_CHECK_NOT_AVAILABLE");
    evidenceChain.push(evidence(record, "delta_checks", "DELTA_CHECK_NOT_AVAILABLE", { sample_id: record.sample_id }));
  }
  if (!record.qc_status) {
    issues.push("QC_DATA_NOT_AVAILABLE");
    evidenceChain.push(evidence(record, "qc", "QC_DATA_NOT_AVAILABLE", { analyte: record.analyte, method: record.method, instrument: record.instrument }));
  }
  const reviewRequired = Boolean(record.flag) || record.qc_status === "rejected" || record.qc_status === "review_required";
  const finalStatus = issues.length > 0 ? (reviewRequired ? "REVIEW_REQUIRED" : "INSUFFICIENT_DATA") : "VALIDATION_COMPLETE";
  return {
    sample_id: record.sample_id,
    result_id: record.id,
    timestamp: stableTimestamp(record),
    analyte: record.analyte,
    loinc_code: record.loinc_code ?? null,
    value: record.value,
    unit: record.unit,
    method: record.method,
    instrument: record.instrument,
    data_quality: { issues },
    specimen_quality: { status: record.hemolysis_index !== null || record.icterus_index !== null || record.lipemia_index !== null ? "AVAILABLE_FOR_REVIEW" : "NOT_PROVIDED", evidence: JSON.stringify({ hemolysis_index: record.hemolysis_index, icterus_index: record.icterus_index, lipemia_index: record.lipemia_index }) },
    qc_status: record.qc_status || "NOT_CONFIGURED",
    reference_interval: null,
    delta_check: { status: hasPrevious ? "AVAILABLE_FOR_REVIEW" : "DELTA_CHECK_NOT_AVAILABLE", reason: hasPrevious ? "Existe un resultado previo local." : "No existe un resultado previo introducido." },
    interference_assessment: { status: record.hemolysis_index !== null || record.icterus_index !== null || record.lipemia_index !== null ? "NO_CONFIGURED_RULE" : "NO_EVIDENCE", evidence: "Los índices introducidos no tienen una regla local verificable." },
    consistency_assessment: { status: "NOT_CONFIGURED", evidence: "No se configuró una regla de consistencia local verificable." },
    triggered_rules: reviewRequired ? ["PROFESSIONAL_REVIEW_REQUIRED"] : [],
    evidence_chain: evidenceChain,
    final_status: finalStatus,
    professional_review: { reviewed_by: null, review_timestamp: null, professional_comment: null, professional_decision: "not_recorded" },
    knowledge_base_versions: { knowledge_base_version: "0.1.0", loinc_version: "NOT_INSTALLED", unit_dataset_version: "0.1.0", reference_interval_version: "NOT_INSTALLED", qc_rules_version: "NOT_INSTALLED", interference_rules_version: "NOT_INSTALLED", engine_version: engineVersion },
  };
}

function hash(value: string): string {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return (result >>> 0).toString(16).padStart(8, "0");
}

function sameDate(left: LocalRecord, right: LocalRecord): number {
  return `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`);
}

export function buildWorkspaceContext(records: LocalRecord[], patientId: string, sampleId: string): WorkspaceContext {
  const patientRecords = records.filter((record) => record.patient_id === patientId).sort(sameDate);
  const current = patientRecords.find((record) => record.sample_id === sampleId) ?? null;
  const historicalRecords = current ? patientRecords.filter((record) => record.id !== current.id && record.analyte === current.analyte && sameDate(record, current) < 0) : [];
  const profile = current ? validateLocally(current) : null;
  const selected = current;
  if (profile && selected && historicalRecords.length) {
    const previous = historicalRecords[historicalRecords.length - 1];
    const deltaInput = { previous_value: previous.value, previous_date: previous.date, current_value: selected.value, current_date: selected.date };
    if (previous.unit !== selected.unit) {
      profile.delta_check = { status: "DELTA_CHECK_INCOMPATIBLE_UNITS", reason: "La unidad del resultado previo no coincide con la actual." };
      profile.data_quality.issues = profile.data_quality.issues.filter((issue) => issue !== "DELTA_CHECK_NOT_AVAILABLE");
      profile.evidence_chain.push(evidence(selected, "delta_checks", "DELTA_CHECK_INCOMPATIBLE_UNITS", deltaInput));
    } else {
      const absoluteChange = selected.value - previous.value;
      const percentageChange = previous.value === 0 ? null : (absoluteChange / Math.abs(previous.value)) * 100;
      profile.delta_check = { status: "DELTA_CHECK_PERFORMED", reason: JSON.stringify({ previous_value: previous.value, previous_date: previous.date, current_value: selected.value, current_date: selected.date, absolute_change: absoluteChange, percentage_change: percentageChange }) };
      profile.data_quality.issues = profile.data_quality.issues.filter((issue) => issue !== "DELTA_CHECK_NOT_AVAILABLE");
      profile.evidence_chain.push(evidence(selected, "delta_checks", "DELTA_CHECK_PERFORMED", { ...deltaInput, absolute_change: absoluteChange, percentage_change: percentageChange }));
    }
  }
  if (profile) profile.result_id = `${profile.result_id}-${hash(JSON.stringify({ patientId, sampleId, historical: historicalRecords.map((record) => record.id) }))}`;
  const completeness = current ? [
    { field: "Current result", status: "AVAILABLE" as const },
    { field: "LOINC", status: current.loinc_code ? "AVAILABLE" as const : "MISSING" as const },
    { field: "Reference interval", status: "MISSING" as const },
    { field: "Previous result", status: historicalRecords.length ? "AVAILABLE" as const : "MISSING" as const },
    { field: "QC", status: current.qc_status ? "AVAILABLE" as const : "MISSING" as const },
    { field: "Specimen indices", status: current.hemolysis_index !== null || current.icterus_index !== null || current.lipemia_index !== null ? "AVAILABLE" as const : "OPTIONAL" as const },
  ] : [];
  const alerts: WorkspaceAlert[] = profile ? profile.data_quality.issues.map((issue) => ({ id: issue, title: issue.replaceAll("_", " "), status: profile.final_status, reason: issue, evidence: profile.evidence_chain.filter((item) => item.result === issue) })) : [];
  return { patientId, sampleId, current, patientRecords, historicalRecords, profile, completeness, alerts };
}
