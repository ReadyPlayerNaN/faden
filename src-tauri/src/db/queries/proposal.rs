use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProposalKind {
    CodebookGen,
    Pretag,
    FindMore,
}

impl ProposalKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CodebookGen => "codebook_gen",
            Self::Pretag => "pretag",
            Self::FindMore => "find_more",
        }
    }
    pub fn parse(s: &str) -> AppResult<Self> {
        match s {
            "codebook_gen" => Ok(Self::CodebookGen),
            "pretag" => Ok(Self::Pretag),
            "find_more" => Ok(Self::FindMore),
            other => Err(AppError::Invalid(format!("proposal kind: {other}"))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProposalStatus {
    Pending,
    Accepted,
    Rejected,
}

impl ProposalStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
        }
    }
    pub fn parse(s: &str) -> AppResult<Self> {
        match s {
            "pending" => Ok(Self::Pending),
            "accepted" => Ok(Self::Accepted),
            "rejected" => Ok(Self::Rejected),
            other => Err(AppError::Invalid(format!("proposal status: {other}"))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredProposal {
    pub id: i64,
    pub ai_run_id: i64,
    pub kind: ProposalKind,
    pub payload: Value,
    pub status: ProposalStatus,
    pub created_at: String,
    pub decided_at: Option<String>,
}

pub fn create(
    conn: &Connection,
    ai_run_id: i64,
    kind: ProposalKind,
    payload: &Value,
) -> AppResult<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    let payload_json = serde_json::to_string(payload)?;
    conn.execute(
        "INSERT INTO proposal (ai_run_id, kind, payload_json, status, created_at) VALUES (?1, ?2, ?3, 'pending', ?4)",
        params![ai_run_id, kind.as_str(), payload_json, now],
    )?;
    Ok(conn.last_insert_rowid())
}

fn map_row(r: &rusqlite::Row) -> rusqlite::Result<StoredProposal> {
    let kind_str: String = r.get(2)?;
    let status_str: String = r.get(4)?;
    let payload_str: String = r.get(3)?;
    let payload: Value = serde_json::from_str(&payload_str).map_err(|_| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, "bad json".into())
    })?;
    Ok(StoredProposal {
        id: r.get(0)?,
        ai_run_id: r.get(1)?,
        kind: ProposalKind::parse(&kind_str).map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                "bad kind".into(),
            )
        })?,
        payload,
        status: ProposalStatus::parse(&status_str).map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Text,
                "bad status".into(),
            )
        })?,
        created_at: r.get(5)?,
        decided_at: r.get(6)?,
    })
}

pub fn get(conn: &Connection, id: i64) -> AppResult<StoredProposal> {
    conn.query_row(
        "SELECT id, ai_run_id, kind, payload_json, status, created_at, decided_at FROM proposal WHERE id = ?1",
        params![id],
        map_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("proposal {id}")))
}

pub fn list(
    conn: &Connection,
    kind: Option<ProposalKind>,
    statuses: &[ProposalStatus],
) -> AppResult<Vec<StoredProposal>> {
    let mut out = Vec::new();
    let mut all = Vec::new();
    if let Some(k) = kind {
        let mut stmt = conn.prepare(
            "SELECT id, ai_run_id, kind, payload_json, status, created_at, decided_at FROM proposal WHERE kind = ?1 ORDER BY created_at DESC",
        )?;
        for r in stmt.query_map(params![k.as_str()], map_row)? {
            all.push(r?);
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, ai_run_id, kind, payload_json, status, created_at, decided_at FROM proposal ORDER BY created_at DESC",
        )?;
        for r in stmt.query_map([], map_row)? {
            all.push(r?);
        }
    }

    let status_filter: std::collections::HashSet<ProposalStatus> =
        statuses.iter().copied().collect();
    for proposal in all {
        if status_filter.contains(&proposal.status) {
            out.push(proposal);
        }
    }
    Ok(out)
}

pub fn list_for_run(
    conn: &Connection,
    ai_run_id: i64,
    kind: Option<ProposalKind>,
    statuses: &[ProposalStatus],
) -> AppResult<Vec<StoredProposal>> {
    Ok(list(conn, kind, statuses)?
        .into_iter()
        .filter(|proposal| proposal.ai_run_id == ai_run_id)
        .collect())
}

pub fn list_pending(
    conn: &Connection,
    kind: Option<ProposalKind>,
) -> AppResult<Vec<StoredProposal>> {
    list(conn, kind, &[ProposalStatus::Pending])
}

pub fn mark_accepted(conn: &Connection, id: i64) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn.execute(
        "UPDATE proposal SET status = 'accepted', decided_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("proposal {id}")));
    }
    Ok(())
}

pub fn mark_rejected(conn: &Connection, id: i64) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn.execute(
        "UPDATE proposal SET status = 'rejected', decided_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("proposal {id}")));
    }
    Ok(())
}
