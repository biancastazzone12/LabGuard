from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from app.analytical_consistency.models import ConsistencyContext, ConsistencyEvent, ConsistencyRuleConfig
from app.delta_checks.models import DeltaComparisonContext, DeltaEvent, DeltaRuleConfig
from app.engine.models import EvaluationContext, RuleDefinition, RuleResult
from app.qc.models import QcObservation, QcRuleConfig, QcRuleDecision
from app.specimen_quality.models import InterferenceConfig, SpecimenQualityContext, SpecimenQualityEvent


ValidationStage = Literal[
    "RESULT",
    "QC",
    "SPECIMEN_QUALITY",
    "DELTA_CHECK",
    "INTERFERENCE",
    "CONSISTENCY",
    "RULE_ENGINE",
    "VALIDATION_PROFILE",
    "PROFESSIONAL_REVIEW",
]


class KnowledgeSnapshot(BaseModel):
    loinc_version: str = "NOT_INSTALLED"
    unit_dataset_version: str = "NOT_INSTALLED"
    reference_interval_version: str = "NOT_INSTALLED"
    qc_rules_version: str = "NOT_INSTALLED"
    interference_rules_version: str = "NOT_INSTALLED"
    labguard_engine_version: str = "0.1.0"


class LaboratoryConfiguration(BaseModel):
    configuration_version: str = Field(min_length=1)
    laboratory_identifier: str = Field(min_length=1)
    settings: dict[str, Any] = Field(default_factory=dict)
    knowledge_snapshot: KnowledgeSnapshot = Field(default_factory=KnowledgeSnapshot)


class ProfessionalDecision(BaseModel):
    status: Literal["not_recorded", "recorded"] = "not_recorded"
    value: str | None = None
    actor_id: str | None = None
    recorded_at: datetime | None = None
    comment: str | None = None


class ValidationInput(BaseModel):
    result: dict[str, Any]
    sample: SpecimenQualityContext
    qc_observations: list[QcObservation] = Field(default_factory=list)
    qc_rules: list[QcRuleConfig] = Field(default_factory=list)
    previous_results: DeltaComparisonContext
    delta_rules: list[DeltaRuleConfig] = Field(default_factory=list)
    interferences: list[InterferenceConfig] = Field(default_factory=list)
    consistency: ConsistencyContext
    consistency_rules: list[ConsistencyRuleConfig] = Field(default_factory=list)
    rule_context: EvaluationContext
    rules: list[RuleDefinition] = Field(default_factory=list)
    laboratory_configuration: LaboratoryConfiguration


class AuditTrailEntry(BaseModel):
    audit_id: str = Field(default_factory=lambda: str(uuid4()))
    stage: ValidationStage
    timestamp: datetime
    input_summary: dict[str, Any]
    configuration: dict[str, Any]
    output_summary: dict[str, Any]
    evidence: dict[str, Any] = Field(default_factory=dict)


class ReviewItem(BaseModel):
    source: str
    reason: str
    evidence: dict[str, Any]
    rule_id: str | None = None


class EvidenceChainEntry(BaseModel):
    rule_id: str
    rule_version: str
    source: str
    source_version: str
    input_values: dict[str, Any]
    calculation: str
    threshold: Any | None = None
    configuration: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime
    result: str


FinalValidationStatus = Literal[
    "VALIDATION_COMPLETE",
    "REVIEW_REQUIRED",
    "INSUFFICIENT_DATA",
    "CONFIGURATION_REQUIRED",
    "DATA_ERROR",
]


class ValidationProfile(BaseModel):
    profile_id: str = Field(default_factory=lambda: str(uuid4()))
    created_at: datetime
    result_id: str
    evaluated: list[ValidationStage]
    result: dict[str, Any]
    qc_decisions: list[QcRuleDecision]
    specimen_events: list[SpecimenQualityEvent]
    delta_events: list[DeltaEvent]
    consistency_events: list[ConsistencyEvent]
    rule_results: list[RuleResult]
    audit_trail: list[AuditTrailEntry]
    review_items: list[ReviewItem]
    system_recommendation: str
    professional_decision: ProfessionalDecision
    knowledge_snapshot: KnowledgeSnapshot
    sample_id: str = "unknown-sample"
    timestamp: datetime | None = None
    analyte: str | None = None
    loinc_code: str | None = None
    value: Any | None = None
    unit: str | None = None
    method: str | None = None
    instrument: str | None = None
    data_quality: dict[str, Any] = Field(default_factory=dict)
    specimen_quality: list[SpecimenQualityEvent] = Field(default_factory=list)
    qc_status: str = "NOT_EVALUATED"
    reference_interval: dict[str, Any] | None = None
    delta_check: list[DeltaEvent] = Field(default_factory=list)
    interference_assessment: list[SpecimenQualityEvent] = Field(default_factory=list)
    consistency_assessment: list[ConsistencyEvent] = Field(default_factory=list)
    triggered_rules: list[str] = Field(default_factory=list)
    evidence_chain: list[EvidenceChainEntry] = Field(default_factory=list)
    final_status: FinalValidationStatus = "REVIEW_REQUIRED"

    @property
    def has_qc_problem(self) -> bool:
        return any(decision.triggered for decision in self.qc_decisions)

    @property
    def has_preanalytical_problem(self) -> bool:
        return any(event.status == "REVIEW_REQUIRED" for event in self.specimen_events)

    @property
    def has_delta_check(self) -> bool:
        return any(event.rule_activated is not None for event in self.delta_events)

    @property
    def has_consistency_problem(self) -> bool:
        return any(event.triggered for event in self.consistency_events)
