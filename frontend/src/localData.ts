export type LocalRecord = {
  id: string;
  patient_id: string;
  sample_id: string;
  date: string;
  time: string;
  analyte: string;
  loinc_code?: string | null;
  value: number;
  unit: string;
  specimen: string;
  method: string;
  instrument: string;
  flag: string;
  previous_value: number | null;
  previous_date: string | null;
  hemolysis_index: number | null;
  icterus_index: number | null;
  lipemia_index: number | null;
  qc_status: string;
};

export type ProfessionalReview = {
  reviewer: string;
  clinicalComment: string;
  professionalInterpretation: string;
  decision: string;
  timestamp: string;
};

const fallbackKey = "labguard-professional-records";
const reviewKey = "labguard-professional-reviews";
const groupKey = "labguard-analyte-groups";

function readFallback(): LocalRecord[] {
  try { return JSON.parse(localStorage.getItem(fallbackKey) ?? "[]") as LocalRecord[]; } catch { return []; }
}

function writeFallback(records: LocalRecord[]): void {
  localStorage.setItem(fallbackKey, JSON.stringify(records));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("labguard-records-changed"));
}

export function listLocalRecords(): LocalRecord[] {
  return readFallback();
}

export function saveLocalRecords(records: LocalRecord[]): void {
  const current = readFallback();
  const byId = new Map(current.map((record) => [record.id, record]));
  records.forEach((record) => byId.set(record.id, record));
  writeFallback([...byId.values()]);
}

export function deleteLocalRecord(id: string): void {
  writeFallback(readFallback().filter((record) => record.id !== id));
}

export function updateLocalRecord(record: LocalRecord): void {
  saveLocalRecords([record]);
}

export function clearLocalRecords(): void {
  writeFallback([]);
  localStorage.removeItem(reviewKey);
  localStorage.removeItem(groupKey);
}

export function getProfessionalReview(key: string): ProfessionalReview | null {
  try {
    const reviews = JSON.parse(localStorage.getItem(reviewKey) ?? "{}") as Record<string, ProfessionalReview>;
    return reviews[key] ?? null;
  } catch {
    return null;
  }
}

export function saveProfessionalReview(key: string, review: ProfessionalReview): void {
  const reviews = (() => {
    try { return JSON.parse(localStorage.getItem(reviewKey) ?? "{}") as Record<string, ProfessionalReview>; } catch { return {}; }
  })();
  reviews[key] = review;
  localStorage.setItem(reviewKey, JSON.stringify(reviews));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("labguard-records-changed"));
}

export function getAnalyteGroups(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(groupKey) ?? "{}") as Record<string, string>; } catch { return {}; }
}

export function saveAnalyteGroup(analyte: string, group: string): void {
  const groups = getAnalyteGroups();
  groups[analyte] = group;
  localStorage.setItem(groupKey, JSON.stringify(groups));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("labguard-records-changed"));
}

export const createRecord = (record: LocalRecord): LocalRecord => {
  const created = { ...record, id: record.id || crypto.randomUUID() };
  saveLocalRecords([created]);
  return created;
};

export const getRecords = listLocalRecords;
export const getRecordById = (id: string): LocalRecord | undefined => listLocalRecords().find((record) => record.id === id);
export const updateRecord = updateLocalRecord;
export const deleteRecord = deleteLocalRecord;
export const clearProfessionalData = clearLocalRecords;
