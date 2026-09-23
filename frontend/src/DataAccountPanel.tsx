import { useEffect, useState } from "react";
import { getRecords, LocalRecord } from "./localData";

export function DataAccountPanel() {
  const [message, setMessage] = useState("");
  const [records, setRecords] = useState<LocalRecord[]>([]);
  useEffect(() => {
    const refresh = () => setRecords(getRecords());
    refresh();
    window.addEventListener("labguard-records-changed", refresh);
    return () => window.removeEventListener("labguard-records-changed", refresh);
  }, []);
  const exportBackup = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(records, null, 2)], { type: "application/json" }));
    link.download = "labguard-professional-data-backup.json";
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage("Respaldo descargado. Podés conservarlo y restaurarlo manualmente en otra sesión.");
  };

  return <section className="data-account-panel" id="datos">
    <div className="section-heading"><div><p className="section-kicker">Datos · almacenamiento profesional</p><h2>Datos</h2></div><span className="local-badge">DATOS LOCALES</span></div>
    <p>Tenés {records.length} {records.length === 1 ? "registro profesional" : "registros profesionales"} guardados en este navegador. Descargá un respaldo para conservar una copia y trasladarla manualmente a otro dispositivo.</p>
    <div className="account-actions"><button type="button" onClick={exportBackup} disabled={!records.length}>Descargar respaldo</button></div>
    {message && <p className="account-message" role="status">{message}</p>}
    <small>No se necesita iniciar sesión. Los datos permanecen únicamente en este dispositivo hasta que los elimines o descargues un respaldo.</small>
  </section>;
}
