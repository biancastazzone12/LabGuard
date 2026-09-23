import { useEffect, useState } from "react";

type Dataset = { dataset_name: string; source_name: string; source_url: string; version: string; release_date: string | null; license: string; date_accessed: string; local_file: string; status?: string };
type KnowledgeStatus = { valid: boolean; snapshot: Record<string, string>; datasets: Dataset[]; issues: Array<{ code: string; message: string; dataset_name?: string }> };

const localManifestFallback: KnowledgeStatus = {
  valid: false,
  snapshot: { loinc_version: "NOT_INSTALLED", unit_dataset_version: "0.1.0", reference_interval_version: "NOT_INSTALLED", qc_rules_version: "NOT_INSTALLED", interference_rules_version: "NOT_INSTALLED", labguard_engine_version: "0.1.0" },
  datasets: [
    { dataset_name: "LOINC", source_name: "LOINC", source_url: "https://loinc.org/downloads/", version: "NOT_INSTALLED", release_date: null, license: "LOINC license terms", date_accessed: "2026-09-23", local_file: "terminology/loinc.csv", status: "REVIEW_REQUIRED" },
    { dataset_name: "UCUM", source_name: "UCUM-compatible local registry", source_url: "https://unitsofmeasure.org/", version: "0.1.0", release_date: "2026-09-23", license: "UCUM license terms", date_accessed: "2026-09-23", local_file: "units/ucum.json", status: "DRAFT" },
    { dataset_name: "reference_intervals", source_name: "Local professional configuration", source_url: "https://github.com/labguard/labguard", version: "NOT_INSTALLED", release_date: null, license: "Project configuration", date_accessed: "2026-09-23", local_file: "reference_intervals/intervals.json", status: "REVIEW_REQUIRED" },
    { dataset_name: "qc", source_name: "Local professional configuration", source_url: "https://github.com/labguard/labguard", version: "NOT_INSTALLED", release_date: null, license: "Project configuration", date_accessed: "2026-09-23", local_file: "qc/rules.json", status: "REVIEW_REQUIRED" },
    { dataset_name: "interferences", source_name: "Local professional configuration", source_url: "https://github.com/labguard/labguard", version: "NOT_INSTALLED", release_date: null, license: "Project configuration", date_accessed: "2026-09-23", local_file: "interferences/configurations.json", status: "REVIEW_REQUIRED" },
    { dataset_name: "rules", source_name: "Local professional configuration", source_url: "https://github.com/labguard/labguard", version: "NOT_INSTALLED", release_date: null, license: "Project configuration", date_accessed: "2026-09-23", local_file: "rules/rules.json", status: "REVIEW_REQUIRED" },
  ],
  issues: [{ code: "KNOWLEDGE_REVIEW_REQUIRED", message: "La instancia local no pudo actualizar el estado; se muestra el manifiesto cacheado." }],
};

export function KnowledgeBasePanel() {
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}knowledge/manifest.json`).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      const datasets = manifest.datasets as Dataset[];
      setStatus({ valid: datasets.every((dataset) => dataset.status === "VALID"), snapshot: { knowledge_base_version: manifest.knowledge_base_version, ...Object.fromEntries(datasets.map((dataset) => [dataset.dataset_name, dataset.version])) }, datasets, issues: datasets.filter((dataset) => dataset.status !== "VALID").map((dataset) => ({ code: `${dataset.dataset_name.toUpperCase()}_DATASET_NOT_AVAILABLE`, message: `${dataset.dataset_name} no está instalado o verificado.`, dataset_name: dataset.dataset_name })) });
    }).catch((reason) => { setStatus(localManifestFallback); setError(`API local no disponible; se muestra el manifiesto local cacheado (${String(reason)}).`); });
  }, []);

  return <section className="knowledge-panel" id="knowledge-base">
    <div className="section-heading"><div><p className="section-kicker">Fuentes locales · sin consultas online</p><h2>Knowledge Base</h2></div><span className={`knowledge-status ${status?.valid ? "knowledge-valid" : "knowledge-review"}`}>{status ? (status.valid ? "VERIFIED METADATA" : "REVIEW REQUIRED") : "LOADING"}</span></div>
    <p className="privacy-note">Estas son las versiones locales que pueden quedar congeladas en una validación. Una fuente ausente, retirada o no verificada no fundamenta reglas automáticas.</p>
    {error && <p className="knowledge-error">{error}</p>}
    {status && <>
      <div className="knowledge-snapshot">{Object.entries(status.snapshot).map(([name, version]) => <div key={name}><span>{name}</span><strong>{version}</strong></div>)}</div>
      <div className="knowledge-table-scroll"><table><thead><tr><th>Dataset</th><th>Fuente</th><th>Versión</th><th>Release</th><th>Archivo local</th><th>Estado</th></tr></thead><tbody>{status.datasets.map((dataset) => <tr key={dataset.dataset_name}><td>{dataset.dataset_name}</td><td><a href={dataset.source_url} target="_blank" rel="noreferrer">{dataset.source_name}</a></td><td>{dataset.version}</td><td>{dataset.release_date ?? "No instalada"}</td><td>{dataset.local_file}</td><td>{dataset.status ?? "REVIEW_REQUIRED"}</td></tr>)}</tbody></table></div>
      {status.issues.length > 0 && <div className="knowledge-issues"><strong>Conocimiento no disponible para automatización</strong>{status.issues.map((issue, index) => <span key={`${issue.code}-${index}`}>{issue.code}: {issue.message}</span>)}</div>}
    </>}
  </section>;
}
