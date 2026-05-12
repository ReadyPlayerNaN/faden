use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::{category, cluster, stats, tag};

fn fresh_conn() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

#[test]
fn cluster_create_assigns_id_and_appends() {
    let conn = fresh_conn();
    let a = cluster::create(&conn, "Identity", None, None).unwrap();
    let b = cluster::create(&conn, "Work", None, None).unwrap();
    assert!(b.id > a.id);
    assert_eq!(b.order_index, a.order_index + 1);
}

#[test]
fn cluster_create_rejects_duplicate_name() {
    let conn = fresh_conn();
    cluster::create(&conn, "Identity", None, None).unwrap();
    let err = cluster::create(&conn, "Identity", None, None).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::Conflict(_)));
}

#[test]
fn cluster_list_returns_in_order() {
    let conn = fresh_conn();
    cluster::create(&conn, "A", None, None).unwrap();
    cluster::create(&conn, "B", None, None).unwrap();
    cluster::create(&conn, "C", None, None).unwrap();
    let all = cluster::list(&conn).unwrap();
    let names: Vec<_> = all.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["A", "B", "C"]);
}

#[test]
fn cluster_rename_persists() {
    let conn = fresh_conn();
    let c = cluster::create(&conn, "Old", None, None).unwrap();
    cluster::rename(&conn, c.id, "New").unwrap();
    let all = cluster::list(&conn).unwrap();
    assert_eq!(all[0].name, "New");
}

#[test]
fn cluster_rename_rejects_duplicate() {
    let conn = fresh_conn();
    let a = cluster::create(&conn, "A", None, None).unwrap();
    cluster::create(&conn, "B", None, None).unwrap();
    let err = cluster::rename(&conn, a.id, "B").unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::Conflict(_)));
}

#[test]
fn cluster_delete_works_when_empty() {
    let conn = fresh_conn();
    let c = cluster::create(&conn, "A", None, None).unwrap();
    cluster::delete(&conn, c.id).unwrap();
    assert!(cluster::list(&conn).unwrap().is_empty());
}

#[test]
fn cluster_reorder_swaps_indexes() {
    let mut conn = fresh_conn();
    let a = cluster::create(&conn, "A", None, None).unwrap();
    let b = cluster::create(&conn, "B", None, None).unwrap();
    let c = cluster::create(&conn, "C", None, None).unwrap();
    cluster::reorder(&mut conn, &[c.id, a.id, b.id]).unwrap();
    let all = cluster::list(&conn).unwrap();
    let names: Vec<_> = all.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["C", "A", "B"]);
}

#[test]
fn category_create_requires_existing_cluster() {
    let conn = fresh_conn();
    let err = category::create(&conn, 999, "X", None, None).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::NotFound(_)));
}

#[test]
fn category_create_appends_within_cluster() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "Identity", None, None).unwrap();
    let a = category::create(&conn, cl.id, "A", None, None).unwrap();
    let b = category::create(&conn, cl.id, "B", None, None).unwrap();
    assert_eq!(b.order_index, a.order_index + 1);
}

#[test]
fn category_name_unique_across_project() {
    let conn = fresh_conn();
    let c1 = cluster::create(&conn, "C1", None, None).unwrap();
    let c2 = cluster::create(&conn, "C2", None, None).unwrap();
    category::create(&conn, c1.id, "Same", None, None).unwrap();
    let err = category::create(&conn, c2.id, "Same", None, None).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::Conflict(_)));
}

#[test]
fn category_list_for_cluster_filters() {
    let conn = fresh_conn();
    let c1 = cluster::create(&conn, "C1", None, None).unwrap();
    let c2 = cluster::create(&conn, "C2", None, None).unwrap();
    category::create(&conn, c1.id, "A1", None, None).unwrap();
    category::create(&conn, c2.id, "A2", None, None).unwrap();
    assert_eq!(category::list_for_cluster(&conn, c1.id).unwrap().len(), 1);
}

#[test]
fn category_move_to_cluster_works() {
    let conn = fresh_conn();
    let c1 = cluster::create(&conn, "C1", None, None).unwrap();
    let c2 = cluster::create(&conn, "C2", None, None).unwrap();
    let cat = category::create(&conn, c1.id, "Moveme", None, None).unwrap();
    category::move_to_cluster(&conn, cat.id, c2.id).unwrap();
    let moved = category::get(&conn, cat.id).unwrap();
    assert_eq!(moved.cluster_id, c2.id);
}

#[test]
fn category_reorder_within_cluster() {
    let mut conn = fresh_conn();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let a = category::create(&conn, cl.id, "A", None, None).unwrap();
    let b = category::create(&conn, cl.id, "B", None, None).unwrap();
    let cc = category::create(&conn, cl.id, "C2", None, None).unwrap();
    category::reorder(&mut conn, cl.id, &[cc.id, a.id, b.id]).unwrap();
    let listed = category::list_for_cluster(&conn, cl.id).unwrap();
    let names: Vec<_> = listed.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["C2", "A", "B"]);
}

#[test]
fn category_delete_empty_works() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, cl.id, "X", None, None).unwrap();
    category::delete(&conn, cat.id).unwrap();
    assert!(category::list_all(&conn).unwrap().is_empty());
}

#[test]
fn tag_create_requires_existing_category() {
    let conn = fresh_conn();
    let err = tag::create(&conn, 999, "X", None, None).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::NotFound(_)));
}

#[test]
fn tag_create_appends_within_category() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "Cl", None, None).unwrap();
    let cat = category::create(&conn, cl.id, "Cat", None, None).unwrap();
    let a = tag::create(&conn, cat.id, "A", None, None).unwrap();
    let b = tag::create(&conn, cat.id, "B", None, None).unwrap();
    assert_eq!(b.order_index, a.order_index + 1);
}

#[test]
fn tag_name_unique_across_project() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "Cl", None, None).unwrap();
    let c1 = category::create(&conn, cl.id, "C1", None, None).unwrap();
    let c2 = category::create(&conn, cl.id, "C2", None, None).unwrap();
    tag::create(&conn, c1.id, "Same", None, None).unwrap();
    let err = tag::create(&conn, c2.id, "Same", None, None).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::Conflict(_)));
}

#[test]
fn tag_list_for_category_filters() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "Cl", None, None).unwrap();
    let c1 = category::create(&conn, cl.id, "C1", None, None).unwrap();
    let c2 = category::create(&conn, cl.id, "C2", None, None).unwrap();
    tag::create(&conn, c1.id, "T1", None, None).unwrap();
    tag::create(&conn, c2.id, "T2", None, None).unwrap();
    assert_eq!(tag::list_for_category(&conn, c1.id).unwrap().len(), 1);
}

#[test]
fn tag_move_to_category_works() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "Cl", None, None).unwrap();
    let c1 = category::create(&conn, cl.id, "C1", None, None).unwrap();
    let c2 = category::create(&conn, cl.id, "C2", None, None).unwrap();
    let t = tag::create(&conn, c1.id, "Moveme", None, None).unwrap();
    tag::move_to_category(&conn, t.id, c2.id).unwrap();
    let moved = tag::get(&conn, t.id).unwrap();
    assert_eq!(moved.category_id, c2.id);
}

#[test]
fn tag_reorder_within_category() {
    let mut conn = fresh_conn();
    let cl = cluster::create(&conn, "Cl", None, None).unwrap();
    let cat = category::create(&conn, cl.id, "Cat", None, None).unwrap();
    let a = tag::create(&conn, cat.id, "A", None, None).unwrap();
    let b = tag::create(&conn, cat.id, "B", None, None).unwrap();
    let cc = tag::create(&conn, cat.id, "C", None, None).unwrap();
    tag::reorder(&mut conn, cat.id, &[cc.id, a.id, b.id]).unwrap();
    let listed = tag::list_for_category(&conn, cat.id).unwrap();
    let names: Vec<_> = listed.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, vec!["C", "A", "B"]);
}

#[test]
fn tag_delete_empty_works() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "Cl", None, None).unwrap();
    let cat = category::create(&conn, cl.id, "Cat", None, None).unwrap();
    let t = tag::create(&conn, cat.id, "X", None, None).unwrap();
    tag::delete(&conn, t.id).unwrap();
    assert!(tag::list_all(&conn).unwrap().is_empty());
}

#[test]
fn tag_delete_rejected_when_in_use() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, cl.id, "Cat", None, None).unwrap();
    let t = tag::create(&conn, cat.id, "T", None, None).unwrap();

    // Insert interview + segment + tagged_span + span_tag via raw SQL
    conn.execute("INSERT INTO interview (name, transcript_status, created_at, updated_at) VALUES ('I', 'none', '2026-05-12', '2026-05-12')", []).unwrap();
    let iid: i64 = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO speaker (interview_id, label_raw) VALUES (?1, 'A')",
        rusqlite::params![iid],
    ).unwrap();
    let sid: i64 = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO segment (interview_id, speaker_id, start_sec, end_sec, text, order_index) VALUES (?1, ?2, 0.0, 1.0, 'hi', 0)",
        rusqlite::params![iid, sid],
    ).unwrap();
    let seg_id: i64 = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO tagged_span (interview_id, segment_id, start_offset, end_offset, text_snapshot, audio_start_sec, audio_end_sec, created_at) VALUES (?1, ?2, 0, 1, 'hi', 0.0, 1.0, '2026-05-12')",
        rusqlite::params![iid, seg_id],
    ).unwrap();
    let span_id: i64 = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO span_tag (span_id, tag_id, source) VALUES (?1, ?2, 'manual')",
        rusqlite::params![span_id, t.id],
    ).unwrap();

    let err = tag::delete(&conn, t.id).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::Conflict(_)));
}

#[test]
fn stats_empty_db_zero_counts() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, cl.id, "Cat", None, None).unwrap();
    let t = tag::create(&conn, cat.id, "T", None, None).unwrap();
    let counts = stats::codebook_counts(&conn).unwrap();
    assert_eq!(counts.by_cluster.get(&cl.id).copied().unwrap_or(0), 0);
    assert_eq!(counts.by_category.get(&cat.id).copied().unwrap_or(0), 0);
    assert_eq!(counts.by_tag.get(&t.id).copied().unwrap_or(0), 0);
}

#[test]
fn stats_after_tagging_one_span() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, cl.id, "Cat", None, None).unwrap();
    let t = tag::create(&conn, cat.id, "T", None, None).unwrap();
    conn.execute("INSERT INTO interview (name, transcript_status, created_at, updated_at) VALUES ('I', 'none', 'now', 'now')", []).unwrap();
    let iid = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO speaker (interview_id, label_raw) VALUES (?1, 'A')",
        rusqlite::params![iid],
    )
    .unwrap();
    let sid = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO segment (interview_id, speaker_id, start_sec, end_sec, text, order_index) VALUES (?1, ?2, 0.0, 1.0, 'x', 0)",
        rusqlite::params![iid, sid],
    )
    .unwrap();
    let seg = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO tagged_span (interview_id, segment_id, start_offset, end_offset, text_snapshot, audio_start_sec, audio_end_sec, created_at) VALUES (?1, ?2, 0, 1, 'x', 0.0, 1.0, 'now')",
        rusqlite::params![iid, seg],
    )
    .unwrap();
    let span = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO span_tag (span_id, tag_id, source) VALUES (?1, ?2, 'manual')",
        rusqlite::params![span, t.id],
    )
    .unwrap();
    let counts = stats::codebook_counts(&conn).unwrap();
    assert_eq!(counts.by_cluster[&cl.id], 1);
    assert_eq!(counts.by_category[&cat.id], 1);
    assert_eq!(counts.by_tag[&t.id], 1);
}

#[test]
fn codebook_tree_empty() {
    let conn = fresh_conn();
    let tree = stt_app_lib::commands::codebook::build_tree(&conn).unwrap();
    assert!(tree.clusters.is_empty());
}

#[test]
fn codebook_tree_full_hierarchy() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, cl.id, "Cat", None, None).unwrap();
    tag::create(&conn, cat.id, "T1", None, None).unwrap();
    tag::create(&conn, cat.id, "T2", None, None).unwrap();
    let tree = stt_app_lib::commands::codebook::build_tree(&conn).unwrap();
    assert_eq!(tree.clusters.len(), 1);
    assert_eq!(tree.clusters[0].categories.len(), 1);
    assert_eq!(tree.clusters[0].categories[0].tags.len(), 2);
}

#[test]
fn stats_two_tags_same_category() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, cl.id, "Cat", None, None).unwrap();
    let t1 = tag::create(&conn, cat.id, "T1", None, None).unwrap();
    let t2 = tag::create(&conn, cat.id, "T2", None, None).unwrap();
    fn insert_tagged_span(conn: &rusqlite::Connection, tag_id: i64) {
        conn.execute("INSERT INTO interview (name, transcript_status, created_at, updated_at) VALUES ('I', 'none', 'now', 'now')", []).unwrap();
        let iid = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO speaker (interview_id, label_raw) VALUES (?1, 'A')",
            rusqlite::params![iid],
        )
        .unwrap();
        let sid = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO segment (interview_id, speaker_id, start_sec, end_sec, text, order_index) VALUES (?1, ?2, 0.0, 1.0, 'x', 0)",
            rusqlite::params![iid, sid],
        )
        .unwrap();
        let seg = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO tagged_span (interview_id, segment_id, start_offset, end_offset, text_snapshot, audio_start_sec, audio_end_sec, created_at) VALUES (?1, ?2, 0, 1, 'x', 0.0, 1.0, 'now')",
            rusqlite::params![iid, seg],
        )
        .unwrap();
        let span = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO span_tag (span_id, tag_id, source) VALUES (?1, ?2, 'manual')",
            rusqlite::params![span, tag_id],
        )
        .unwrap();
    }
    insert_tagged_span(&conn, t1.id);
    insert_tagged_span(&conn, t2.id);
    let counts = stats::codebook_counts(&conn).unwrap();
    assert_eq!(counts.by_cluster[&cl.id], 2);
    assert_eq!(counts.by_category[&cat.id], 2);
    assert_eq!(counts.by_tag[&t1.id], 1);
    assert_eq!(counts.by_tag[&t2.id], 1);
}
