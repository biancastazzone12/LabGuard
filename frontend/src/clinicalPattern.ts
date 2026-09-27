import { LocalRecord } from "./localData";

export type ClinicalSnapshot = {
  id: string;
  sampleId: string;
  date: string;
  time: string;
  records: LocalRecord[];
};

export type ClinicalComparison = {
  status: "COMPARISON_PERFORMED" | "COMPARISON_UNAVAILABLE" | "INSUFFICIENT_DATA";
  previous: LocalRecord | null;
  current: LocalRecord | null;
  absoluteChange: number | null;
  percentageChange: number | null;
  elapsedMilliseconds: number | null;
  unit: string | null;
  reason: string;
  evidence: Record<string, unknown>;
};

export type PatternObservation = {
  analyte: string;
  previous: LocalRecord | null;
  current: LocalRecord | null;
  comparison: ClinicalComparison;
};

export type ClinicalPatternReport = {
  report_type: "Clinical Pattern Explorer";
  observation_category: "DATA_COMPARISON";
  patient_id: string;
  generated_at: string;
  previous_snapshot: { sample_id: string; date: string; time: string } | null;
  current_snapshot: { sample_id: string; date: string; time: string } | null;
  engine_version: string;
  knowledge_base_status: string;
  observations: Array<{
    analyte: string;
    result: string;
    previous_result_id: string | null;
    current_result_id: string | null;
    previous_value: number | null;
    current_value: number | null;
    unit: string | null;
    absolute_change: number | null;
    percentage_change: number | null;
    elapsed_milliseconds: number | null;
    reference_interval_status: string;
    formula: string | null;
    evidence: Record<string, unknown>;
  }>;
};

export const suggestedGroups = [
  "Hematología",
  "Metabolismo",
  "Función renal",
  "Función hepática",
  "Electrolitos",
  "Perfil lipídico",
  "Endocrinología",
  "Otros",
];

function timestamp(record: Pick<LocalRecord, "date" | "time">): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(record.time)) return null;
  const [year, month, day] = record.date.split("-").map(Number);
  const [hour, minute, second = 0] = record.time.split(":").map(Number);
  const dateValue = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (dateValue.getUTCFullYear() !== year || dateValue.getUTCMonth() !== month - 1 || dateValue.getUTCDate() !== day || dateValue.getUTCHours() !== hour || dateValue.getUTCMinutes() !== minute) return null;
  return dateValue.getTime();
}

export function recordTimestamp(record: Pick<LocalRecord, "date" | "time">): number | null {
  return timestamp(record);
}

export function buildClinicalTimeline(records: LocalRecord[], patientId: string, fromDate = "", toDate = ""): ClinicalSnapshot[] {
  const buckets = new Map<string, LocalRecord[]>();
  for (const record of records) {
    if (record.patient_id !== patientId || (fromDate && record.date < fromDate) || (toDate && record.date > toDate)) continue;
    const id = `${record.date}T${record.time}|${record.sample_id}`;
    buckets.set(id, [...(buckets.get(id) ?? []), record]);
  }
  return [...buckets.entries()].map(([id, bucket]) => ({
    id,
    sampleId: bucket[0].sample_id,
    date: bucket[0].date,
    time: bucket[0].time,
    records: bucket.sort((left, right) => left.analyte.localeCompare(right.analyte) || left.id.localeCompare(right.id)),
  })).sort((left, right) => `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`) || left.sampleId.localeCompare(right.sampleId));
}

export function compareClinicalResults(previous: LocalRecord | null, current: LocalRecord | null): ClinicalComparison {
  if (!previous || !current) return { status: "INSUFFICIENT_DATA", previous, current, absoluteChange: null, percentageChange: null, elapsedMilliseconds: null, unit: null, reason: "Falta seleccionar ambos resultados.", evidence: { previous_id: previous?.id ?? null, current_id: current?.id ?? null } };
  const inputs = { previous_id: previous.id, current_id: current.id, previous_value: previous.value, current_value: current.value, previous_unit: previous.unit, current_unit: current.unit, previous_date: previous.date, previous_time: previous.time, current_date: current.date, current_time: current.time };
  if (previous.analyte !== current.analyte) return { status: "COMPARISON_UNAVAILABLE", previous, current, absoluteChange: null, percentageChange: null, elapsedMilliseconds: null, unit: null, reason: "Los analitos seleccionados no coinciden.", evidence: inputs };
  if (!Number.isFinite(previous.value) || !Number.isFinite(current.value)) return { status: "INSUFFICIENT_DATA", previous, current, absoluteChange: null, percentageChange: null, elapsedMilliseconds: null, unit: null, reason: "Uno de los valores almacenados no es un número finito.", evidence: inputs };
  if (!previous.unit.trim() || !current.unit.trim() || previous.unit.trim().toLocaleLowerCase() !== current.unit.trim().toLocaleLowerCase()) return { status: "COMPARISON_UNAVAILABLE", previous, current, absoluteChange: null, percentageChange: null, elapsedMilliseconds: null, unit: null, reason: "Las unidades no coinciden exactamente; no se aplicó ninguna conversión.", evidence: inputs };
  const previousTime = timestamp(previous);
  const currentTime = timestamp(current);
  if (previousTime === null || currentTime === null) return { status: "INSUFFICIENT_DATA", previous, current, absoluteChange: null, percentageChange: null, elapsedMilliseconds: null, unit: previous.unit, reason: "Falta una fecha u hora válida.", evidence: inputs };
  if (currentTime < previousTime) return { status: "INSUFFICIENT_DATA", previous, current, absoluteChange: null, percentageChange: null, elapsedMilliseconds: currentTime - previousTime, unit: previous.unit, reason: "El resultado actual es anterior al previo.", evidence: inputs };
  const absoluteChange = current.value - previous.value;
  const percentageChange = previous.value === 0 ? null : absoluteChange / Math.abs(previous.value) * 100;
  return { status: "COMPARISON_PERFORMED", previous, current, absoluteChange, percentageChange, elapsedMilliseconds: currentTime - previousTime, unit: previous.unit, reason: "Comparación directa entre resultados del mismo analito y unidad.", evidence: { ...inputs, absolute_change: absoluteChange, percentage_change: percentageChange, elapsed_milliseconds: currentTime - previousTime, formula: "valor actual - valor previo" } };
}

function uniqueAnalyteRecord(snapshot: ClinicalSnapshot, analyte: string): LocalRecord | null {
  const matches = snapshot.records.filter((record) => record.analyte === analyte);
  return matches.length === 1 ? matches[0] : null;
}

export function compareClinicalSnapshots(previous: ClinicalSnapshot | null, current: ClinicalSnapshot | null, analytes: string[]): PatternObservation[] {
  if (!previous || !current) return [];
  const availableAnalytes = [...new Set([
    ...previous.records.map((record) => record.analyte),
    ...current.records.map((record) => record.analyte),
  ])].sort((left, right) => left.localeCompare(right));
  const selectedAnalytes = analytes.length ? [...new Set(analytes)] : availableAnalytes;

  return selectedAnalytes.map((analyte) => {
    const previousMatches = previous.records.filter((record) => record.analyte === analyte);
    const currentMatches = current.records.filter((record) => record.analyte === analyte);
    const previousRecord = uniqueAnalyteRecord(previous, analyte);
    const currentRecord = uniqueAnalyteRecord(current, analyte);
    let comparison = compareClinicalResults(previousRecord, currentRecord);
    if (!previousMatches.length || !currentMatches.length) {
      comparison = { ...comparison, status: "INSUFFICIENT_DATA", reason: "No hay un resultado de este analito en ambos momentos seleccionados.", evidence: { previous_snapshot: previous.id, current_snapshot: current.id, analyte } };
    } else if (previousMatches.length > 1 || currentMatches.length > 1) {
      comparison = { ...comparison, status: "INSUFFICIENT_DATA", reason: "Hay más de un resultado del mismo analito en uno de los momentos; la comparación no es única.", evidence: { previous_snapshot: previous.id, current_snapshot: current.id, analyte, previous_count: previousMatches.length, current_count: currentMatches.length } };
    }
    return { analyte, previous: previousRecord, current: currentRecord, comparison };
  });
}

export function relatedClinicalResults(records: LocalRecord[], selected: LocalRecord): LocalRecord[] {
  return records.filter((record) => record.patient_id === selected.patient_id && record.id !== selected.id && record.sample_id === selected.sample_id)
    .sort((left, right) => left.analyte.localeCompare(right.analyte) || left.id.localeCompare(right.id));
}

export function observedChangeCount(observations: PatternObservation[]): number {
  return observations.filter((item) => item.comparison.status === "COMPARISON_PERFORMED" && item.comparison.absoluteChange !== 0).length;
}

export function createClinicalPatternReport(patientId: string, previous: ClinicalSnapshot | null, current: ClinicalSnapshot | null, observations: PatternObservation[], generatedAt = new Date().toISOString()): ClinicalPatternReport {
  return {
    report_type: "Clinical Pattern Explorer",
    observation_category: "DATA_COMPARISON",
    patient_id: patientId,
    generated_at: generatedAt,
    previous_snapshot: previous ? { sample_id: previous.sampleId, date: previous.date, time: previous.time } : null,
    current_snapshot: current ? { sample_id: current.sampleId, date: current.date, time: current.time } : null,
    engine_version: "frontend-local-0.1.0",
    knowledge_base_status: "No se consultaron reglas ni intervalos; no se aplicaron umbrales ni conversiones.",
    observations: observations.map(({ analyte, previous: before, current: after, comparison }) => ({
      analyte,
      result: comparison.status,
      previous_result_id: before?.id ?? null,
      current_result_id: after?.id ?? null,
      previous_value: before?.value ?? null,
      current_value: after?.value ?? null,
      unit: comparison.unit,
      absolute_change: comparison.absoluteChange,
      percentage_change: comparison.percentageChange,
      elapsed_milliseconds: comparison.elapsedMilliseconds,
      reference_interval_status: "NOT_CONSULTED",
      formula: comparison.status === "COMPARISON_PERFORMED" ? "valor actual - valor previo" : null,
      evidence: comparison.evidence,
    })),
  };
}
