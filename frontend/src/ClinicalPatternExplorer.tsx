import { useEffect, useMemo, useState } from "react";
import {
  getAnalyteGroups,
  getProfessionalReview,
  getRecords,
  LocalRecord,
  ProfessionalReview,
  saveAnalyteGroup,
  saveProfessionalReview,
} from "./localData";
import {
  buildClinicalTimeline,
  ClinicalSnapshot,
  compareClinicalSnapshots,
  createClinicalPatternReport,
  observedChangeCount,
  relatedClinicalResults,
  suggestedGroups,
} from "./clinicalPattern";
import { readableStatus } from "./presentation";

const decisions = ["Sin decisión", "Continuar revisión", "Solicitar información", "Retener para revisión"];

function numberText(value: number | null, unit = ""): string {
  if (value === null || !Number.isFinite(value)) return "No calculable";
  const formatted = value.toLocaleString("es-AR", { maximumFractionDigits: 4, signDisplay: "always" });
  return `${formatted}${unit ? ` ${unit}` : ""}`;
}

function durationText(milliseconds: number | null): string {
  if (milliseconds === null) return "No disponible";
  const days = milliseconds / 86_400_000;
  if (days >= 1) return `${days.toLocaleString("es-AR", { maximumFractionDigits: 2 })} día(s)`;
  const hours = milliseconds / 3_600_000;
  return `${hours.toLocaleString("es-AR", { maximumFractionDigits: 2 })} hora(s)`;
}

function snapshotLabel(snapshot: ClinicalSnapshot): string {
  return `${snapshot.date} ${snapshot.time} · ${snapshot.sampleId}`;
}

function downloadPatternReport(patientId: string, previous: ClinicalSnapshot | null, current: ClinicalSnapshot | null, observations: ReturnType<typeof compareClinicalSnapshots>): void {
  const report = createClinicalPatternReport(patientId, previous, current, observations);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  link.download = `labguard-comparacion-${patientId || "local"}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function ClinicalPatternExplorer() {
  const [records, setRecords] = useState<LocalRecord[]>([]);
  const [groupMap, setGroupMap] = useState<Record<string, string>>({});
  const [patientId, setPatientId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const [analytes, setAnalytes] = useState<string[]>([]);
  const [previousSnapshotId, setPreviousSnapshotId] = useState("");
  const [currentSnapshotId, setCurrentSnapshotId] = useState("");
  const [selectedResultId, setSelectedResultId] = useState("");
  const [customGroup, setCustomGroup] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("Otros");
  const [reviewer, setReviewer] = useState("");
  const [clinicalComment, setClinicalComment] = useState("");
  const [interpretation, setInterpretation] = useState("");
  const [decision, setDecision] = useState(decisions[0]);
  const [savedReview, setSavedReview] = useState<ProfessionalReview | null>(null);
  const [message, setMessage] = useState("");

  const refresh = () => { setRecords(getRecords()); setGroupMap(getAnalyteGroups()); };
  useEffect(() => {
    refresh();
    window.addEventListener("labguard-records-changed", refresh);
    return () => window.removeEventListener("labguard-records-changed", refresh);
  }, []);

  const patients = useMemo(() => [...new Set(records.map((record) => record.patient_id))].sort(), [records]);
  const patientRecords = records.filter((record) => record.patient_id === patientId);
  const availableAnalytes = [...new Set(patientRecords.map((record) => record.analyte))].sort();
  const customGroups = [...new Set(Object.values(groupMap))].filter((group) => !suggestedGroups.includes(group)).sort();
  const groups = [...suggestedGroups, ...customGroups];
  const filteredTimeline = useMemo(() => {
    const snapshots = buildClinicalTimeline(records, patientId, fromDate, toDate);
    return snapshots.map((snapshot) => ({ ...snapshot, records: snapshot.records.filter((record) => {
      const groupMatches = !groupFilter.length || groupFilter.includes(groupMap[record.analyte] ?? "Otros");
      const analyteMatches = !analytes.length || analytes.includes(record.analyte);
      return groupMatches && analyteMatches;
    }) })).filter((snapshot) => snapshot.records.length > 0);
  }, [records, patientId, fromDate, toDate, groupFilter, analytes, groupMap]);
  const previousSnapshot = filteredTimeline.find((snapshot) => snapshot.id === previousSnapshotId) ?? null;
  const currentSnapshot = filteredTimeline.find((snapshot) => snapshot.id === currentSnapshotId) ?? null;
  const comparisonAnalytes = analytes.length ? analytes : availableAnalytes;
  const observations = useMemo(() => compareClinicalSnapshots(previousSnapshot, currentSnapshot, comparisonAnalytes), [previousSnapshot, currentSnapshot, comparisonAnalytes]);
  const changedCount = observedChangeCount(observations);
  const selectedResult = filteredTimeline.flatMap((snapshot) => snapshot.records).find((record) => record.id === selectedResultId) ?? null;
  const temporalRelations = selectedResult ? relatedClinicalResults(patientRecords, selectedResult) : [];
  const reviewKey = `pattern:${patientId}:${previousSnapshotId}:${currentSnapshotId}`;

  useEffect(() => {
    if (!patients.length) { setPatientId(""); return; }
    if (!patients.includes(patientId)) setPatientId(patients[0]);
  }, [patients, patientId]);

  useEffect(() => { setAnalytes(availableAnalytes); }, [patientId, records]);

  useEffect(() => {
    if (!filteredTimeline.some((snapshot) => snapshot.id === currentSnapshotId)) {
      const latest = filteredTimeline.at(-1);
      setCurrentSnapshotId(latest?.id ?? "");
    }
    if (!filteredTimeline.some((snapshot) => snapshot.id === previousSnapshotId)) {
      const earlier = filteredTimeline.length > 1 ? filteredTimeline[filteredTimeline.length - 2] : null;
      setPreviousSnapshotId(earlier?.id ?? "");
    }
  }, [filteredTimeline, currentSnapshotId, previousSnapshotId]);

  useEffect(() => {
    const review = getProfessionalReview(reviewKey);
    setSavedReview(review);
    setReviewer(review?.reviewer ?? "");
    setClinicalComment(review?.clinicalComment ?? "");
    setInterpretation(review?.professionalInterpretation ?? "");
    setDecision(review?.decision ?? decisions[0]);
  }, [reviewKey]);

  const toggleGroup = (group: string) => setGroupFilter((current) => {
    const active = current.length ? current : groups;
    const next = active.includes(group) ? active.filter((item) => item !== group) : [...active, group];
    return next.length === groups.length ? [] : next;
  });
  const toggleAnalyte = (analyte: string) => setAnalytes((current) => current.includes(analyte) ? current.filter((item) => item !== analyte) : [...current, analyte]);
  const saveGroup = () => {
    const target = selectedResult?.analyte ?? availableAnalytes[0];
    const value = customGroup.trim() || selectedGroup;
    if (!target || !value) return;
    saveAnalyteGroup(target, value);
    setGroupMap(getAnalyteGroups());
    setCustomGroup("");
    setMessage(`Se guardó el grupo «${value}» para ${target}.`);
  };
  const saveReview = () => {
    const review: ProfessionalReview = { reviewer, clinicalComment, professionalInterpretation: interpretation, decision, timestamp: new Date().toISOString() };
    saveProfessionalReview(reviewKey, review);
    setSavedReview(review);
    setMessage("La revisión profesional se guardó en este navegador.");
  };

  return <section className="smart-workspace clinical-pattern" id="clinical-pattern-explorer">
    <div className="section-heading"><div><p className="section-kicker">Exploración longitudinal · datos profesionales locales</p><h2>CLINICAL PATTERN EXPLORER</h2></div><span className="local-badge">OBSERVACIÓN, NO DIAGNÓSTICO</span></div>
    <p className="privacy-note">Organiza, compara y visualiza únicamente resultados ya guardados. No estima enfermedades, causalidad ni probabilidades. La interpretación pertenece al profesional.</p>
    <button type="button" onClick={() => downloadPatternReport(patientId, previousSnapshot, currentSnapshot, observations)} disabled={!patientId}>Descargar informe de comparación</button>
    {!records.length ? <div className="workspace-empty"><strong>No hay datos profesionales disponibles.</strong><span>Importá un archivo o agregá resultados en el modo profesional.</span></div> : <>
      <div className="clinical-filters">
        <label>Paciente<select value={patientId} onChange={(event) => setPatientId(event.target.value)}>{patients.map((patient) => <option key={patient} value={patient}>{patient}</option>)}</select></label>
        <label>Desde<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label>Hasta<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
      </div>
      <fieldset className="clinical-filterset"><legend>Grupos de laboratorio · configuración local</legend>{groups.map((group) => <label key={group}><input type="checkbox" checked={!groupFilter.length || groupFilter.includes(group)} onChange={() => toggleGroup(group)} />{group}</label>)}</fieldset>
      <fieldset className="clinical-filterset"><legend>Analitos</legend>{availableAnalytes.map((analyte) => <label key={analyte}><input type="checkbox" checked={analytes.includes(analyte)} onChange={() => toggleAnalyte(analyte)} />{analyte}</label>)}</fieldset>
      <section className="workspace-panel"><h3>LÍNEA DE TIEMPO</h3>{filteredTimeline.length ? filteredTimeline.map((snapshot) => <article className="clinical-snapshot" key={snapshot.id}><h4>{snapshot.date} · {snapshot.time} · Muestra {snapshot.sampleId}</h4><div>{snapshot.records.map((record) => <button className={selectedResultId === record.id ? "clinical-result selected" : "clinical-result"} key={record.id} type="button" title="Seleccionar resultado para ver sus datos" onClick={() => setSelectedResultId(record.id)}><strong>{record.analyte}</strong><span>{record.value} {record.unit}</span><small>{record.flag || "Sin marca informada"}</small></button>)}</div></article>) : <p>No hay resultados para los filtros seleccionados.</p>}</section>
      {selectedResult && <section className="workspace-panel"><h3>DETALLE DEL RESULTADO SELECCIONADO</h3><div className="clinical-detail-grid">{[
        ["Fecha y hora", `${selectedResult.date} ${selectedResult.time}`], ["Analito", selectedResult.analyte], ["Valor", `${selectedResult.value} ${selectedResult.unit}`], ["Espécimen", selectedResult.specimen || "No informado"], ["Método", selectedResult.method || "No informado"], ["Instrumento", selectedResult.instrument || "No informado"], ["LOINC", selectedResult.loinc_code || "No informado"], ["Marca", selectedResult.flag || "Sin marca informada"], ["Validación", "No reevaluado en esta vista"], ["Origen", "Registro profesional local; detalle de importación no almacenado"], ["Intervalo de referencia", "No disponible en la base de conocimiento local"],
      ].map(([label, value]) => <div key={label}><b>{label}</b><span>{value}</span></div>)}</div></section>}
      <section className="workspace-panel"><h3>COMPARACIÓN TEMPORAL · ¿QUÉ CAMBIÓ?</h3><div className="clinical-compare-selectors"><label>Momento anterior<select value={previousSnapshotId} onChange={(event) => setPreviousSnapshotId(event.target.value)}><option value="">Seleccionar momento</option>{filteredTimeline.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshotLabel(snapshot)}</option>)}</select></label><label>Momento actual<select value={currentSnapshotId} onChange={(event) => setCurrentSnapshotId(event.target.value)}><option value="">Seleccionar momento</option>{filteredTimeline.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshotLabel(snapshot)}</option>)}</select></label></div>
        {previousSnapshot && currentSnapshot ? <><p className="clinical-neutral-note">Comparación de datos, no interpretación clínica. No se aplican conversiones de unidades ni umbrales no configurados.</p>{observations.map((item) => <details className="clinical-change" key={item.analyte}><summary>{item.analyte} · {item.comparison.status === "COMPARISON_PERFORMED" ? item.comparison.absoluteChange === 0 ? "Sin cambio numérico" : "Cambio detectado" : readableStatus(item.comparison.status)}</summary><div className="clinical-detail-grid"><div><b>Valor previo</b><span>{item.previous ? `${item.previous.value} ${item.previous.unit}` : "No disponible"}</span></div><div><b>Valor actual</b><span>{item.current ? `${item.current.value} ${item.current.unit}` : "No disponible"}</span></div><div><b>Cambio absoluto</b><span>{numberText(item.comparison.absoluteChange, item.comparison.unit ?? "")}</span></div><div><b>Cambio relativo</b><span>{item.comparison.percentageChange === null ? "No calculable (valor previo cero o comparación no disponible)" : `${numberText(item.comparison.percentageChange, "%")}`}</span></div><div><b>Tiempo transcurrido</b><span>{durationText(item.comparison.elapsedMilliseconds)}</span></div><div><b>Compatibilidad</b><span>{item.comparison.status === "COMPARISON_PERFORMED" ? "Mismo analito y unidad exacta" : item.comparison.reason}</span></div></div><p>Fórmula: {item.comparison.status === "COMPARISON_PERFORMED" ? "valor actual - valor previo" : "No se realizó cálculo"}</p><small>Resultados usados: {item.previous?.sample_id ?? "sin resultado previo"} → {item.current?.sample_id ?? "sin resultado actual"}. Intervalo de referencia: no disponible.</small></details>)}</> : <p>Seleccioná dos momentos para comparar. Con un solo momento, no se calcula ningún cambio.</p>}</section>
      <section className="workspace-panel"><h3>VISTA MULTIANALITO</h3><p className="clinical-neutral-note">Cada analito tiene su propia escala; valores con unidades distintas no comparten eje.</p><div className="clinical-charts">{comparisonAnalytes.map((analyte) => { const history = patientRecords.filter((record) => record.analyte === analyte && (!fromDate || record.date >= fromDate) && (!toDate || record.date <= toDate) && (!groupFilter.length || groupFilter.includes(groupMap[record.analyte] ?? "Otros"))).sort((left, right) => `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`)); return <article className="clinical-chart" key={analyte}><h4>{analyte} · {history[0]?.unit ?? "unidad no informada"}</h4>{history.length > 1 ? <Sparkline records={history} /> : <p>No hay suficientes resultados históricos.</p>}<div>{history.map((record) => <span key={record.id}>{record.date}: {record.value} {record.unit}</span>)}</div></article>; })}</div></section>
      <section className="workspace-panel">
        <h3>RESUMEN DE RESULTADOS DISPONIBLES</h3>
        {groups.map((group) => {
          const analyteNames = availableAnalytes.filter((analyte) => (groupMap[analyte] ?? "Otros") === group);
          const groupRecords = patientRecords.filter((record) => analyteNames.includes(record.analyte) && (!fromDate || record.date >= fromDate) && (!toDate || record.date <= toDate));
          const changed = observations.filter((item) => analyteNames.includes(item.analyte) && item.comparison.status === "COMPARISON_PERFORMED" && item.comparison.absoluteChange !== 0).length;
          return groupRecords.length ? <div className="completeness-row" key={group}><span>{group}</span><strong>{groupRecords.length} resultado(s) · {previousSnapshot && currentSnapshot ? `${changed} cambio(s) detectado(s)` : "sin comparación temporal"}</strong></div> : null;
        })}
        <div className="group-config">
          <label>Grupo del resultado seleccionado<select value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)}>{groups.map((group) => <option key={group}>{group}</option>)}</select></label>
          <button type="button" onClick={saveGroup} disabled={!availableAnalytes.length}>Asignar a {selectedResult?.analyte ?? availableAnalytes[0] ?? "analito"}</button>
          <label>Crear grupo propio<input value={customGroup} onChange={(event) => setCustomGroup(event.target.value)} placeholder="Nombre del grupo" /></label>
          <button type="button" onClick={saveGroup} disabled={!customGroup.trim() || !availableAnalytes.length}>Crear y asignar grupo</button>
        </div>
        <div className="pattern-cards">
          <article><strong>{!previousSnapshot || !currentSnapshot ? "Datos insuficientes para comparar" : changedCount > 1 ? "Se detectaron varios cambios" : changedCount === 1 ? "Se detectó un cambio" : "Sin cambios numéricos en los resultados comparables"}</strong><span>{!previousSnapshot || !currentSnapshot ? "Seleccioná dos momentos para evaluar diferencias." : `${changedCount} analito(s) con cambio numérico entre los momentos seleccionados. No se aplicó un umbral de significación.`}</span></article>
          <article><strong>{filteredTimeline.length > 1 ? "Hay historial longitudinal disponible" : "Historial longitudinal insuficiente"}</strong><span>{filteredTimeline.length} momento(s) disponible(s) según los filtros actuales.</span></article>
          <article><strong>Marcas informadas</strong><span>{patientRecords.filter((record) => Boolean(record.flag)).length} resultado(s) contienen una marca original; no se reinterpretó.</span></article>
        </div>
      </section>
      {selectedResult && <section className="workspace-panel"><h3>EXPLORAR RESULTADOS DEL MISMO MOMENTO</h3><p className="clinical-neutral-note">Relación temporal / conjunto de datos. No expresa causalidad.</p>{temporalRelations.length ? temporalRelations.map((record) => <div className="completeness-row" key={record.id}><span>{record.analyte} · {record.date} {record.time}</span><strong>{record.value} {record.unit} · {record.sample_id}</strong></div>) : <p>No hay otros resultados en esta misma muestra.</p>}</section>}
      <details className="workspace-panel"><summary>EVIDENCIA DE COMPARACIÓN</summary>{observations.length ? observations.map((item) => <div className="evidence-row" key={item.analyte}><strong>OBSERVACIÓN: {item.comparison.status === "COMPARISON_PERFORMED" ? "CAMBIO NUMÉRICO" : item.comparison.status === "COMPARISON_UNAVAILABLE" ? "COMPARACIÓN NO APLICABLE" : "INFORMACIÓN INSUFICIENTE"}</strong><span>Analito: {item.analyte}. Estado: {readableStatus(item.comparison.status)}. Motivo: {item.comparison.reason}</span><div className="evidence-fields">{Object.entries(item.comparison.evidence).map(([key, value]) => <span key={key}><b>{key.replaceAll("_", " ")}</b>{String(value)}</span>)}<span><b>Versión de conocimiento</b>Sin intervalo/regla aplicado en esta comparación</span></div></div>) : <p>No hay evidencia disponible para los filtros actuales.</p>}</details>
      <section className="workspace-panel professional-review"><h3>REVISIÓN PROFESIONAL</h3><p>OBSERVACIÓN DEL SISTEMA e INTERPRETACIÓN PROFESIONAL se mantienen separadas. La interpretación no se completa automáticamente.</p><div className="review-fields"><label>Revisor<input value={reviewer} onChange={(event) => setReviewer(event.target.value)} /></label><label>Decisión<select value={decision} onChange={(event) => setDecision(event.target.value)}>{decisions.map((option) => <option key={option}>{option}</option>)}</select></label><label>Comentario clínico<textarea value={clinicalComment} onChange={(event) => setClinicalComment(event.target.value)} /></label><label>Interpretación profesional<textarea value={interpretation} onChange={(event) => setInterpretation(event.target.value)} /></label></div><button type="button" onClick={saveReview} disabled={!patientId}>Guardar revisión manual</button>{savedReview && <small>Última revisión guardada: {new Date(savedReview.timestamp).toLocaleString("es-AR")}</small>}</section>
    </>}
    {message && <p className="account-message" role="status">{message}</p>}
  </section>;
}

function Sparkline({ records }: { records: LocalRecord[] }) {
  const points = records.map((record) => record.value);
  const minimum = Math.min(...points);
  const range = Math.max(...points) - minimum || 1;
  const positions = records.map((record, index) => `${20 + index * 360 / (records.length - 1)},${100 - (record.value - minimum) / range * 75}`).join(" ");
  return <svg className="clinical-sparkline" viewBox="0 0 400 120" role="img" aria-label={`Valores originales de ${records[0].analyte} en el tiempo`}><line x1="20" y1="100" x2="380" y2="100" /><polyline points={positions} />{records.map((record, index) => <circle key={record.id} cx={20 + index * 360 / (records.length - 1)} cy={100 - (record.value - minimum) / range * 75} r="4"><title>{record.date} {record.time}: {record.value} {record.unit}</title></circle>)}</svg>;
}
