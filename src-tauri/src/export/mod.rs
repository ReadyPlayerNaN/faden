pub mod codebook;
pub mod csv_export;
pub mod markdown;
pub mod refi_qda;
pub mod stats;

use crate::db::queries::category::Category;
use crate::db::queries::cluster::Cluster;
use crate::db::queries::interview::Interview;
use crate::db::queries::memo::Memo;
use crate::db::queries::segment::Segment;
use crate::db::queries::speaker::Speaker;
use crate::db::queries::tag::Tag;
use crate::db::queries::tagged_span::TaggedSpan;
use crate::db::queries::{
    category, cluster, interview, memo, project_meta, segment, span_tag, speaker, tag, tagged_span,
};
use crate::error::AppResult;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExportScope {
    pub interview_ids: Option<Vec<i64>>,
    pub tag_ids: Option<Vec<i64>>,
}

#[derive(Debug, Clone)]
pub struct SpanWithTags {
    pub span: TaggedSpan,
    pub tags: Vec<i64>,
    pub memo: Option<Memo>,
}

#[derive(Debug, Clone)]
pub struct InterviewExport {
    pub interview: Interview,
    pub speakers: HashMap<i64, Speaker>,
    pub segments: Vec<Segment>,
    pub spans: Vec<SpanWithTags>,
}

#[derive(Debug, Clone)]
pub struct ProjectExportData {
    pub project_name: String,
    pub interviews: Vec<InterviewExport>,
    pub clusters: Vec<Cluster>,
    pub categories: Vec<Category>,
    pub tags: Vec<Tag>,
}

pub fn compose(conn: &Connection, scope: &ExportScope) -> AppResult<ProjectExportData> {
    let meta = project_meta::read(conn)?;
    let clusters = cluster::list(conn)?;
    let categories = category::list_all(conn)?;
    let tags = tag::list_all(conn)?;

    let all_interviews = interview::list(conn)?;
    let included: Vec<Interview> = match &scope.interview_ids {
        Some(ids) => all_interviews
            .into_iter()
            .filter(|i| ids.contains(&i.id))
            .collect(),
        None => all_interviews,
    };

    let tag_filter: Option<std::collections::HashSet<i64>> =
        scope.tag_ids.as_ref().map(|v| v.iter().copied().collect());

    let mut interviews = Vec::new();
    for iv in included {
        let sp_list = speaker::list_for_interview(conn, iv.id)?;
        let speakers: HashMap<i64, Speaker> = sp_list.into_iter().map(|s| (s.id, s)).collect();
        let segments = segment::list_for_interview(conn, iv.id)?;
        let all_spans = tagged_span::list_for_interview(conn, iv.id)?;
        let mut spans = Vec::new();
        for span in all_spans {
            let tag_ids: Vec<i64> = span_tag::list_for_span(conn, span.id)?
                .into_iter()
                .map(|(id, _)| id)
                .collect();
            if let Some(filter) = &tag_filter {
                if !tag_ids.iter().any(|t| filter.contains(t)) {
                    continue;
                }
            }
            let m = memo::get_for_span(conn, span.id)?;
            spans.push(SpanWithTags {
                span,
                tags: tag_ids,
                memo: m,
            });
        }
        interviews.push(InterviewExport {
            interview: iv,
            speakers,
            segments,
            spans,
        });
    }

    Ok(ProjectExportData {
        project_name: meta.name,
        interviews,
        clusters,
        categories,
        tags,
    })
}
