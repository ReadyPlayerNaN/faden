use faden_app_lib::settings::{GlobalSettings, RecentProject, SettingsStore};
use tempfile::tempdir;

#[test]
fn default_settings_have_empty_api_key_and_recents() {
    let s = GlobalSettings::default();
    assert_eq!(s.gemini_api_key, "");
    assert!(s.recent_projects.is_empty());
    assert!(!s.default_transcription_model.is_empty());
    assert!(!s.default_ai_model.is_empty());
}

#[test]
fn save_and_load_round_trip_keeps_non_secret_settings_only() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new(dir.path().to_path_buf());
    let mut s = GlobalSettings {
        gemini_api_key: "k-123".into(),
        ..GlobalSettings::default()
    };
    s.add_recent("/a".into(), None);
    s.add_recent("/b".into(), None);
    store.save(&s).unwrap();
    let loaded = store.load().unwrap();
    assert_eq!(loaded.gemini_api_key, "");
    assert_eq!(
        loaded
            .recent_projects
            .iter()
            .map(|r| r.path.clone())
            .collect::<Vec<_>>(),
        vec!["/b".to_string(), "/a".into()]
    );
}

#[test]
fn saved_settings_file_does_not_contain_api_key() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new(dir.path().to_path_buf());
    let s = GlobalSettings {
        gemini_api_key: "k-123".into(),
        ..GlobalSettings::default()
    };
    store.save(&s).unwrap();
    let raw = std::fs::read_to_string(dir.path().join("settings.json")).unwrap();
    assert!(!raw.contains("gemini_api_key"));
    assert!(!raw.contains("k-123"));
}

#[test]
fn load_missing_returns_default() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new(dir.path().to_path_buf());
    let s = store.load().unwrap();
    assert_eq!(s.gemini_api_key, "");
}

#[test]
fn add_recent_dedupes_and_prepends() {
    let mut s = GlobalSettings::default();
    s.add_recent("/a".into(), None);
    s.add_recent("/b".into(), None);
    s.add_recent("/a".into(), None);
    let paths: Vec<String> = s.recent_projects.iter().map(|r| r.path.clone()).collect();
    assert_eq!(paths, vec!["/a".to_string(), "/b".into()]);
}

#[test]
fn add_recent_caps_at_ten() {
    let mut s = GlobalSettings::default();
    for i in 0..12 {
        s.add_recent(format!("/{i}"), None);
    }
    assert_eq!(s.recent_projects.len(), 10);
    assert_eq!(s.recent_projects[0].path, "/11");
}

#[test]
fn add_recent_derives_display_name_from_filename() {
    let mut s = GlobalSettings::default();
    s.add_recent("/tmp/research/Project A".into(), None);
    assert_eq!(s.recent_projects[0].display_name, "Project A");
    assert_eq!(s.recent_projects[0].path, "/tmp/research/Project A");
}

#[test]
fn add_recent_uses_explicit_display_name_when_provided() {
    let mut s = GlobalSettings::default();
    s.add_recent("/tmp/research/project-a".into(), Some("Project A".into()));
    assert_eq!(s.recent_projects[0].display_name, "Project A");
}

#[test]
fn legacy_plaintext_key_is_detected_but_not_loaded_into_settings_file_model() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(
        &path,
        r#"{"gemini_api_key":"k","recent_projects":["/foo/bar","/baz"]}"#,
    )
    .unwrap();
    let store = SettingsStore::new(dir.path().to_path_buf());
    let s = store.load().unwrap();
    assert_eq!(store.legacy_gemini_api_key().unwrap().as_deref(), Some("k"));
    assert_eq!(s.gemini_api_key, "");
    assert_eq!(s.recent_projects.len(), 2);
    assert_eq!(s.recent_projects[0].path, "/foo/bar");
    assert_eq!(s.recent_projects[0].display_name, "bar");
    assert_eq!(s.recent_projects[1].display_name, "baz");
}

#[test]
fn struct_recents_round_trip() {
    let r = RecentProject {
        path: "/x/y".into(),
        display_name: "Renamed".into(),
    };
    let s = GlobalSettings {
        recent_projects: vec![r.clone()],
        ..GlobalSettings::default()
    };
    let dir = tempdir().unwrap();
    let store = SettingsStore::new(dir.path().to_path_buf());
    store.save(&s).unwrap();
    let loaded = store.load().unwrap();
    assert_eq!(loaded.recent_projects, vec![r]);
}
