use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::models::request::ExtractionSource;

fn default_true() -> bool {
    true
}

fn default_extraction_source() -> ExtractionSource {
    ExtractionSource::ResponseBodyJson
}

/// A flow-scoped variable passed into a step before it runs. The `value` may
/// reference variables produced by earlier steps with `{{var}}` syntax.
#[derive(Debug, Serialize, Deserialize, TS, Clone, Default)]
#[ts(export, export_to = "flowInputVariable.ts")]
pub struct FlowInputVariable {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// A flow-scoped response extraction that publishes a value into the flow
/// context for use by later steps, without editing the underlying request.
#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[ts(export, export_to = "flowExtractionRule.ts")]
pub struct FlowExtractionRule {
    #[serde(default)]
    pub target: String,
    #[serde(default = "default_extraction_source")]
    pub source: ExtractionSource,
    #[serde(default)]
    pub pattern: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone, Default)]
#[serde(default)]
#[ts(export, export_to = "flowStep.ts")]
pub struct FlowStep {
    pub request_id: String,
    /// Variables passed into this step before it runs. The `value` may
    /// reference variables produced by earlier steps with `{{var}}` syntax.
    /// Alias `overrides` preserves flow files saved before this rename.
    #[serde(default, alias = "overrides")]
    pub input_variables: Vec<FlowInputVariable>,
    /// Variables extracted from this step's response and exported to the flow
    /// context for use by later steps, in addition to the step's own persisted
    /// `response_extractions`.
    #[serde(default)]
    pub export_variables: Vec<FlowExtractionRule>,
    /// Suppresses this step's own persisted `before_run` chain when run as part
    /// of the flow, without mutating the underlying request.
    #[serde(default)]
    pub skip_before_chain: bool,
    /// Suppresses this step's own persisted `on_success` chain_steps when run
    /// as part of the flow, without mutating the underlying request.
    #[serde(default)]
    pub skip_on_success_chain: bool,
    /// Suppresses this step's own persisted `on_failure` chain_steps when run
    /// as part of the flow, without mutating the underlying request.
    #[serde(default)]
    pub skip_on_failure_chain: bool,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[ts(export, export_to = "firvFlow.ts")]
pub struct FirvFlow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub steps: Vec<FlowStep>,
}
