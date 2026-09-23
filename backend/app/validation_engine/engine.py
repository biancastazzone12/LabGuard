import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from app.analytical_consistency import AnalyticalConsistencyEvaluator
from app.delta_checks import DeltaCheckEvaluator
from app.engine import RuleEvaluator, RuleRegistry
from app.qc import QcRuleEvaluator
from app.specimen_quality import SpecimenQualityEvaluator
from app.validation_engine.models import (
    AuditTrailEntry,
    ReviewItem,
    EvidenceChainEntry,
    ValidationInput,
    ValidationProfile,
)


class ValidationEngine:
    """Orchestrates evidence-producing modules without making professional decisions."""

    def evaluate(self, validation_input: ValidationInput) -> ValidationProfile:
        created_at = self._evaluation_timestamp(validation_input)
        audit_trail: list[AuditTrailEntry] = []

        self._audit(audit_trail, "RESULT", validation_input.result, validation_input.laboratory_configuration, validation_input.result)

        qc_decisions = QcRuleEvaluator().evaluate(validation_input.qc_observations, validation_input.qc_rules)
        self._audit(audit_trail, "QC", {"observations": len(validation_input.qc_observations)}, validation_input.laboratory_configuration, {"decisions": len(qc_decisions), "triggered": sum(item.triggered for item in qc_decisions)})

        specimen_events = SpecimenQualityEvaluator().evaluate(validation_input.sample, validation_input.interferences)
        self._audit(audit_trail, "SPECIMEN_QUALITY", validation_input.sample.model_dump(), validation_input.laboratory_configuration, {"events": len(specimen_events)})
        self._audit(audit_trail, "INTERFERENCE", {"configurations": len(validation_input.interferences)}, validation_input.laboratory_configuration, {"review_required": sum(event.status == "REVIEW_REQUIRED" for event in specimen_events)})

        delta_events = DeltaCheckEvaluator().evaluate(validation_input.previous_results, validation_input.delta_rules)
        self._audit(audit_trail, "DELTA_CHECK", {"rules": len(validation_input.delta_rules)}, validation_input.laboratory_configuration, {"events": len(delta_events), "activated": sum(event.rule_activated is not None for event in delta_events)})

        consistency_events = AnalyticalConsistencyEvaluator().evaluate(validation_input.consistency, validation_input.consistency_rules)
        self._audit(audit_trail, "CONSISTENCY", {"rules": len(validation_input.consistency_rules)}, validation_input.laboratory_configuration, {"events": len(consistency_events), "triggered": sum(event.triggered for event in consistency_events)})

        rule_results = RuleEvaluator().evaluate(validation_input.rule_context, RuleRegistry(validation_input.rules))
        self._audit(audit_trail, "RULE_ENGINE", {"rules": len(validation_input.rules)}, validation_input.laboratory_configuration, {"results": len(rule_results), "triggered": sum(item.triggered for item in rule_results)})

        review_items = self._review_items(qc_decisions, specimen_events, delta_events, consistency_events, rule_results)
        recommendation = "Se recomienda revisión profesional." if review_items else "No se produjo ninguna señal de revisión configurada."
        data_quality = self._data_quality(validation_input)
        evidence_chain = self._evidence_chain(review_items, validation_input, created_at, data_quality["issues"])
        final_status = self._final_status(validation_input, review_items)
        self._audit(audit_trail, "VALIDATION_PROFILE", {"result_id": validation_input.result.get("id")}, validation_input.laboratory_configuration, {"review_items": len(review_items), "recommendation": recommendation})
        self._audit(audit_trail, "PROFESSIONAL_REVIEW", {"decision": "not_recorded"}, validation_input.laboratory_configuration, {"decision": "not_recorded"})

        return ValidationProfile(
            profile_id=self._profile_id(validation_input),
            created_at=created_at,
            result_id=str(validation_input.result.get("id", "unknown-result")),
            evaluated=[entry.stage for entry in audit_trail],
            result=validation_input.result,
            qc_decisions=qc_decisions,
            specimen_events=specimen_events,
            delta_events=delta_events,
            consistency_events=consistency_events,
            rule_results=rule_results,
            audit_trail=audit_trail,
            review_items=review_items,
            system_recommendation=recommendation,
            professional_decision={"status": "not_recorded"},
            knowledge_snapshot=validation_input.laboratory_configuration.knowledge_snapshot,
            sample_id=validation_input.sample.sample_id,
            timestamp=self._result_timestamp(validation_input),
            analyte=validation_input.result.get("analyte_code") or validation_input.result.get("analyte"),
            loinc_code=validation_input.result.get("loinc_code"),
            value=validation_input.result.get("numeric_value", validation_input.result.get("value")),
            unit=validation_input.result.get("unit"),
            method=validation_input.result.get("method_code") or validation_input.result.get("method"),
            instrument=validation_input.result.get("instrument_code") or validation_input.result.get("instrument"),
            data_quality=data_quality,
            specimen_quality=specimen_events,
            qc_status=self._qc_status(validation_input, qc_decisions),
            reference_interval=validation_input.result.get("reference_interval"),
            delta_check=delta_events,
            interference_assessment=specimen_events,
            consistency_assessment=consistency_events,
            triggered_rules=[item.rule_id for item in review_items if item.rule_id],
            evidence_chain=evidence_chain,
            final_status=final_status,
        )

    @staticmethod
    def _result_timestamp(validation_input: ValidationInput) -> datetime:
        value = validation_input.result.get("timestamp")
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                pass
        return validation_input.sample.processing_time or datetime(1970, 1, 1, tzinfo=UTC)

    @classmethod
    def _evaluation_timestamp(cls, validation_input: ValidationInput) -> datetime:
        timestamp = cls._result_timestamp(validation_input)
        return timestamp if timestamp.tzinfo else timestamp.replace(tzinfo=UTC)

    @staticmethod
    def _profile_id(validation_input: ValidationInput) -> str:
        canonical = validation_input.model_dump(mode="json")
        payload = json.dumps(canonical, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    @staticmethod
    def _qc_status(validation_input: ValidationInput, decisions) -> str:
        if not validation_input.qc_observations:
            return "NOT_EVALUATED"
        return "REVIEW_REQUIRED" if any(item.triggered for item in decisions) else "ACCEPTED"

    @staticmethod
    def _data_quality(validation_input: ValidationInput) -> dict[str, Any]:
        result = validation_input.result
        issues = list(result.get("data_quality", {}).get("issues", []))
        if not result.get("loinc_code") and "LOINC_MAPPING_REQUIRED" not in issues:
            issues.append("LOINC_MAPPING_REQUIRED")
        if not result.get("reference_interval") and "REFERENCE_INTERVAL_UNAVAILABLE" not in issues:
            issues.append("REFERENCE_INTERVAL_UNAVAILABLE")
        if validation_input.previous_results.previous is None and "DELTA_CHECK_NOT_AVAILABLE" not in issues:
            issues.append("DELTA_CHECK_NOT_AVAILABLE")
        return {**result.get("data_quality", {}), "issues": issues}

    @staticmethod
    def _final_status(validation_input: ValidationInput, review_items: list[ReviewItem]) -> str:
        result = validation_input.result
        if not result.get("id") or not result.get("unit") or not (
            result.get("analyte_code") or result.get("analyte")
        ):
            return "DATA_ERROR"
        if not result.get("loinc_code") or not result.get("reference_interval"):
            return "INSUFFICIENT_DATA"
        if review_items:
            return "REVIEW_REQUIRED"
        return "VALIDATION_COMPLETE"

    @staticmethod
    def _evidence_chain(items: list[ReviewItem], validation_input: ValidationInput, timestamp: datetime, data_quality_issues: list[str]) -> list[EvidenceChainEntry]:
        configuration = validation_input.laboratory_configuration.model_dump(mode="json")
        version = validation_input.laboratory_configuration.knowledge_snapshot.labguard_engine_version
        entries = [
            EvidenceChainEntry(
                rule_id=item.rule_id or f"{item.source.lower()}_review",
                rule_version=version,
                source=item.source,
                source_version=version,
                input_values=item.evidence,
                calculation=item.reason,
                configuration=configuration,
                timestamp=timestamp,
                result="REVIEW_REQUIRED",
            )
            for item in items
        ]
        entries.extend(
            EvidenceChainEntry(
                rule_id=issue,
                rule_version=version,
                source="DATA_VALIDATION",
                source_version=version,
                input_values={"result": validation_input.result},
                calculation="Required input was not supplied; no value was inferred.",
                configuration=configuration,
                timestamp=timestamp,
                result=issue,
            )
            for issue in data_quality_issues
        )
        return entries

    @staticmethod
    def _audit(
        trail: list[AuditTrailEntry],
        stage: str,
        input_summary: dict[str, Any],
        laboratory_configuration,
        output_summary: dict[str, Any],
    ) -> None:
        trail.append(
            AuditTrailEntry(
                audit_id=f"{stage}-{len(trail) + 1}",
                stage=stage,
                timestamp=ValidationEngine._evaluation_timestamp_from_result(input_summary),
                input_summary=input_summary,
                configuration={
                    "configuration_version": laboratory_configuration.configuration_version,
                    "laboratory_identifier": laboratory_configuration.laboratory_identifier,
                    "knowledge_snapshot": laboratory_configuration.knowledge_snapshot.model_dump(),
                },
                output_summary=output_summary,
                evidence={"source": "ValidationEngine"},
            )
        )

    @staticmethod
    def _evaluation_timestamp_from_result(input_summary: dict[str, Any]) -> datetime:
        value = input_summary.get("timestamp")
        if isinstance(value, str):
            try:
                timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
                return timestamp if timestamp.tzinfo else timestamp.replace(tzinfo=UTC)
            except ValueError:
                pass
        return datetime(1970, 1, 1, tzinfo=UTC)

    @staticmethod
    def _review_items(qc_decisions, specimen_events, delta_events, consistency_events, rule_results) -> list[ReviewItem]:
        items: list[ReviewItem] = []
        items.extend(
            ReviewItem(source="QC", reason=decision.reason, evidence=decision.evidence, rule_id=decision.rule_id)
            for decision in qc_decisions
            if decision.triggered
        )
        items.extend(
            ReviewItem(source="SPECIMEN_QUALITY", reason=event.evidence, evidence={"possible_impact": event.possible_impact, "source_reference": event.source_reference}, rule_id=event.interference_id)
            for event in specimen_events
            if event.status == "REVIEW_REQUIRED"
        )
        items.extend(
            ReviewItem(source="DELTA_CHECK", reason=event.reason, evidence=event.evidence, rule_id=event.rule_activated)
            for event in delta_events
            if event.rule_activated is not None
        )
        items.extend(
            ReviewItem(source="CONSISTENCY", reason=event.explanation, evidence=event.evidence, rule_id=event.rule_id)
            for event in consistency_events
            if event.triggered
        )
        items.extend(
            ReviewItem(source="RULE_ENGINE", reason=result.reason, evidence={item.field: item.observed_value for item in result.evidence}, rule_id=result.rule_id)
            for result in rule_results
            if result.triggered
        )
        return items
