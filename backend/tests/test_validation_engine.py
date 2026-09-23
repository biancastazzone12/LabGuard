from datetime import UTC, datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.analytical_consistency import AnalyteMeasurement, ConsistencyContext, ConsistencyRuleConfig
from app.delta_checks import DeltaComparisonContext, DeltaMeasurement, DeltaRuleConfig
from app.engine import EvaluationContext, RuleDefinition
from app.qc import ControlIdentity, QcObservation, QcRuleConfig
from app.specimen_quality import InterferenceConfig, SpecimenQualityContext
from app.validation_engine import LaboratoryConfiguration, ValidationEngine, ValidationInput
from app.main import app


client = TestClient(app)


def result(value: str = "100") -> dict:
    return {"id": "result-current-001", "analyte_code": "SYN-A", "numeric_value": Decimal(value), "value": value, "unit": "synthetic-unit"}


def sample(hemolysis: str | None = None) -> SpecimenQualityContext:
    return SpecimenQualityContext(sample_id="sample-current-001", analyte="SYN-A", sample_type="synthetic-serum", hemolysis=hemolysis, method="METHOD-1", instrument="INSTRUMENT-1", manufacturer="SYNTHETIC-MANUFACTURER", processing_time=datetime(2026, 1, 2, tzinfo=UTC))


def previous_context(current_value: str = "100", previous_value: str = "100") -> DeltaComparisonContext:
    return DeltaComparisonContext(
        current=DeltaMeasurement(patient_id="patient-1", sample_id="sample-current-001", result_id="result-current-001", analyte="SYN-A", value=Decimal(current_value), unit="synthetic-unit", timestamp=datetime(2026, 1, 2, tzinfo=UTC), method="METHOD-1", instrument="INSTRUMENT-1"),
        previous=DeltaMeasurement(patient_id="patient-1", sample_id="sample-previous-001", result_id="result-previous-001", analyte="SYN-A", value=Decimal(previous_value), unit="synthetic-unit", timestamp=datetime(2026, 1, 1, tzinfo=UTC), method="METHOD-1", instrument="INSTRUMENT-1"),
    )


def base_input(**overrides) -> ValidationInput:
    values = {
        "result": result(),
        "sample": sample(),
        "previous_results": previous_context(),
        "consistency": ConsistencyContext(sample_id="sample-current-001", measurements=[AnalyteMeasurement(analyte="SYN-A", value=Decimal("100"))]),
        "rule_context": EvaluationContext(result={"numeric_value": 100}),
        "laboratory_configuration": LaboratoryConfiguration(configuration_version="DEMO-1.0", laboratory_identifier="SYNTHETIC-ENV"),
    }
    values.update(overrides)
    return ValidationInput(**values)


def qc_rule() -> QcRuleConfig:
    return QcRuleConfig(rule_id="qc-1_3s", code="1_3s", name="DEMO QC", severity="review", suggested_action="Review QC.", window_size=1, threshold_sd=Decimal("3"))


def qc_observation(z_score: str) -> QcObservation:
    return QcObservation(control=ControlIdentity(material="DEMO", lot="DEMO-LOT", level="1", analyte="SYN-A", method="METHOD-1", instrument="INSTRUMENT-1"), run_number=1, timestamp=datetime(2026, 1, 2, tzinfo=UTC), result=Decimal("100") + Decimal(z_score) * 2, mean=Decimal("100"), standard_deviation=Decimal("2"))


def delta_rule() -> DeltaRuleConfig:
    return DeltaRuleConfig(rule_id="delta-demo", name="DEMO delta", rule_type="percentage", percentage_limit=Decimal("10"), severity="review", recommendation="Review delta.", source="DEMO")


def test_scenario_without_alerts_produces_complete_clean_profile() -> None:
    profile = ValidationEngine().evaluate(base_input())

    assert profile.review_items == []
    assert profile.system_recommendation == "No se produjo ninguna señal de revisión configurada."
    assert profile.professional_decision.status == "not_recorded"
    assert [entry.stage for entry in profile.audit_trail] == ["RESULT", "QC", "SPECIMEN_QUALITY", "INTERFERENCE", "DELTA_CHECK", "CONSISTENCY", "RULE_ENGINE", "VALIDATION_PROFILE", "PROFESSIONAL_REVIEW"]


def test_scenario_delta_check_is_in_profile_and_audit() -> None:
    profile = ValidationEngine().evaluate(base_input(previous_results=previous_context("120", "100"), delta_rules=[delta_rule()]))

    assert profile.has_delta_check is True
    assert any(item.source == "DELTA_CHECK" for item in profile.review_items)
    assert any(entry.stage == "DELTA_CHECK" for entry in profile.audit_trail)


def test_scenario_problematic_qc_is_in_profile() -> None:
    profile = ValidationEngine().evaluate(base_input(qc_observations=[qc_observation("3.2")], qc_rules=[qc_rule()]))

    assert profile.has_qc_problem is True
    assert profile.review_items[0].source == "QC"


def test_scenario_configured_interference_is_in_profile() -> None:
    interference = InterferenceConfig(interference_id="interference-demo", analyte="SYN-A", interference_type="DEMO", level="HIGH", source_type="laboratory_SOP", source_reference="DEMO_PLACEHOLDER", criterion={"field": "hemolysis", "operator": "equals", "value": "HIGH"}, version="DEMO-1.0", effective_date="2026-01-01", suggested_action="Review specimen.")
    profile = ValidationEngine().evaluate(base_input(sample=sample("HIGH"), interferences=[interference]))

    assert profile.has_preanalytical_problem is True
    assert profile.review_items[0].source == "SPECIMEN_QUALITY"


def test_scenario_multiple_alerts_preserves_each_source() -> None:
    interference = InterferenceConfig(interference_id="interference-demo", analyte="SYN-A", interference_type="DEMO", level="HIGH", source_type="laboratory_SOP", source_reference="DEMO_PLACEHOLDER", criterion={"field": "hemolysis", "operator": "equals", "value": "HIGH"}, version="DEMO-1.0", effective_date="2026-01-01", suggested_action="Review specimen.")
    consistency_rule = ConsistencyRuleConfig(rule_id="consistency-demo", name="DEMO consistency", relation="limits", involved_analytes=["SYN-A"], category="ANALYTICAL_REVIEW", severity="review", explanation="Configured consistency review.", recommendation="Review consistency.", parameters={"lower": "0", "upper": "50"}, version="DEMO-1.0", source="DEMO")
    profile = ValidationEngine().evaluate(base_input(sample=sample("HIGH"), interferences=[interference], previous_results=previous_context("120", "100"), delta_rules=[delta_rule()], qc_observations=[qc_observation("3.2")], qc_rules=[qc_rule()], consistency=ConsistencyContext(sample_id="sample-current-001", measurements=[AnalyteMeasurement(analyte="SYN-A", value=Decimal("100"))]), consistency_rules=[consistency_rule]))

    assert {item.source for item in profile.review_items} == {"QC", "SPECIMEN_QUALITY", "DELTA_CHECK", "CONSISTENCY"}
    assert len(profile.audit_trail) == 9


def test_validation_endpoint_returns_profile_and_audit_trail() -> None:
    response = client.post("/validation/evaluate", json=base_input().model_dump(mode="json"))

    assert response.status_code == 200
    payload = response.json()
    assert payload["profile_id"]
    assert payload["system_recommendation"] == "No se produjo ninguna señal de revisión configurada."
    assert [entry["stage"] for entry in payload["audit_trail"]][-2:] == ["VALIDATION_PROFILE", "PROFESSIONAL_REVIEW"]
    assert payload["professional_decision"]["status"] == "not_recorded"


def test_same_input_configuration_and_versions_produce_same_profile() -> None:
    current = result()
    current.update({"loinc_code": "2345-7", "reference_interval": {"lower": 70, "upper": 110, "unit": "synthetic-unit"}})
    first = ValidationEngine().evaluate(base_input(result=current))
    second = ValidationEngine().evaluate(base_input(result=current))

    assert first.model_dump(mode="json") == second.model_dump(mode="json")
    assert first.final_status == "VALIDATION_COMPLETE"
