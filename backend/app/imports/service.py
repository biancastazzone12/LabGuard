import csv
import io
import json
from datetime import date, datetime, time
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.imports.models import (
    ImportIssue,
    ImportPreview,
    ImportRecord,
    ImportStatus,
    LoincSearchResult,
    LoincTerm,
    ProfessionalRecord,
    UnitResolution,
)
from app.analytical_consistency.models import AnalyteMeasurement, ConsistencyContext
from app.delta_checks.models import DeltaComparisonContext, DeltaMeasurement
from app.engine.models import EvaluationContext
from app.specimen_quality.models import SpecimenQualityContext
from app.validation_engine.models import LaboratoryConfiguration, ValidationInput
from app.config.settings import settings
from app.knowledge import knowledge_snapshot

REQUIRED_FIELDS = {
    "patient_id",
    "sample_id",
    "date",
    "time",
    "analyte",
    "value",
    "unit",
    "specimen",
    "method",
    "instrument",
    "flag",
}


def _issue(code: str, message: str, field: str | None, severity: ImportStatus) -> ImportIssue:
    return ImportIssue(code=code, message=message, field=field, severity=severity)


def _validate_row(row: dict[str, Any], row_number: int, known_units: set[str] | None = None) -> ImportRecord:
    issues: list[ImportIssue] = []
    missing = sorted(field for field in REQUIRED_FIELDS - {"flag"} if not str(row.get(field, "")).strip())
    issues.extend(_issue("REQUIRED_FIELD_MISSING", f"Campo obligatorio ausente: {field}", field, ImportStatus.ERROR) for field in missing)
    if issues:
        return ImportRecord(row_number=row_number, status=ImportStatus.ERROR, issues=issues)

    try:
        date.fromisoformat(str(row.get("date", "")))
    except ValueError:
        issues.append(_issue("INVALID_DATE", "Fecha no válida", "date", ImportStatus.ERROR))
    try:
        time.fromisoformat(str(row.get("time", "")))
    except ValueError:
        issues.append(_issue("INVALID_TIME", "Hora no válida", "time", ImportStatus.ERROR))

    try:
        record = ProfessionalRecord.model_validate(row)
    except ValidationError as error:
        for detail in error.errors():
            field = str(detail["loc"][0]) if detail.get("loc") else None
            if field == "value":
                code = "INVALID_NUMERIC_VALUE"
            elif field == "date":
                code = "INVALID_DATE"
            else:
                code = "INVALID_FIELD"
            issues.append(_issue(code, "Valor no válido", field, ImportStatus.ERROR))
        return ImportRecord(row_number=row_number, status=ImportStatus.ERROR, issues=issues)

    if known_units is not None and record.unit not in known_units:
        issues.append(_issue("UNKNOWN_UNIT", f"Unidad no reconocida: {record.unit}", "unit", ImportStatus.WARNING))
    status = ImportStatus.ERROR if any(issue.severity == ImportStatus.ERROR for issue in issues) else ImportStatus.WARNING if issues else ImportStatus.VALID
    return ImportRecord(row_number=row_number, status=status, data=record if status != ImportStatus.ERROR else None, issues=issues)


def _duplicate_issues(records: list[ImportRecord]) -> None:
    seen: dict[tuple[str, str, str, str], int] = {}
    for record in records:
        if not record.data:
            continue
        key = (record.data.patient_id, record.data.sample_id, record.data.analyte, str(record.data.date))
        if key in seen:
            record.status = ImportStatus.ERROR
            record.data = None
            record.issues.append(_issue("DUPLICATE_RECORD", f"Duplicado de la fila {seen[key]}", "sample_id", ImportStatus.ERROR))
        else:
            seen[key] = record.row_number


def preview_rows(rows: list[dict[str, Any]], source_format: str, known_units: set[str] | None = None) -> ImportPreview:
    records = [_validate_row(row, index, known_units) for index, row in enumerate(rows, start=2)]
    _duplicate_issues(records)
    return ImportPreview(
        source_format=source_format,
        total_rows=len(records),
        records=records,
        can_import=bool(records) and not any(record.status == ImportStatus.ERROR for record in records),
    )


def preview_csv(content: str, known_units: set[str] | None = None) -> ImportPreview:
    normalized_content = content.lstrip("\ufeff")
    first_line = normalized_content.splitlines()[0] if normalized_content.splitlines() else ""
    delimiter = ";" if first_line.count(";") > first_line.count(",") else ","
    reader = csv.DictReader(io.StringIO(normalized_content), delimiter=delimiter)
    headers = {header.strip().lower() for header in (reader.fieldnames or [])}
    if not REQUIRED_FIELDS.issubset(headers):
        missing = sorted(REQUIRED_FIELDS - headers)
        return ImportPreview(
            source_format="csv",
            total_rows=0,
            records=[ImportRecord(row_number=1, status=ImportStatus.ERROR, issues=[_issue("INVALID_STRUCTURE", f"Columnas obligatorias ausentes: {', '.join(missing)}", None, ImportStatus.ERROR)])],
            can_import=False,
        )
    rows = []
    for row in reader:
        normalized_row = {str(key).strip().lower(): value for key, value in row.items() if key is not None}
        if delimiter == ";" and isinstance(normalized_row.get("value"), str):
            normalized_row["value"] = normalized_row["value"].replace(",", ".")
        rows.append(normalized_row)
    return preview_rows(rows, "csv", known_units)


def preview_json(content: str, known_units: set[str] | None = None) -> ImportPreview:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return ImportPreview(source_format="json", total_rows=0, records=[ImportRecord(row_number=1, status=ImportStatus.ERROR, issues=[_issue("INVALID_STRUCTURE", "JSON corrupto", None, ImportStatus.ERROR)])], can_import=False)
    rows = payload if isinstance(payload, list) else payload.get("records") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        return ImportPreview(source_format="json", total_rows=0, records=[ImportRecord(row_number=1, status=ImportStatus.ERROR, issues=[_issue("INVALID_STRUCTURE", "Se esperaba una lista de registros JSON", None, ImportStatus.ERROR)])], can_import=False)
    return preview_rows(rows, "json", known_units)


def resolve_unit(unit: str, unit_dataset: dict[str, dict[str, Any]]) -> UnitResolution:
    definition = unit_dataset.get(unit)
    if definition is None:
        return UnitResolution(original_unit=unit, issue_code="UNIT_CONVERSION_UNAVAILABLE")
    return UnitResolution(
        original_unit=unit,
        normalized_unit=definition["normalized_unit"],
        conversion_factor=definition.get("conversion_factor", 1),
        conversion_source=definition.get("conversion_source", "local-ucum-dataset"),
    )


def search_loinc(terms: list[LoincTerm], query: str) -> LoincSearchResult:
    normalized = query.casefold().strip()
    matches = [term for term in terms if normalized in " ".join((term.loinc_code, term.component, term.system, term.property, term.scale, term.method or "", term.long_common_name)).casefold()]
    if not matches:
        return LoincSearchResult(status="LOINC_MAPPING_NOT_FOUND", issue_code="LOINC_MAPPING_NOT_FOUND")
    if len(matches) > 1:
        return LoincSearchResult(status="MAPPING_REVIEW_REQUIRED", matches=matches, issue_code="MAPPING_REVIEW_REQUIRED")
    return LoincSearchResult(status="VALID", matches=matches)


def load_loinc_terms(path: Path) -> list[LoincTerm]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return [LoincTerm.model_validate(row) for row in csv.DictReader(handle)]


def to_validation_input(record: ProfessionalRecord) -> ValidationInput:
    timestamp = datetime.combine(record.date, time.fromisoformat(record.time))
    result_id = record.id or f"result-{record.sample_id}"
    previous = None
    if record.previous_value is not None and record.previous_date is not None:
        previous = DeltaMeasurement(
            patient_id=record.patient_id,
            sample_id=f"previous-{record.sample_id}",
            result_id=f"previous-{result_id}",
            analyte=record.analyte,
            value=record.previous_value,
            unit=record.unit,
            timestamp=datetime.combine(record.previous_date, time.fromisoformat(record.time)),
            method=record.method,
            instrument=record.instrument,
        )
    return ValidationInput(
        result={
            "id": result_id,
            "patient_id": record.patient_id,
            "sample_id": record.sample_id,
            "analyte_code": record.analyte,
            "numeric_value": record.value,
            "value": str(record.value),
            "unit": record.unit,
            "method_code": record.method,
            "instrument_code": record.instrument,
            "loinc_code": record.loinc_code,
            "timestamp": timestamp.isoformat(),
            "flags": {"flag": record.flag, "qc_status": record.qc_status} if record.flag or record.qc_status else {},
        },
        sample=SpecimenQualityContext(
            sample_id=record.sample_id,
            analyte=record.analyte,
            method=record.method,
            instrument=record.instrument,
            sample_type=record.specimen,
            processing_time=timestamp,
            hemolysis_index=record.hemolysis_index,
            lipemia_index=record.lipemia_index,
            icteria_index=record.icterus_index,
            instrument_flags={"flag": record.flag, "qc_status": record.qc_status} if record.flag or record.qc_status else {},
        ),
        previous_results=DeltaComparisonContext(
            current=DeltaMeasurement(
                patient_id=record.patient_id,
                sample_id=record.sample_id,
                result_id=result_id,
                analyte=record.analyte,
                value=record.value,
                unit=record.unit,
                timestamp=timestamp,
                method=record.method,
                instrument=record.instrument,
            ),
            previous=previous,
        ),
        consistency=ConsistencyContext(
            sample_id=record.sample_id,
            measurements=[AnalyteMeasurement(analyte=record.analyte, value=record.value, unit=record.unit)],
            sample_indices={"hemolysis": record.hemolysis_index, "lipemia": record.lipemia_index, "icteria": record.icterus_index},
            result_flags={"flag": record.flag, "qc_status": record.qc_status} if record.flag or record.qc_status else {},
        ),
        rule_context=EvaluationContext(
            result={"numeric_value": record.value, "value": record.value, "unit": record.unit, "analyte": record.analyte},
            sample={"specimen": record.specimen, "method": record.method, "instrument": record.instrument},
            evaluated_at=timestamp,
        ),
        laboratory_configuration=LaboratoryConfiguration(
            configuration_version="local-professional-1",
            laboratory_identifier="LOCAL_BROWSER",
            settings={"source": "professional-upload"},
            knowledge_snapshot=knowledge_snapshot(Path(__file__).parents[3] / "knowledge", settings.app_version),
        ),
    )
