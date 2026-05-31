pub mod categorize;
pub mod cluster_suggest;
pub mod codebook_gen;
pub mod cost;
pub mod find_more;
pub mod pretag;
pub mod prompts;
pub mod text;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodebookProposal {
    pub proposals: Vec<TagProposal>,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpanSuggestionKind {
    NewSpan,
    ExtendSpan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpanSuggestion {
    #[serde(default)]
    pub kind: Option<SpanSuggestionKind>,
    #[serde(default)]
    pub existing_span_id: Option<i64>,
    pub segment_id: i64,
    pub start_offset: i32,
    pub end_offset: i32,
    pub tag_names: Vec<String>,
    #[serde(default)]
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExistingTagRef {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExistingCategoryRef {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestedCategoryTarget {
    #[serde(default)]
    pub existing_category_id: Option<i64>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestedClusterTarget {
    #[serde(default)]
    pub existing_cluster_id: Option<i64>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategorizeSuggestion {
    pub category: SuggestedCategoryTarget,
    pub tags: Vec<ExistingTagRef>,
    #[serde(default)]
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategorizeSuggestions {
    pub proposals: Vec<CategorizeSuggestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterSuggestion {
    pub cluster: SuggestedClusterTarget,
    pub categories: Vec<ExistingCategoryRef>,
    #[serde(default)]
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterSuggestions {
    pub proposals: Vec<ClusterSuggestion>,
}

pub const CODEBOOK_RESPONSE_SCHEMA: &str = r#"{
  "type": "object",
  "required": ["proposals"],
  "properties": {
    "proposals": {
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
          "kind": {"type": ["string", "null"], "enum": ["new_span", "extend_span", null]},
          "existing_span_id": {"type": ["integer", "null"]},
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

pub const CATEGORIZE_SUGGESTIONS_SCHEMA: &str = r#"{
  "type": "object",
  "required": ["proposals"],
  "properties": {
    "proposals": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["category", "tags"],
        "properties": {
          "category": {
            "type": "object",
            "required": ["name"],
            "properties": {
              "existing_category_id": {"type": ["integer", "null"]},
              "name": {"type": "string"},
              "description": {"type": ["string", "null"]}
            }
          },
          "tags": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "name"],
              "properties": {
                "id": {"type": "integer"},
                "name": {"type": "string"},
                "description": {"type": ["string", "null"]}
              }
            }
          },
          "rationale": {"type": ["string", "null"]}
        }
      }
    }
  }
}"#;

pub const CLUSTER_SUGGESTIONS_SCHEMA: &str = r#"{
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
              "existing_cluster_id": {"type": ["integer", "null"]},
              "name": {"type": "string"},
              "description": {"type": ["string", "null"]}
            }
          },
          "categories": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "name"],
              "properties": {
                "id": {"type": "integer"},
                "name": {"type": "string"},
                "description": {"type": ["string", "null"]}
              }
            }
          },
          "rationale": {"type": ["string", "null"]}
        }
      }
    }
  }
}"#;
