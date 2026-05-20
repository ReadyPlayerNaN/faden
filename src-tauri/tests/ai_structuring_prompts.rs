use faden_app_lib::ai::{categorize, cluster_suggest, text};
use faden_app_lib::db::migrations::apply_migrations;
use faden_app_lib::db::queries::{
    category, cluster, interview, segment, span_tag, tag, tagged_span,
};
use rusqlite::Connection;

fn fresh() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut conn).unwrap();
    conn
}

fn seed_structuring_fixture(conn: &mut Connection) -> (i64, i64) {
    let work_cluster = cluster::create(
        conn,
        "Work organization",
        Some("Coordination structure"),
        None,
    )
    .unwrap();
    let coordination = category::create(
        conn,
        Some(work_cluster.id),
        "Coordination friction",
        Some("Problems in ownership and handoffs"),
        None,
    )
    .unwrap();
    let role_ambiguity = tag::create(
        conn,
        Some(coordination.id),
        "Role ambiguity",
        Some("Unclear responsibility boundaries"),
        None,
    )
    .unwrap();
    let escalation = tag::create(
        conn,
        None,
        "Informal escalation",
        Some("Workaround through side channels"),
        None,
    )
    .unwrap();

    let interview = interview::create(conn, "Interview 1").unwrap();
    let segment_ids = segment::insert_batch(
        conn,
        interview.id,
        &[
            segment::NewSegment {
                speaker_id: None,
                start_sec: 0.0,
                end_sec: 5.0,
                text: "Nobody knew who was supposed to approve the request, so we kept bouncing it around.".into(),
            },
            segment::NewSegment {
                speaker_id: None,
                start_sec: 5.0,
                end_sec: 10.0,
                text: "I ended up messaging a manager privately because the normal queue never moved.".into(),
            },
        ],
    )
    .unwrap();

    let span_one = tagged_span::create(
        conn,
        &tagged_span::NewSpan {
            interview_id: interview.id,
            segment_id: segment_ids[0],
            start_offset: 0,
            end_offset: 52,
            text_snapshot: "Nobody knew who was supposed to approve the request",
            audio_start_sec: 0.0,
            audio_end_sec: 2.5,
        },
    )
    .unwrap();
    let span_two = tagged_span::create(
        conn,
        &tagged_span::NewSpan {
            interview_id: interview.id,
            segment_id: segment_ids[1],
            start_offset: 0,
            end_offset: 62,
            text_snapshot:
                "I ended up messaging a manager privately because the normal queue never moved",
            audio_start_sec: 5.0,
            audio_end_sec: 8.0,
        },
    )
    .unwrap();

    span_tag::attach(
        conn,
        span_one.id,
        role_ambiguity.id,
        span_tag::SpanTagSource::Manual,
    )
    .unwrap();
    span_tag::attach(
        conn,
        span_two.id,
        escalation.id,
        span_tag::SpanTagSource::Manual,
    )
    .unwrap();

    (coordination.id, work_cluster.id)
}

#[test]
fn categorize_prompt_context_includes_reusable_ids_counts_and_evidence() {
    let mut conn = fresh();
    let (coordination_id, work_cluster_id) = seed_structuring_fixture(&mut conn);

    let formatted = text::format_tags_for_categorizing(&conn).unwrap();

    assert!(formatted.contains("Existing categories available for reuse:"));
    assert!(formatted.contains(&format!(
        "[category_id={coordination_id}] Coordination friction"
    )));
    assert!(formatted.contains(&format!("[cluster_id={work_cluster_id}] Work organization")));
    assert!(formatted.contains("tagged spans: 1"));
    assert!(formatted.contains("member tags: [tag_id="));
    assert!(formatted.contains("evidence: \"Nobody knew who was supposed to approve the request\""));

    let prompt =
        categorize::build_prompt(&conn, &categorize::CategorizeInput, None, "English").unwrap();
    assert!(prompt.contains("Prioritize analytic coherence"));
    assert!(prompt.contains("Reuse an existing category whenever the fit is genuinely"));
    assert!(prompt.contains("leave a tag unassigned"));
    assert!(prompt.contains("omit tags that do not have a strong home"));
    assert!(
        prompt.contains("Rationales\nmust be evidence-based")
            || prompt.contains("Rationales must be evidence-based")
    );
}

#[test]
fn category_and_cluster_usage_counts_deduplicate_shared_spans() {
    let mut conn = fresh();
    let (coordination_id, work_cluster_id) = seed_structuring_fixture(&mut conn);
    let second_tag = tag::create(
        &conn,
        Some(coordination_id),
        "Approval confusion",
        Some("Unclear approval ownership"),
        None,
    )
    .unwrap();
    let shared_span = tagged_span::list_for_tag(&conn, second_tag.id).unwrap();
    assert!(shared_span.is_empty());
    let first_span = tagged_span::list_for_tag(
        &conn,
        tag::list_all(&conn)
            .unwrap()
            .into_iter()
            .find(|t| t.name == "Role ambiguity")
            .unwrap()
            .id,
    )
    .unwrap();
    span_tag::attach(
        &conn,
        first_span[0].id,
        second_tag.id,
        span_tag::SpanTagSource::Manual,
    )
    .unwrap();

    let categories_text = text::format_tags_for_categorizing(&conn).unwrap();
    let category_line = categories_text
        .lines()
        .find(|line| line.contains(&format!("[category_id={coordination_id}]")))
        .unwrap();
    assert!(category_line.contains("tagged spans: 1"));

    let clusters_text = text::format_categories_for_clustering(&conn).unwrap();
    let cluster_line = clusters_text
        .lines()
        .find(|line| line.contains(&format!("[cluster_id={work_cluster_id}]")))
        .unwrap();
    assert!(cluster_line.contains("tagged spans: 1"));
}

#[test]
fn cluster_prompt_context_includes_reusable_ids_counts_and_evidence() {
    let mut conn = fresh();
    let (coordination_id, work_cluster_id) = seed_structuring_fixture(&mut conn);

    let formatted = text::format_categories_for_clustering(&conn).unwrap();

    assert!(formatted.contains("Existing clusters available for reuse:"));
    assert!(formatted.contains(&format!("[cluster_id={work_cluster_id}] Work organization")));
    assert!(formatted.contains(&format!(
        "[category_id={coordination_id}] Coordination friction"
    )));
    assert!(formatted.contains("member categories: "));
    assert!(formatted.contains("tag count: 1"));
    assert!(formatted.contains("evidence: \"Nobody knew who was supposed to approve the request\""));

    let prompt =
        cluster_suggest::build_prompt(&conn, &cluster_suggest::ClusterInput, None, "English")
            .unwrap();
    assert!(prompt.contains("Prioritize analytic coherence"));
    assert!(
        prompt.contains("Reuse an existing cluster\nwhenever the fit is genuinely")
            || prompt.contains("Reuse an existing cluster whenever the fit is genuinely")
    );
    assert!(prompt.contains("leave a category unassigned"));
    assert!(prompt.contains("omit categories that do not have a strong home"));
    assert!(prompt.contains("Rationales must be evidence-based"));
}
