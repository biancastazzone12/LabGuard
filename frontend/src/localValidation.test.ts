import { describe, expect, it } from "vitest";
import { buildWorkspaceContext } from "./localValidation";
import { LocalRecord } from "./localData";

function record(overrides: Partial<LocalRecord> = {}): LocalRecord {
  return {
    id: "result-1", patient_id: "patient-1", sample_id: "sample-1", date: "2026-01-02", time: "08:00", analyte: "glucose", loinc_code: null,
    value: 100, unit: "mg/dL", specimen: "serum", method: "method-1", instrument: "instrument-1", flag: "", previous_value: null, previous_date: null,
    hemolysis_index: null, icterus_index: null, lipemia_index: null, qc_status: "", ...overrides,
  };
}

describe("smart validation workspace", () => {
  it("reports unavailable delta without inventing history", () => {
    const context = buildWorkspaceContext([record()], "patient-1", "sample-1");
    expect(context.profile?.delta_check.status).toBe("DELTA_CHECK_NOT_AVAILABLE");
    expect(context.historicalRecords).toHaveLength(0);
  });

  it("performs delta with the latest compatible stored result", () => {
    const context = buildWorkspaceContext([
      record({ id: "old", sample_id: "sample-old", date: "2026-01-01", value: 80 }),
      record({ id: "current", sample_id: "sample-current", date: "2026-01-02", value: 100 }),
    ], "patient-1", "sample-current");
    expect(context.profile?.delta_check.status).toBe("DELTA_CHECK_PERFORMED");
    expect(context.profile?.delta_check.reason).toContain("percentage_change");
  });

  it("does not calculate delta across incompatible units", () => {
    const context = buildWorkspaceContext([
      record({ id: "old", sample_id: "sample-old", date: "2026-01-01", value: 80, unit: "mmol/L" }),
      record({ id: "current", sample_id: "sample-current", date: "2026-01-02", value: 100, unit: "mg/dL" }),
    ], "patient-1", "sample-current");
    expect(context.profile?.delta_check.status).toBe("DELTA_CHECK_INCOMPATIBLE_UNITS");
  });

  it("preserves specimen inputs and produces the same profile twice", () => {
    const input = [record({ hemolysis_index: 2.5, qc_status: "accepted" })];
    const first = buildWorkspaceContext(input, "patient-1", "sample-1");
    const second = buildWorkspaceContext(input, "patient-1", "sample-1");
    expect(first.profile?.specimen_quality.status).toBe("AVAILABLE_FOR_REVIEW");
    expect(first.profile).toEqual(second.profile);
  });
});
