import { describe, expect, it } from "vitest";
import { buildClinicalTimeline, compareClinicalResults, compareClinicalSnapshots, createClinicalPatternReport, observedChangeCount } from "./clinicalPattern";
import { LocalRecord } from "./localData";

function record(overrides: Partial<LocalRecord> = {}): LocalRecord {
  return {
    id: "result-1", patient_id: "patient-1", sample_id: "sample-1", date: "2026-09-20", time: "08:00", analyte: "Glucosa", loinc_code: null,
    value: 92, unit: "mg/dL", specimen: "serum", method: "method-a", instrument: "instrument-a", flag: "", previous_value: null, previous_date: null,
    hemolysis_index: null, icterus_index: null, lipemia_index: null, qc_status: "", ...overrides,
  };
}

describe("Clinical Pattern Explorer services", () => {
  it("returns no history and insufficient data for one result", () => {
    const timeline = buildClinicalTimeline([record()], "patient-1");
    expect(timeline).toHaveLength(1);
    expect(compareClinicalResults(null, timeline[0].records[0]).status).toBe("INSUFFICIENT_DATA");
  });

  it("builds multiple chronological snapshots only from the selected patient", () => {
    const rows = [record(), record({ id: "later", sample_id: "sample-2", date: "2026-09-23", value: 118 }), record({ id: "other", patient_id: "patient-2" })];
    const timeline = buildClinicalTimeline(rows, "patient-1");
    expect(timeline.map((snapshot) => snapshot.sampleId)).toEqual(["sample-1", "sample-2"]);
  });

  it("calculates absolute, relative and elapsed changes for exact compatible units", () => {
    const comparison = compareClinicalResults(record(), record({ id: "later", sample_id: "sample-2", date: "2026-09-23", value: 118 }));
    expect(comparison.status).toBe("COMPARISON_PERFORMED");
    expect(comparison.absoluteChange).toBe(26);
    expect(comparison.percentageChange).toBeCloseTo(28.2608);
    expect(comparison.elapsedMilliseconds).toBe(3 * 24 * 60 * 60 * 1000);
    expect(comparison.evidence.formula).toBe("valor actual - valor previo");
  });

  it("does not convert incompatible units", () => {
    const comparison = compareClinicalResults(record(), record({ id: "later", unit: "mmol/L" }));
    expect(comparison.status).toBe("COMPARISON_UNAVAILABLE");
    expect(comparison.absoluteChange).toBeNull();
  });

  it("reports missing, invalid and inverted timestamps without calculating", () => {
    expect(compareClinicalResults(record(), null).status).toBe("INSUFFICIENT_DATA");
    expect(compareClinicalResults(record({ date: "2026-02-30" }), record({ id: "later" })).status).toBe("INSUFFICIENT_DATA");
    expect(compareClinicalResults(record({ date: "2026-09-23" }), record({ id: "earlier", date: "2026-09-20" })).status).toBe("INSUFFICIENT_DATA");
  });

  it("handles a zero prior value without division by zero", () => {
    const comparison = compareClinicalResults(record({ value: 0 }), record({ id: "later", date: "2026-09-23", value: 2 }));
    expect(comparison.absoluteChange).toBe(2);
    expect(comparison.percentageChange).toBeNull();
  });

  it("does not choose arbitrarily when a snapshot has duplicate analytes", () => {
    const snapshots = buildClinicalTimeline([record(), record({ id: "duplicate", value: 93 }), record({ id: "later", sample_id: "sample-2", date: "2026-09-23", value: 100 })], "patient-1");
    const result = compareClinicalSnapshots(snapshots[0], snapshots[1], ["Glucosa"])[0];
    expect(result.comparison.status).toBe("INSUFFICIENT_DATA");
    expect(result.comparison.reason).toContain("más de un resultado");
    expect(observedChangeCount([result])).toBe(0);
  });

  it("does not compare results with equal labels across reversed or invalid dates", () => {
    const equalDate = compareClinicalResults(record(), record({ id: "same-time", sample_id: "sample-2" }));
    expect(equalDate.elapsedMilliseconds).toBe(0);
    expect(equalDate.status).toBe("COMPARISON_PERFORMED");
  });

  it("keeps long histories in chronological order", () => {
    const rows = Array.from({ length: 120 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
      return record({ id: `result-${index}`, sample_id: `sample-${index}`, date, value: index });
    });
    const timeline = buildClinicalTimeline(rows, "patient-1");
    expect(timeline).toHaveLength(120);
    expect(timeline[0].date).toBe("2026-01-01");
    expect(timeline.at(-1)?.date).toBe("2026-04-30");
  });

  it("exports source record identifiers, calculations and explicit unavailable reference metadata", () => {
    const timeline = buildClinicalTimeline([record(), record({ id: "later", sample_id: "sample-2", date: "2026-09-23", value: 118 })], "patient-1");
    const observations = compareClinicalSnapshots(timeline[0], timeline[1], ["Glucosa"]);
    const report = createClinicalPatternReport("patient-1", timeline[0], timeline[1], observations, "2026-09-27T10:00:00.000Z");
    expect(report.observation_category).toBe("DATA_COMPARISON");
    expect(report.observations[0].previous_result_id).toBe("result-1");
    expect(report.observations[0].absolute_change).toBe(26);
    expect(report.observations[0].reference_interval_status).toBe("NOT_CONSULTED");
    expect(report.generated_at).toBe("2026-09-27T10:00:00.000Z");
    expect(JSON.stringify(report)).not.toMatch(/diagnosis|diagnostic probability|disease|treatment recommendation/i);
  });

  it("compares all analytes from the two snapshots when the analyte list is empty", () => {
    const previous = buildClinicalTimeline([
      record({ id: "glucose-old", sample_id: "sample-1", analyte: "Glucosa", value: 90 }),
      record({ id: "creatinine-old", sample_id: "sample-1", analyte: "Creatinina", value: 0.9 }),
    ], "patient-1")[0];
    const current = buildClinicalTimeline([
      record({ id: "glucose-new", sample_id: "sample-2", date: "2026-09-23", analyte: "Glucosa", value: 100 }),
      record({ id: "creatinine-new", sample_id: "sample-2", date: "2026-09-23", analyte: "Creatinina", value: 1.0 }),
      record({ id: "sodium-new", sample_id: "sample-2", date: "2026-09-23", analyte: "Sodio", value: 140 }),
    ], "patient-1")[0];

    const observations = compareClinicalSnapshots(previous, current, []);
    expect(observations.map((item) => item.analyte).sort()).toEqual(["Creatinina", "Glucosa", "Sodio"]);
    expect(observations.filter((item) => item.comparison.status === "INSUFFICIENT_DATA")).toHaveLength(1);
  });

  it("honors date filters without mutating stored records", () => {
    const rows = [record(), record({ id: "later", sample_id: "sample-2", date: "2026-09-23", value: 118 })];
    const filtered = buildClinicalTimeline(rows, "patient-1", "2026-09-21", "2026-09-27");
    expect(filtered).toHaveLength(1);
    expect(rows[0].value).toBe(92);
    expect(rows[1].value).toBe(118);
  });
});
