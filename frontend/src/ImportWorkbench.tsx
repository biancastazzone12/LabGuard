import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { clearProfessionalData, createRecord, deleteRecord, getRecordById, getRecords, LocalRecord, updateRecord } from "./localData";
import { draftFromInput, draftFromRecord, emptyDraft, RecordDraft, validateDraft, ValidationIssue, ValidationLevel, ValidationResult } from "./professionalRecords";
import { LocalValidationProfile, validateLocally } from "./localValidation";

const fields: Array<{ name: keyof RecordDraft; label: string; type?: string; required?: boolean }> = [
  { name: "patient_id", label: "Patient ID", required: true }, { name: "sample_id", label: "Sample ID", required: true }, { name: "date", label: "Date", type: "date", required: true }, { name: "time", label: "Time", type: "time", required: true },
  { name: "analyte", label: "Analyte", required: true }, { name: "loinc_code", label: "LOINC code" }, { name: "value", label: "Value", type: "number", required: true }, { name: "unit", label: "Unit", required: true }, { name: "specimen", label: "Specimen", required: true },
  { name: "method", label: "Method", required: true }, { name: "instrument", label: "Instrument", required: true }, { name: "flag", label: "Flag" }, { name: "previous_value", label: "Previous value", type: "number" }, { name: "previous_date", label: "Previous date", type: "date" },
  { name: "hemolysis_index", label: "Hemolysis index", type: "number" }, { name: "icterus_index", label: "Icterus index", type: "number" }, { name: "lipemia_index", label: "Lipemia index", type: "number" },
];
const requiredHeaders = fields.map((field) => field.name).concat("qc_status");
const minimumHeaders = fields.filter((field) => field.required).map((field) => field.name);
const csvEscape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

type PreviewItem = { row: number; validation: ValidationResult };
type EngineResult = { profile: LocalValidationProfile };

function parseDelimited(text: string): { headers: string[]; rows: Record<string, string>[]; delimiter: string } {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ";" : ",";
  const cells: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') { if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted; }
    else if (character === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) { if (character === "\r" && source[index + 1] === "\n") index += 1; row.push(cell.trim()); cells.push(row); row = []; cell = ""; }
    else cell += character;
  }
  if (quoted) throw new Error("CSV con comillas sin cerrar");
  if (cell || row.length) { row.push(cell.trim()); cells.push(row); }
  const headers = (cells.shift() ?? []).map((header) => header.trim().toLowerCase());
  return { delimiter, headers, rows: cells.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))) };
}

function parseSource(text: string, format: string): Record<string, unknown>[] {
  if (format === "json") {
    const payload = JSON.parse(text);
    const rows = Array.isArray(payload) ? payload : payload.records;
    if (!Array.isArray(rows) || !rows.every((row) => row && typeof row === "object")) throw new Error("JSON debe contener una lista de registros");
    return rows;
  }
  const parsed = parseDelimited(text);
  const missing = minimumHeaders.filter((header) => !parsed.headers.includes(header));
  if (missing.length) throw new Error(`Faltan columnas: ${missing.join(", ")}`);
  return parsed.rows;
}

function levelClass(level: ValidationLevel): string { return `validation-${level.toLowerCase()}`; }
function issueText(issue: ValidationIssue): string { return `${issue.level === "VALID" ? "Correcto" : issue.level === "WARNING" ? "Revisar" : "Error"}: ${issue.message}`; }

export function ImportWorkbench() {
  const [records, setRecords] = useState<LocalRecord[]>([]);
  const [draft, setDraft] = useState<RecordDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewItem[]>([]);
  const [format, setFormat] = useState("csv");
  const [message, setMessage] = useState("");
  const [engineResults, setEngineResults] = useState<Record<string, EngineResult>>({});

  useEffect(() => { setRecords(getRecords()); }, []);

  const validate = () => {
    const result = validateDraft(draft, records, editingId);
    setValidation(result);
    return result;
  };
  const updateDraft = (name: keyof RecordDraft, value: string) => { setDraft((current) => ({ ...current, [name]: value })); setValidation(null); };

  const saveDraft = (event?: FormEvent) => {
    event?.preventDefault();
    const result = validation ?? validate();
    if (result.level === "ERROR" || !result.record) { setMessage("No se puede guardar: corregí los errores críticos."); return; }
    if (result.level === "WARNING" && !window.confirm("La fila contiene warnings. ¿Guardar de todos modos?")) return;
    if (editingId) updateRecord(result.record); else createRecord(result.record);
    setRecords(getRecords()); setDraft(emptyDraft); setEditingId(undefined); setValidation(null);
    setMessage("Fila guardada localmente.");
  };

  const startEdit = (record: LocalRecord) => { setEditingId(record.id); setDraft(draftFromRecord(record)); setValidation(null); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const remove = (record: LocalRecord) => { if (!window.confirm(`¿Eliminar ${record.sample_id}?`)) return; deleteRecord(record.id); setRecords(getRecords()); setMessage("Registro eliminado."); };
  const clearAll = () => { if (!window.confirm("¿Eliminar todos los datos profesionales locales?")) return; clearProfessionalData(); setRecords([]); setMessage("Datos profesionales eliminados. Knowledge Base y reglas no fueron modificadas."); };

  const readFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    const nextFormat = file.name.toLowerCase().endsWith(".json") ? "json" : "csv"; setFormat(nextFormat);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const sourceRows = parseSource(String(reader.result), nextFormat);
        const accepted: LocalRecord[] = [];
        const rows = sourceRows.map((sourceRow, index) => {
          const result = validateDraft(draftFromInput(sourceRow), [...records, ...accepted]);
          if (result.record) accepted.push(result.record);
          return { row: index + 2, validation: result };
        });
        setPreviewRows(rows); setMessage(`${rows.filter((row) => row.validation.level === "VALID").length} válidas, ${rows.filter((row) => row.validation.level === "WARNING").length} con warnings, ${rows.filter((row) => row.validation.level === "ERROR").length} con errores.`);
      } catch (error) { setPreviewRows([{ row: 1, validation: { level: "ERROR", issues: [{ level: "ERROR", code: "INVALID_STRUCTURE", message: String(error) }] } }]); }
    };
    reader.onerror = () => setMessage("No se pudo leer el archivo.");
    reader.readAsText(file); event.currentTarget.value = "";
  };

  const saveValidImports = () => {
    const validRows = previewRows.filter((row) => row.validation.record && row.validation.level !== "ERROR");
    if (!validRows.length) { setMessage("No hay filas válidas para guardar."); return; }
    const warningCount = validRows.filter((row) => row.validation.level === "WARNING").length;
    if (warningCount && !window.confirm(`${warningCount} fila(s) tienen warnings. ¿Guardar las filas válidas?`)) return;
    validRows.forEach((row) => createRecord(row.validation.record!));
    setRecords(getRecords()); setPreviewRows([]); setMessage(`${validRows.length} fila(s) guardada(s) localmente.`);
  };

  const validateStored = (record: LocalRecord) => {
    const storedRecord = getRecordById(record.id);
    if (!storedRecord) { setMessage("El registro ya no existe en el almacenamiento local."); return; }
    const profile = validateLocally(storedRecord);
    setEngineResults((current) => ({ ...current, [record.id]: { profile } }));
    setMessage(`${record.sample_id} evaluado localmente: ${profile.final_status}.`);
  };

  const exportReport = (record: LocalRecord) => {
    const profile = engineResults[record.id]?.profile ?? validateLocally(record);
    const content = JSON.stringify({ report_type: "Validation Report", system_analysis: profile, professional_decision: profile.professional_review }, null, 2);
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type: "application/json" })); link.download = `labguard-validation-report-${record.sample_id}.json`; link.click(); URL.revokeObjectURL(link.href);
  };

  const exportRecords = (targetFormat: "csv" | "json") => {
    const content = targetFormat === "json" ? JSON.stringify(records, null, 2) : [requiredHeaders.join(","), ...records.map((record) => requiredHeaders.map((header) => csvEscape(record[header as keyof LocalRecord])).join(","))].join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type: targetFormat === "json" ? "application/json" : "text/csv" })); link.download = `labguard-professional-records.${targetFormat}`; link.click(); URL.revokeObjectURL(link.href);
  };

  return <section className="local-data-panel" id="datos-locales">
    <div className="section-heading"><div><p className="section-kicker">Modo profesional · almacenamiento local</p><h2>Datos profesionales</h2></div><span className="local-badge">SIN API KEY · SIN INICIO DE SESIÓN</span></div>
    <p className="privacy-note">Los datos permanecen en este navegador mediante almacenamiento local. La validación local no realiza solicitudes de red, no usa API keys y no envía resultados fuera del dispositivo.</p>
    <section className="professional-form" aria-labelledby="new-result-title">
      <div className="form-heading"><h3 id="new-result-title">{editingId ? "Editar resultado" : "Nuevo resultado"}</h3><button type="button" onClick={() => { setDraft(emptyDraft); setEditingId(undefined); setValidation(null); }}>Limpiar formulario</button></div>
      <form onSubmit={saveDraft}><div className="form-grid">{fields.map((field) => <label key={field.name}>{field.label}{field.required && <b> *</b>}<input name={field.name} type={field.type ?? "text"} value={draft[field.name]} onChange={(event) => updateDraft(field.name, event.target.value)} /></label>)}<label>Estado de control de calidad<select value={draft.qc_status} onChange={(event) => updateDraft("qc_status", event.target.value)}><option value="">Sin informar</option><option value="not_run">No realizado</option><option value="accepted">Aceptado</option><option value="rejected">Rechazado</option><option value="review_required">Requiere revisión</option></select></label></div><div className="form-actions"><button type="button" onClick={validate}>Validar fila</button><button type="submit" disabled={validation?.level === "ERROR" || !validation?.record}>Guardar fila</button></div></form>
      {validation && <div className={`validation-summary ${levelClass(validation.level)}`}><strong>{validation.level}</strong>{validation.issues.length ? validation.issues.map((item) => <span key={`${item.code}-${item.field}`}>{issueText(item)}</span>) : <span>Fila lista para guardar.</span>}</div>}
    </section>
    <section className="import-section"><div className="form-heading"><h3>Importar CSV o JSON</h3><label className="file-button">Seleccionar archivo<input type="file" accept=".csv,.json,text/csv,application/json" onChange={readFile} /></label></div>{previewRows.length > 0 && <><div className="import-counts"><span>{previewRows.filter((row) => row.validation.level === "VALID").length} válidas</span><span>{previewRows.filter((row) => row.validation.level === "WARNING").length} warnings</span><span>{previewRows.filter((row) => row.validation.level === "ERROR").length} errores</span></div><div className="import-preview">{previewRows.map((row) => <div className={`preview-row ${levelClass(row.validation.level)}`} key={row.row}><span>Fila {row.row}</span><b>{row.validation.level}</b><small>{row.validation.issues.map(issueText).join(" · ") || "Lista para guardar"}</small></div>)}</div><button type="button" onClick={saveValidImports}>Guardar filas válidas</button></>}</section>
    <section className="records-section"><div className="form-heading"><h3>Registros almacenados ({records.length})</h3><div><button type="button" onClick={() => exportRecords("csv")} disabled={!records.length}>Exportar CSV</button><button type="button" onClick={() => exportRecords("json")} disabled={!records.length}>Exportar JSON</button><button type="button" onClick={clearAll} disabled={!records.length}>Borrar datos profesionales</button></div></div><div className="table-scroll"><table><thead><tr>{["Muestra", "Paciente", "Fecha", "Analito", "Valor", "Unidad", "Muestra biológica", "Método", "Instrumento", "Control de calidad", "Marca", "Acciones"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{record.sample_id}</td><td>{record.patient_id}</td><td>{record.date}</td><td>{record.analyte}</td><td>{record.value}</td><td>{record.unit}</td><td>{record.specimen}</td><td>{record.method}</td><td>{record.instrument}</td><td>{record.qc_status || "Sin informar"}</td><td>{record.flag || "Sin marca"}</td><td className="row-actions"><button type="button" onClick={() => startEdit(record)}>Editar</button><button type="button" onClick={() => validateStored(record)}>Validar</button><button type="button" onClick={() => exportReport(record)}>Informe</button><button type="button" onClick={() => remove(record)}>Eliminar</button>{engineResults[record.id] && <small>{engineResults[record.id].profile.final_status} · {engineResults[record.id].profile.data_quality.issues.length} señales</small>}</td></tr>)}</tbody></table>{!records.length && <p className="empty-state">No hay datos profesionales almacenados.</p>}</div></section>
    {Object.entries(engineResults).map(([recordId, result]) => <section className="validation-summary" key={recordId}><strong>ANÁLISIS DEL SISTEMA · {result.profile.final_status === "INSUFFICIENT_DATA" ? "Faltan datos" : result.profile.final_status === "REVIEW_REQUIRED" ? "Requiere revisión" : "Análisis completo"}</strong><span>Evidencia: {result.profile.evidence_chain.length} elemento(s) · Base de conocimiento: {result.profile.knowledge_base_versions.knowledge_base_version}</span><span>DECISIÓN PROFESIONAL: sin registrar</span></section>)}
    {message && <p className="privacy-note" role="status">{message}</p>}
  </section>;
}
