use faden_app_lib::transcription::cache::*;
use faden_app_lib::transcription::schema::ParsedSegment;
use tempfile::tempdir;

fn s(speaker: &str, start: f64, end: f64, text: &str) -> ParsedSegment {
    ParsedSegment {
        speaker: speaker.into(),
        start,
        end,
        text: text.into(),
    }
}

#[test]
fn save_and_load_round_trip() {
    let dir = tempdir().unwrap();
    let cache = ChunkCache::new(dir.path().to_path_buf());
    cache.save(0, &[s("A", 0.0, 5.0, "hi")]).unwrap();
    let loaded = cache.load(0).unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].text, "hi");
}

#[test]
fn exists_reports_correctly() {
    let dir = tempdir().unwrap();
    let cache = ChunkCache::new(dir.path().to_path_buf());
    assert!(!cache.exists(0));
    cache.save(0, &[]).unwrap();
    assert!(cache.exists(0));
}

#[test]
fn load_all_merges_in_chunk_order() {
    let dir = tempdir().unwrap();
    let cache = ChunkCache::new(dir.path().to_path_buf());
    cache.save(0, &[s("A", 0.0, 1.0, "first")]).unwrap();
    cache.save(2, &[s("A", 4.0, 5.0, "third")]).unwrap();
    cache.save(1, &[s("A", 2.0, 3.0, "second")]).unwrap();
    let all = cache.load_all().unwrap();
    assert_eq!(all.len(), 3);
    assert_eq!(all[0].text, "first");
    assert_eq!(all[1].text, "second");
    assert_eq!(all[2].text, "third");
}

#[test]
fn load_all_empty_when_no_dir() {
    let dir = tempdir().unwrap();
    let cache = ChunkCache::new(dir.path().join("does-not-exist"));
    let all = cache.load_all().unwrap();
    assert!(all.is_empty());
}
