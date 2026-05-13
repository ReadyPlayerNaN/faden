use std::collections::HashMap;
use stt_app_lib::ai::prompts;

#[test]
fn replaces_simple_placeholder() {
    let mut vars = HashMap::new();
    vars.insert("name", "World".to_string());
    assert_eq!(prompts::render("Hello {{name}}!", &vars), "Hello World!");
}

#[test]
fn leaves_unknown_placeholders_intact() {
    let vars = HashMap::new();
    assert_eq!(
        prompts::render("Hello {{name}}!", &vars),
        "Hello {{name}}!"
    );
}

#[test]
fn replaces_multiple_occurrences() {
    let mut vars = HashMap::new();
    vars.insert("x", "X".to_string());
    assert_eq!(prompts::render("{{x}}-{{x}}-{{x}}", &vars), "X-X-X");
}
