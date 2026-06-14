use std::fmt;

use liquid::model::Value;
use liquid_core::error::{Error, Result};
use liquid_core::model::ValueView;
use liquid_core::parser::{
    Filter, FilterArguments, FilterReflection, ParameterReflection, ParseFilter,
};
use liquid_core::runtime::Runtime;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct UuidFilterParser;

impl ParseFilter for UuidFilterParser {
    fn parse(&self, arguments: FilterArguments<'_>) -> Result<Box<dyn Filter>> {
        let FilterArguments {
            mut positional,
            mut keyword,
        } = arguments;

        if positional.next().is_some() || keyword.next().is_some() {
            return Err(Error::with_msg("uuid filter does not accept arguments"));
        }

        Ok(Box::new(UuidFilter))
    }

    fn reflection(&self) -> &dyn FilterReflection {
        self
    }
}

impl FilterReflection for UuidFilterParser {
    fn name(&self) -> &str {
        "uuid"
    }

    fn description(&self) -> &str {
        "Generates a RFC4122 version 4 UUID string"
    }

    fn positional_parameters(&self) -> &'static [ParameterReflection] {
        &[]
    }

    fn keyword_parameters(&self) -> &'static [ParameterReflection] {
        &[]
    }
}

#[derive(Debug, Default)]
struct UuidFilter;

impl fmt::Display for UuidFilter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("uuid")
    }
}

impl Filter for UuidFilter {
    fn evaluate(&self, _input: &dyn ValueView, _runtime: &dyn Runtime) -> Result<Value> {
        Ok(Value::scalar(Uuid::new_v4().to_string()))
    }
}
