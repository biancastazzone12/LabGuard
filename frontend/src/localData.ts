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

const fallbackKey = "labguard-professional-records";

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
