import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { DemoMode } from "./DemoMode";
import { DataAccountPanel } from "./DataAccountPanel";
import { AppInfoPanel } from "./AppInfoPanel";
import { ImportWorkbench } from "./ImportWorkbench";
import { SmartValidationWorkspace } from "./SmartValidationWorkspace";
import { ClinicalPatternExplorer } from "./ClinicalPatternExplorer";
import "./styles.css";

function App() {
  const [mode, setMode] = useState<"DEMO" | "PROFESSIONAL">("PROFESSIONAL");
  return (
    <div className="app-shell professional-shell">
      <aside className="sidebar">
        <div className="brand-mark"><span className="brand-dot" /><span>LABGUARD</span></div>
        <p className="sidebar-caption">Validación profesional de resultados de laboratorio</p>
        <nav aria-label="Navegación principal">
          <button type="button" className={mode === "PROFESSIONAL" ? "active" : ""} onClick={() => setMode("PROFESSIONAL")}>MODO PROFESIONAL</button>
          <button type="button" className={mode === "DEMO" ? "active" : ""} onClick={() => setMode("DEMO")}>MODO DEMO</button>
          <a href="#datos">DATOS</a>
          <a href="#importacion">IMPORTACIÓN</a>
          <a href="#registros">REGISTROS</a>
          <a href="#privacidad">PRIVACIDAD</a>
          <a href="#info">INFO</a>
          <a href="#clinical-pattern-explorer">PATRONES CLÍNICOS</a>
        </nav>
        <div className="sidebar-footer"><span className="status-led" /><span>Almacenamiento local activo</span></div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div><p className="eyebrow">Entorno profesional · datos locales</p><h1>Centro de trabajo</h1></div>
          <div className="mode-pill">Sin API key · sin cuenta externa</div>
        </header>

        <section className="professional-intro" id="datos-locales">
          <div>
            <p className="section-kicker">Flujo de trabajo protegido</p>
            <h2>Cargá resultados reales y revisalos en este navegador.</h2>
            <p>Importá archivos CSV o JSON, comprobá su estructura antes de guardarlos y mantené los datos profesionales bajo tu control. LABGUARD no envía resultados a servicios externos.</p>
          </div>
          <div className="privacy-panel" id="privacidad"><span className="status-ring">✓</span><strong>Privacidad local</strong><span>Almacenamiento local · eliminación bajo demanda</span></div>
        </section>

        <DataAccountPanel />

        <div id="importacion">{mode === "PROFESSIONAL" ? <><ImportWorkbench /><SmartValidationWorkspace /><ClinicalPatternExplorer /></> : <DemoMode />}</div>

        <section className="professional-guidance" id="registros">
          <div><span className="note-label">FLUJO DE REVISIÓN</span><strong>Importar</strong><p>Seleccioná un archivo y verificá la vista previa.</p></div>
          <div><span className="note-label">ESTADO DEL DATO</span><strong>Validar</strong><p>Los errores críticos bloquean la importación.</p></div>
          <div><span className="note-label">DECISIÓN</span><strong>Revisar</strong><p>El software apoya la revisión profesional y no libera resultados.</p></div>
        </section>

        <AppInfoPanel />

        <footer>LABGUARD · Los datos permanecen localmente en este navegador.<br />This application is a laboratory decision-support research prototype. It does not replace professional judgment, laboratory procedures, manufacturer instructions, regulatory requirements, or local validation.</footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
