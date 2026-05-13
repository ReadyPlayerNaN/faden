pub mod cost;
pub mod prompts;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodebookProposal {
    pub proposals: Vec<ClusterProposal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterProposal {
    pub cluster: NameDesc,
    pub categories: Vec<CategoryProposal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NameDesc {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryProposal {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub tags: Vec<TagProposal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagProposal {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub evidence_quotes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpanSuggestions {
    pub suggestions: Vec<SpanSuggestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpanSuggestion {
    pub segment_id: i64,
    pub start_offset: i32,
    pub end_offset: i32,
    pub tag_names: Vec<String>,
    #[serde(default)]
    pub rationale: Option<String>,
}

pub const CODEBOOK_RESPONSE_SCHEMA: &str = r#"{
  "type": "object",
  "required": ["proposals"],
  "properties": {
    "proposals": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["cluster", "categories"],
        "properties": {
          "cluster": {
            "type": "object",
            "required": ["name"],
            "properties": {
              "name": {"type": "string"},
              "description": {"type": ["string", "null"]}
            }
          },
          "categories": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["name", "tags"],
              "properties": {
                "name": {"type": "string"},
                "description": {"type": ["string", "null"]},
                "tags": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["name"],
                    "properties": {
                      "name": {"type": "string"},
                      "description": {"type": ["string", "null"]},
                      "evidence_quotes": {"type": "array", "items": {"type": "string"}}
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}"#;

pub const SPAN_SUGGESTIONS_SCHEMA: &str = r#"{
  "type": "object",
  "required": ["suggestions"],
  "properties": {
    "suggestions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["segment_id", "start_offset", "end_offset", "tag_names"],
        "properties": {
          "segment_id": {"type": "integer"},
          "start_offset": {"type": "integer"},
          "end_offset": {"type": "integer"},
          "tag_names": {"type": "array", "items": {"type": "string"}},
          "rationale": {"type": ["string", "null"]}
        }
      }
    }
  }
}"#;
