import { beforeEach, describe, expect, it } from "vitest";
import { clearProfessionalData, createRecord, deleteRecord, getAnalyteGroups, getProfessionalReview, getRecordById, getRecords, saveAnalyteGroup, saveProfessionalReview, updateRecord } from "./localData";
import { emptyDraft, validateDraft } from "./professionalRecords";
import { readableStatus } from "./presentation";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
} });

const validDraft = {
  ...emptyDraft, previous_value: "5.0", previous_date: "2026-01-14",
  patient_id: "patient-local-1", sample_id: "sample-local-1", date: "2026-01-15", time: "08:30", analyte: "glucose", value: "5.2", unit: "mmol/L", specimen: "serum", method: "method-1", instrument: "instrument-1", qc_status: "accepted",
};

describe("professional records", () => {
  beforeEach(() => { storage.clear(); });

  it("validates and creates a row", () => {
    const result = validateDraft(validDraft, []);
    expect(result.level).toBe("VALID");
    const record = createRecord(result.record!);
    expect(getRecordById(record.id)?.sample_id).toBe("sample-local-1");
  });

  it("rejects identical repeated rows and invalid values", () => {
    const first = createRecord(validateDraft(validDraft, []).record!);
    const duplicate = validateDraft(validDraft, [first]);
    expect(duplicate.level).toBe("ERROR");
    expect(duplicate.issues.map((item) => item.code)).toContain("DUPLICATE_RESULT");
    const invalid = validateDraft({ ...validDraft, value: "not-number" }, [first]);
    expect(invalid.issues.map((item) => item.code)).toContain("INVALID_NUMERIC_VALUE");
  });

  it("allows multiple different analytes in the same sample", () => {
    const first = createRecord(validateDraft(validDraft, []).record!);
    const second = validateDraft({ ...validDraft, analyte: "sodium", value: "140" }, [first]);
    expect(second.level).toBe("VALID");
    expect(second.record?.sample_id).toBe(first.sample_id);
  });

  it("allows a distinct repeat measurement of the same analyte and sample", () => {
    const first = createRecord(validateDraft(validDraft, []).record!);
    const repeated = validateDraft({ ...validDraft, value: "5.3", time: "08:45" }, [first]);
    expect(repeated.level).toBe("VALID");
    expect(repeated.record?.sample_id).toBe(first.sample_id);
  });

  it("does not warn for optional delta and QC context", () => {
    const warning = validateDraft({ ...validDraft, previous_value: "", previous_date: "", qc_status: "" }, []);
    expect(warning.level).toBe("VALID");
    expect(warning.record).toBeDefined();
    const error = validateDraft({ ...validDraft, date: "2026-02-31" }, []);
    expect(error.level).toBe("ERROR");
    expect(error.record).toBeUndefined();
  });

  it("normalizes common laboratory date and QC formats", () => {
    const result = validateDraft({ ...validDraft, date: "15/01/2026", previous_date: "14/01/2026", qc_status: "OK" }, []);
    expect(result.level).toBe("VALID");
    expect(result.record?.date).toBe("2026-01-15");
    expect(result.record?.qc_status).toBe("accepted");
  });

  it("allows a prior result from the same date when the older record has no separate time field", () => {
    const result = validateDraft({ ...validDraft, previous_date: validDraft.date }, []);
    expect(result.level).toBe("VALID");
  });

  it("reports a warning only when QC explicitly requires review", () => {
    const result = validateDraft({ ...validDraft, qc_status: "review_required" }, []);
    expect(result.level).toBe("WARNING");
    expect(result.issues.map((item) => item.code)).toContain("QC_REVIEW_REQUIRED");
  });

  it("updates, persists, deletes and clears records", () => {
    const record = createRecord(validateDraft(validDraft, []).record!);
    updateRecord({ ...record, value: 6.1 });
    expect(getRecords()[0].value).toBe(6.1);
    expect(getRecordById(record.id)?.value).toBe(6.1);
    deleteRecord(record.id);
    expect(getRecords()).toHaveLength(0);
    createRecord(validateDraft(validDraft, []).record!);
    clearProfessionalData();
    expect(getRecords()).toHaveLength(0);
  });

  it("persists review and configurable analyte groups, then clears them with professional data", () => {
    saveProfessionalReview("patient-1:sample-1", { reviewer: "professional", clinicalComment: "", professionalInterpretation: "", decision: "Sin decisión", timestamp: "2026-09-23T10:00:00.000Z" });
    saveAnalyteGroup("Glucose", "Metabolismo");
    expect(getProfessionalReview("patient-1:sample-1")?.reviewer).toBe("professional");
    expect(getAnalyteGroups().Glucose).toBe("Metabolismo");
    clearProfessionalData();
    expect(getProfessionalReview("patient-1:sample-1")).toBeNull();
    expect(getAnalyteGroups()).toEqual({});
  });

  it("keeps clinical wording explicit and non-diagnostic for structured outputs", () => {
    expect(readableStatus("VALIDATION_COMPLETE")).toBe("Verificación estructural completa");
    expect(readableStatus("INSUFFICIENT_DATA")).toContain("datos necesarios");
    expect(readableStatus("REVIEW_REQUIRED")).toContain("revisión profesional");
  });
});
