use faden_app_lib::import::plain_text::*;

#[test]
fn single_speaker() {
    let p = parse("A: Hello there").unwrap();
    assert_eq!(p.speakers.len(), 1);
    assert_eq!(p.segments.len(), 1);
    assert_eq!(p.segments[0].text, "Hello there");
}

#[test]
fn two_speaker_conversation() {
    let p = parse("A: hi\nB: hello\nA: how are you").unwrap();
    assert_eq!(p.speakers.len(), 2);
    assert_eq!(p.segments.len(), 3);
}

#[test]
fn multi_line_continuation() {
    let p = parse("A: first line\nsecond line").unwrap();
    assert_eq!(p.segments.len(), 1);
    assert_eq!(p.segments[0].text, "first line second line");
}

#[test]
fn no_speaker_labels() {
    let p = parse("just some text\nno labels").unwrap();
    assert_eq!(p.speakers.len(), 1);
    assert_eq!(p.speakers[0].label_raw, "Speaker");
}

#[test]
fn empty_input() {
    let p = parse("").unwrap();
    assert!(p.speakers.is_empty());
    assert!(p.segments.is_empty());
}
