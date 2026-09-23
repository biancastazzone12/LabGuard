import { LocalRecord } from "./localData";

export type RecordDraft = {
  patient_id: string;
  sample_id: string;
  date: string;
  time: string;
  analyte: string;
  loinc_code: string;
  value: string;
  unit: string;
  specimen: string;
  method: string;
  instrument: string;
  flag: string;
  previous_value: string;
  previous_date: string;
  hemolysis_index: string;
  icterus_index: string;
  lipemia_index: string;
  qc_status: string;
};

export type ValidationLevel = "ERROR" | "WARNING" | "VALID";
export type ValidationIssue = { level: ValidationLevel; code: string; field?: keyof RecordDraft; message: string };
export type ValidationResult = { level: ValidationLevel; issues: ValidationIssue[]; record?: LocalRecord };

export const emptyDraft: RecordDraft = {
  patient_id: "", sample_id: "", date: "", time: "", analyte: "", loinc_code: "", value: "", unit: "", specimen: "", method: "", instrument: "", flag: "",
  previous_value: "", previous_date: "", hemolysis_index: "", icterus_index: "", lipemia_index: "", qc_status: "",
};

const requiredFields: Array<keyof RecordDraft> = ["patient_id", "sample_id", "date", "time", "analyte", "value", "unit", "specimen", "method", "instrument"];
const qcStatuses = new Set(["", "not_run", "accepted", "rejected", "review_required"]);

function normalizeDate(value: string): string {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [day, month, year] = value.split("/");
    return `${year}-${month}-${day}`;
  }
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(value)) return value.replaceAll("/", "-");
  return value;
}

function normalizeQcStatus(value: string): string {
  const normalized = value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (["ok", "pass", "passed", "valid", "accepted", "accept", "normal", "complete", "completed", "success", "in_control", "within_range"].includes(normalized)) return "accepted";
  if (["fail", "failed", "invalid", "rejected", "reject", "out_of_control"].includes(normalized)) return "rejected";
  if (["pending", "not_run", "not_done", "not_performed", "not_available", "na", "n_a"].includes(normalized)) return "not_run";
  if (["review", "review_required", "requires_review"].includes(normalized)) return "review_required";
  return normalized;
}

function numberValue(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validTime(value: string): boolean { return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value); }
function issue(level: ValidationLevel, code: string, message: string, field?: keyof RecordDraft): ValidationIssue { return { level, code, message, field }; }

export function draftFromRecord(record: LocalRecord): RecordDraft {
  return {
    patient_id: record.patient_id, sample_id: record.sample_id, date: record.date, time: record.time, analyte: record.analyte, loinc_code: record.loinc_code ?? "",
    value: String(record.value), unit: record.unit, specimen: record.specimen, method: record.method, instrument: record.instrument,
    flag: record.flag, previous_value: record.previous_value == null ? "" : String(record.previous_value), previous_date: record.previous_date ?? "",
    hemolysis_index: record.hemolysis_index == null ? "" : String(record.hemolysis_index), icterus_index: record.icterus_index == null ? "" : String(record.icterus_index),
    lipemia_index: record.lipemia_index == null ? "" : String(record.lipemia_index), qc_status: record.qc_status,
  };
}

export function validateDraft(draft: RecordDraft, existing: LocalRecord[], editingId?: string): ValidationResult {
  const normalizedDraft = { ...draft, date: normalizeDate(draft.date), previous_date: normalizeDate(draft.previous_date), qc_status: normalizeQcStatus(draft.qc_status) };
  draft = normalizedDraft;
  const issues: ValidationIssue[] = [];
  requiredFields.forEach((field) => { if (!draft[field].trim()) issues.push(issue("ERROR", "REQUIRED_FIELD_MISSING", `${field} es obligatorio.`, field)); });
  if (draft.sample_id.trim() && existing.some((record) => record.sample_id === draft.sample_id.trim() && record.id !== editingId)) issues.push(issue("ERROR", "DUPLICATE_SAMPLE_ID", "sample_id ya existe.", "sample_id"));
  if (draft.date && !validDate(draft.date)) issues.push(issue("ERROR", "INVALID_DATE", "date no es válida. Use AAAA-MM-DD.", "date"));
  if (draft.time && !validTime(draft.time)) issues.push(issue("ERROR", "INVALID_TIME", "time no es válida. Use HH:MM o HH:MM:SS.", "time"));
  const value = numberValue(draft.value);
  if (Number.isNaN(value)) issues.push(issue("ERROR", "INVALID_NUMERIC_VALUE", "value debe ser numérico.", "value"));
  const optionalNumbers: Array<keyof RecordDraft> = ["previous_value", "hemolysis_index", "icterus_index", "lipemia_index"];
  optionalNumbers.forEach((field) => { if (Number.isNaN(numberValue(draft[field]))) issues.push(issue("ERROR", "INVALID_NUMERIC_VALUE", `${field} debe ser numérico.`, field)); });
  if (draft.qc_status && !qcStatuses.has(draft.qc_status)) issues.push(issue("ERROR", "INVALID_QC_STATUS", "qc_status no es válido.", "qc_status"));
  if (draft.qc_status === "review_required") issues.push(issue("WARNING", "QC_REVIEW_REQUIRED", "qc_status indica que el control de calidad requiere revisión.", "qc_status"));
  if (draft.previous_date && !validDate(draft.previous_date)) issues.push(issue("ERROR", "INVALID_DATE", "previous_date no es válida.", "previous_date"));
  const previousValue = numberValue(draft.previous_value);
  if ((draft.previous_date && previousValue == null) || (!draft.previous_date && previousValue != null)) issues.push(issue("ERROR", "INCOMPLETE_PREVIOUS_RESULT", "previous_value y previous_date deben informarse juntos."));
  if (draft.previous_date && draft.date && validDate(draft.previous_date) && validDate(draft.date) && draft.previous_date >= draft.date) issues.push(issue("ERROR", "INVALID_PREVIOUS_DATE", "previous_date debe ser anterior a date.", "previous_date"));
  const errors = issues.filter((item) => item.level === "ERROR");
  const warnings = issues.filter((item) => item.level === "WARNING");
  if (errors.length) return { level: "ERROR", issues };
  const record: LocalRecord = {
    id: editingId ?? crypto.randomUUID(), patient_id: draft.patient_id.trim(), sample_id: draft.sample_id.trim(), date: draft.date, time: draft.time,
    analyte: draft.analyte.trim(), loinc_code: draft.loinc_code.trim() || null, value: value as number, unit: draft.unit.trim(), specimen: draft.specimen.trim(), method: draft.method.trim(), instrument: draft.instrument.trim(), flag: draft.flag.trim(),
    previous_value: previousValue, previous_date: draft.previous_date || null, hemolysis_index: numberValue(draft.hemolysis_index), icterus_index: numberValue(draft.icterus_index), lipemia_index: numberValue(draft.lipemia_index), qc_status: draft.qc_status,
  };
  return { level: warnings.length ? "WARNING" : "VALID", issues, record };
}

export function draftFromInput(input: Record<string, unknown>): RecordDraft {
  const value = (field: keyof RecordDraft): string => input[field] == null ? "" : String(input[field]);
  return {
    patient_id: value("patient_id"), sample_id: value("sample_id"), date: normalizeDate(value("date")), time: value("time"), analyte: value("analyte"), loinc_code: value("loinc_code"), value: value("value"), unit: value("unit"), specimen: value("specimen"), method: value("method"), instrument: value("instrument"), flag: value("flag"), previous_value: value("previous_value"), previous_date: normalizeDate(value("previous_date")), hemolysis_index: value("hemolysis_index"), icterus_index: value("icterus_index"), lipemia_index: value("lipemia_index"), qc_status: normalizeQcStatus(value("qc_status")),
  };
}
