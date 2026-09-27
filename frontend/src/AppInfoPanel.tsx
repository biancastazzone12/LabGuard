export function AppInfoPanel() {
  return <section className="app-info-panel" id="info">
    <div className="section-heading"><div><p className="section-kicker">Guía rápida</p><h2>Información de LABGUARD</h2></div><span className="local-badge">LOCAL-FIRST</span></div>
    <p className="info-lead">LABGUARD es una herramienta de apoyo para revisar resultados de laboratorio de forma ordenada, trazable y explicable. Ayuda al profesional a reunir datos, detectar información faltante y revisar señales técnicas sin reemplazar su criterio.</p>
    <div className="info-grid">
      <InfoBlock title="¿Para qué sirve?" text="Para organizar resultados profesionales, revisar la calidad de los datos, comparar resultados históricos y conservar la evidencia utilizada por el sistema." />
      <InfoBlock title="¿Qué no hace?" text="No diagnostica enfermedades, no libera resultados automáticamente, no decide por el profesional y no reemplaza procedimientos, instrucciones del fabricante ni requisitos regulatorios." />
      <InfoBlock title="Privacidad" text="Los registros profesionales se guardan en el navegador. La validación local no necesita API keys, login ni envío de datos a servicios externos." />
    </div>
    <div className="info-section"><h3>Funciones principales</h3><div className="info-function-list">
      <FunctionItem name="Modo profesional" text="Trabaja con datos ingresados manualmente o importados por el profesional." />
      <FunctionItem name="Importación CSV y JSON" text="Lee archivos locales, valida su estructura y muestra una vista previa antes de guardarlos." />
      <FunctionItem name="Smart Validation Workspace" text="Permite elegir paciente y muestra, consultar el histórico disponible y ejecutar el análisis con los datos guardados." />
      <FunctionItem name="Clinical Pattern Explorer" text="Filtra el historial por paciente y fechas, compara dos momentos con unidades idénticas, muestra tendencias por analito y agrupa resultados. Presenta observaciones, no diagnósticos ni causalidad." />
      <FunctionItem name="Delta Check" text="Compara el resultado actual con el resultado previo compatible cuando existe. Si falta información, lo informa sin inventar valores." />
      <FunctionItem name="Calidad de muestra y QC" text="Muestra índices y estados de calidad que realmente fueron introducidos. No asume límites que no estén configurados." />
      <FunctionItem name="Alertas y evidencia" text="Agrupa señales, entradas, cálculos, fuentes y versiones para que el profesional pueda revisar por qué apareció cada alerta." />
      <FunctionItem name="Revisión profesional" text="Permite registrar una decisión, comentario y revisor. El sistema nunca completa esa decisión automáticamente." />
      <FunctionItem name="Reporte y respaldo" text="Exporta un Validation Report y permite descargar una copia local de los datos profesionales." />
    </div></div>
    <div className="info-section"><h3>Cómo usarla</h3><ol className="info-steps"><li>Entrá en <strong>Modo profesional</strong>.</li><li>Usá <strong>Agregar resultado</strong> o importá un archivo CSV/JSON.</li><li>Revisá la estructura de los datos y guardá las filas sin errores de formato.</li><li>En <strong>Smart Validation Workspace</strong>, elegí el paciente y la muestra.</li><li>En <strong>Clinical Pattern Explorer</strong>, filtrá fechas y analitos, seleccioná dos momentos y revisá las diferencias calculadas.</li><li>Consultá los registros originales, unidades, cálculos y evidencia. Los intervalos o umbrales faltantes se muestran como no disponibles.</li><li>Si corresponde, registrá manualmente tu revisión profesional y exportá el informe.</li></ol></div>
    <div className="info-notice"><strong>Importante</strong><span>Los estados como información faltante, intervalo no disponible o revisión requerida son resultados honestos del sistema. LABGUARD no completa silenciosamente datos que el profesional no proporcionó.</span></div>
  </section>;
}

function InfoBlock({ title, text }: { title: string; text: string }) {
  return <article className="info-block"><h3>{title}</h3><p>{text}</p></article>;
}

function FunctionItem({ name, text }: { name: string; text: string }) {
  return <article className="info-function"><strong>{name}</strong><span>{text}</span></article>;
}
