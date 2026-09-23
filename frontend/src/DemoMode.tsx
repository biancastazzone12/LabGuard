const demoResults = [
  { sample_id: "DEMO-SAMPLE-001", analyte: "Synthetic analyte", value: "100", unit: "synthetic-unit", status: "DEMO ONLY" },
  { sample_id: "DEMO-SAMPLE-002", analyte: "Synthetic analyte", value: "120", unit: "synthetic-unit", status: "DEMO ONLY" },
];

export function DemoMode() {
  return <section className="local-data-panel" id="demo-mode">
    <div className="section-heading"><div><p className="section-kicker">Modo de demostración · solo datos sintéticos</p><h2>Espacio de demostración</h2></div><span className="local-badge">NO SON DATOS PROFESIONALES</span></div>
    <p className="privacy-note">Este espacio contiene únicamente ejemplos sintéticos. No se mezcla con el modo profesional, no representa pacientes y no debe utilizarse para evaluar resultados reales.</p>
    <div className="table-scroll"><table><thead><tr>{["Muestra", "Analito", "Valor", "Unidad", "Estado"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{demoResults.map((result) => <tr key={result.sample_id}><td>{result.sample_id}</td><td>{result.analyte}</td><td>{result.value}</td><td>{result.unit}</td><td>Solo demostración</td></tr>)}</tbody></table></div>
  </section>;
}
