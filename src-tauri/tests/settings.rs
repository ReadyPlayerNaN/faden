use stt_app_lib::settings::{GlobalSettings, SettingsStore};
use tempfile::tempdir;

#[test]
fn default_settings_have_empty_api_key_and_recents() {
    let s = GlobalSettings::default();
    assert_eq!(s.gemini_api_key, "");
    assert!(s.recent_projects.is_empty());
}

#[test]
fn save_and_load_round_trip() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new(dir.path().to_path_buf());
    let mut s = GlobalSettings::default();
    s.gemini_api_key = "k-123".into();
    s.recent_projects = vec!["/a".into(), "/b".into()];
    store.save(&s).unwrap();
    let loaded = store.load().unwrap();
    assert_eq!(loaded.gemini_api_key, "k-123");
    assert_eq!(loaded.recent_projects, vec!["/a".to_string(), "/b".into()]);
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
    s.add_recent("/a".into());
    s.add_recent("/b".into());
    s.add_recent("/a".into()); // bumps to top
    assert_eq!(s.recent_projects, vec!["/a".to_string(), "/b".into()]);
}

#[test]
fn add_recent_caps_at_ten() {
    let mut s = GlobalSettings::default();
    for i in 0..12 {
        s.add_recent(format!("/{i}"));
    }
    assert_eq!(s.recent_projects.len(), 10);
    assert_eq!(s.recent_projects[0], "/11");
}
