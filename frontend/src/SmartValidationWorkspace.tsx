import { useEffect, useMemo, useState } from "react";
import { getRecords, LocalRecord } from "./localData";
import { buildWorkspaceContext, WorkspaceContext } from "./localValidation";
import { readableField, readableIssue, readableReason, readableStatus, readableValue } from "./presentation";

function downloadReport(context: WorkspaceContext, decision: string, comment: string, reviewedBy: string): void {
  const profile = context.profile;
  if (!profile) return;
  const report = { report_type: "Validation Report", system_analysis: profile, professional_decision: { decision, comment, reviewed_by: reviewedBy, reviewed_timestamp: decision ? new Date().toISOString() : null } };
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  link.download = `labguard-validation-${context.sampleId}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function SmartValidationWorkspace() {
  const [records, setRecords] = useState<LocalRecord[]>([]);
  const [patientId, setPatientId] = useState("");
  const [sampleId, setSampleId] = useState("");
  const [decision, setDecision] = useState("");
  const [comment, setComment] = useState("");
  const [reviewedBy, setReviewedBy] = useState("");
  const refresh = () => setRecords(getRecords());
  useEffect(() => { refresh(); window.addEventListener("labguard-records-changed", refresh); return () => window.removeEventListener("labguard-records-changed", refresh); }, []);
  const patientOptions = useMemo(() => [...new Set(records.map((record) => record.patient_id))].sort(), [records]);
  const patientRecords = records.filter((record) => record.patient_id === patientId);
  const context = useMemo(() => buildWorkspaceContext(records, patientId, sampleId), [records, patientId, sampleId]);
  const profile = context.profile;

  useEffect(() => { if (patientId && !patientRecords.some((record) => record.sample_id === sampleId)) setSampleId(patientRecords[0]?.sample_id ?? ""); }, [patientId, patientRecords, sampleId]);

  return <section className="smart-workspace" id="smart-validation-workspace">
    <div className="section-heading"><div><p className="section-kicker">Modo profesional · solo datos almacenados</p><h2>ESPACIO DE VALIDACIÓN INTELIGENTE</h2></div><button type="button" className="local-badge" onClick={() => { const first = records[0]; if (first) { setPatientId(first.patient_id); setSampleId(first.sample_id); } }}>PROBAR CON MIS DATOS</button></div>
    <p className="privacy-note">Seleccioná datos ya almacenados por el profesional. Este espacio no crea pacientes, muestras, resultados ni valores faltantes.</p>
    {!records.length ? <div className="workspace-empty"><strong>NO HAY DATOS PROFESIONALES</strong><span>Importá un CSV o JSON, o agregá un resultado manualmente.</span></div> : <>
      <div className="workspace-selectors"><label>Patient ID<select value={patientId} onChange={(event) => { setPatientId(event.target.value); setSampleId(""); }}><option value="">Seleccionar paciente</option>{patientOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label>Sample ID<select value={sampleId} onChange={(event) => setSampleId(event.target.value)} disabled={!patientId}><option value="">Seleccionar muestra</option>{patientRecords.map((record) => <option key={record.id} value={record.sample_id}>{record.sample_id}</option>)}</select></label></div>
      {patientId && <div className="workspace-timeline"><strong>CONTEXTO DEL PACIENTE · {patientId}</strong>{patientRecords.map((record) => <div className={record.sample_id === sampleId ? "timeline-row selected" : "timeline-row"} key={record.id}><span>{record.date}</span><span>{record.sample_id}</span><span>{record.analyte}</span><span>{record.value} {record.unit}</span><span>{record.flag || "Sin alerta"}</span></div>)}{patientRecords.length < 2 && <small>HISTÓRICO: NO DISPONIBLE</small>}</div>}
      {profile && <>
        <section className="workspace-panel"><h3>TENDENCIA HISTÓRICA · {profile.analyte}</h3>{context.historicalRecords.length ? <TrendChart records={[...context.historicalRecords, context.current!].sort(sameRecordDate)} /> : <p>No hay suficientes resultados para mostrar una tendencia histórica.</p>}</section>
        <section className="workspace-panel"><h3>RESULTADOS DE LA MUESTRA · {profile.sample_id}</h3>{recordsForSample(records, profile.sample_id).map((record) => <div className="completeness-row" key={record.id}><span>{record.analyte} · {record.loinc_code || "Código LOINC no disponible"}</span><strong>{record.value} {record.unit} · {record.qc_status ? readableStatus(record.qc_status) : "Sin información de control de calidad"}</strong></div>)}</section>
        <div className="workspace-overview"><OverviewCard title="CALIDAD DE LOS DATOS" value={readableStatus(profile.final_status)} reason={profile.data_quality.issues.map(readableIssue).join(", ") || "La información necesaria está disponible"} /><OverviewCard title="CALIDAD DE LA MUESTRA" value={readableStatus(profile.specimen_quality.status)} reason={profile.specimen_quality.evidence} /><OverviewCard title="CONTROL DE CALIDAD" value={profile.qc_status ? readableStatus(profile.qc_status) : "Sin información"} reason={profile.qc_status === "NOT_CONFIGURED" ? "No hay información de control de calidad" : "Estado informado junto con el resultado"} /><OverviewCard title="COMPARACIÓN HISTÓRICA" value={readableStatus(profile.delta_check.status)} reason={readableReason(profile.delta_check.reason)} /><OverviewCard title="POSIBLES INTERFERENCIAS" value={readableStatus(profile.interference_assessment.status)} reason={profile.interference_assessment.evidence} /><OverviewCard title="CONSISTENCIA ANALÍTICA" value={readableStatus(profile.consistency_assessment.status)} reason={profile.consistency_assessment.evidence} /><OverviewCard title="REGLAS" value={profile.triggered_rules.length ? "Requiere revisión profesional" : "Sin alertas de reglas"} reason={profile.triggered_rules.map(readableIssue).join(", ") || "No hay una regla configurada que genere una alerta"} /></div>
        <div className="workspace-columns"><section className="workspace-panel"><h3>COMPROBACIÓN DE INFORMACIÓN</h3>{context.completeness.map((item) => <div className="completeness-row" key={item.field}><span>{item.field}</span><strong>{readableStatus(item.status)}</strong></div>)}</section><section className="workspace-panel"><h3>CENTRO DE ALERTAS</h3>{context.alerts.length ? context.alerts.map((alert) => <details className="workspace-alert" key={alert.id}><summary>{readableIssue(alert.title)} · {readableStatus(alert.status)}</summary><p>Motivo: {readableReason(alert.reason)}</p><p>Evidencia conservada: {alert.evidence.length} elemento(s)</p></details>) : <p>No hay alertas con la información disponible.</p>}</section></div>
        <details className="workspace-panel evidence-panel"><summary>VER EVIDENCIA · {profile.evidence_chain.length} elemento(s)</summary>{profile.evidence_chain.map((item) => <div className="evidence-row" key={`${item.dataset_id}-${item.result}`}><strong>DATOS → CONOCIMIENTO → REGLA → CÁLCULO → RESULTADO</strong><span>Fuente: {item.source} · Versión: {item.dataset_version} · Resultado: {readableIssue(item.result)}</span><div className="evidence-fields">{Object.entries(item.input).map(([field, value]) => <span key={field}><b>{readableField(field)}</b>{readableValue(value)}</span>)}</div></div>)}</details>
        <section className="workspace-panel professional-review"><h3>REVISIÓN PROFESIONAL</h3><p>ANÁLISIS DEL SISTEMA: {readableStatus(profile.final_status)}. El software no elige la decisión profesional.</p><div className="review-fields"><label>Decisión<select value={decision} onChange={(event) => setDecision(event.target.value)}><option value="">Sin registrar</option><option value="accepted_for_review">Aceptar para revisión</option><option value="hold_for_review">Mantener en revisión</option><option value="requires_additional_information">Solicitar información adicional</option></select></label><label>Revisado por<input value={reviewedBy} onChange={(event) => setReviewedBy(event.target.value)} /></label><label>Comentario<textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label></div><div className="form-actions"><button type="button" onClick={() => downloadReport(context, decision, comment, reviewedBy)}>Exportar informe de validación</button></div></section>
      </>}
    </>}
  </section>;
}

function OverviewCard({ title, value, reason }: { title: string; value: string; reason: string }) {
  return <article className="overview-card"><span>{title}</span><strong>{value}</strong><small>{reason}</small></article>;
}

function sameRecordDate(left: LocalRecord, right: LocalRecord): number {
  return `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`);
}

function recordsForSample(records: LocalRecord[], sampleId: string): LocalRecord[] {
  return records.filter((record) => record.sample_id === sampleId);
}

function TrendChart({ records }: { records: LocalRecord[] }) {
  if (records.length < 2) return <p>No hay suficientes resultados para mostrar una tendencia histórica.</p>;
  const values = records.map((record) => record.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const points = records.map((record, index) => `${index * (360 / (records.length - 1)) + 20},${110 - ((record.value - minimum) / range) * 80}`).join(" ");
  return <div className="trend-chart"><svg viewBox="0 0 400 140" role="img" aria-label={`Historical trend for ${records[0].analyte}`}><line x1="20" y1="110" x2="380" y2="110" className="chart-grid-line" /><polyline points={points} className="trend-line" />{records.map((record, index) => <circle key={record.id} cx={index * (360 / (records.length - 1)) + 20} cy={110 - ((record.value - minimum) / range) * 80} r="4" className="trend-point" />)}</svg><div className="trend-labels">{records.map((record) => <span key={record.id}>{record.date}: {record.value} {record.unit}</span>)}</div></div>;
}
