const labels: Record<string, string> = {
  LOINC_MAPPING_REQUIRED: "Falta asociar el código LOINC",
  REFERENCE_INTERVAL_UNAVAILABLE: "Intervalo de referencia no disponible",
  DELTA_CHECK_NOT_AVAILABLE: "No hay resultado previo para comparar",
  DELTA_CHECK_PERFORMED: "Comparación histórica realizada",
  DELTA_CHECK_INCOMPATIBLE_UNITS: "No se puede comparar: las unidades no coinciden",
  QC_DATA_NOT_AVAILABLE: "No hay información de control de calidad",
  THRESHOLD_NOT_CONFIGURED: "No hay un límite configurado",
  INSUFFICIENT_DATA: "Faltan datos necesarios",
  REVIEW_REQUIRED: "Requiere revisión profesional",
  VALIDATION_COMPLETE: "Análisis completado",
  DATA_ERROR: "Hay un error en los datos",
  CONFIGURATION_REQUIRED: "Falta configurar este análisis",
  AVAILABLE_FOR_REVIEW: "Disponible para revisión",
  NOT_PROVIDED: "No informado",
  NOT_CONFIGURED: "Sin configuración",
  NO_CONFIGURED_RULE: "No hay una regla configurada",
  NO_EVIDENCE: "Sin evidencia disponible",
  NO_ALERTS: "Sin alertas",
  NOT_INSTALLED: "No instalado",
  AVAILABLE: "Disponible",
  MISSING: "Falta información",
  OPTIONAL: "Opcional",
};

export function readableStatus(value: string): string {
  return labels[value] ?? value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

export function readableIssue(value: string): string {
  return labels[value] ?? readableStatus(value);
}

export function readableReason(value: string): string {
  try {
    const details = JSON.parse(value) as Record<string, unknown>;
    if (typeof details.percentage_change === "number") {
      const percentage = details.percentage_change.toFixed(1).replace(".", ",");
      return `Anterior: ${details.previous_value} (${details.previous_date}). Actual: ${details.current_value} (${details.current_date}). Cambio: ${percentage}%.`;
    }
  } catch {
    // La razón puede ser texto normal.
  }
  return value.split(", ").map(readableIssue).join("; ");
}

export function readableField(value: string): string {
  const fields: Record<string, string> = {
    analyte: "Analito",
    specimen: "Tipo de muestra",
    method: "Método",
    unit: "Unidad",
    sample_id: "Muestra",
    previous_value: "Valor anterior",
    previous_date: "Fecha anterior",
    current_value: "Valor actual",
    current_date: "Fecha actual",
    absolute_change: "Cambio absoluto",
    percentage_change: "Cambio porcentual",
  };
  return fields[value] ?? readableStatus(value);
}

export function readableValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "No informado";
  if (typeof value === "number") return String(value).replace(".", ",");
  return String(value);
}
