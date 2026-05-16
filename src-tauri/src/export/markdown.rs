use crate::error::AppResult;
use crate::export::{ProjectExportData, SpanWithTags};
use std::collections::HashMap;
use std::io::Write;

fn format_seconds(s: f64) -> String {
    let total = s as i64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let sec = total % 60;
    if h > 0 {
        format!("{:02}:{:02}:{:02}", h, m, sec)
    } else {
        format!("{:02}:{:02}", m, sec)
    }
}

pub fn write_markdown<W: Write>(data: &ProjectExportData, writer: &mut W) -> AppResult<()> {
    writeln!(writer, "# Project: {}", data.project_name)?;
    writeln!(writer)?;

    let tag_lookup: HashMap<i64, String> =
        data.tags.iter().map(|t| (t.id, t.name.clone())).collect();

    for iv in &data.interviews {
        writeln!(writer, "## Interview: {}", iv.interview.name)?;
        writeln!(writer)?;

        // Speakers list
        let mut speaker_list: Vec<_> = iv.speakers.values().collect();
        speaker_list.sort_by_key(|s| s.id);
        let mut s_strs = Vec::new();
        for sp in &speaker_list {
            let name = sp.display_name.as_deref().unwrap_or("?");
            s_strs.push(format!("{} = {}", sp.label_raw, name));
        }
        writeln!(writer, "**Speakers:** {}", s_strs.join(", "))?;
        writeln!(writer)?;

        // Group spans by segment_id for inline annotation
        let mut spans_by_seg: HashMap<i64, Vec<&SpanWithTags>> = HashMap::new();
        for s in &iv.spans {
            spans_by_seg.entry(s.span.segment_id).or_default().push(s);
        }
        for seg in &iv.segments {
            let speaker = iv.speakers.get(&seg.speaker_id);
            let speaker_label = speaker.map(|s| s.label_raw.as_str()).unwrap_or("?");
            let timestamp = format_seconds(seg.start_sec);
            writeln!(
                writer,
                "[{}] **{}:** {}",
                timestamp, speaker_label, seg.text
            )?;
            if let Some(spans) = spans_by_seg.get(&seg.id) {
                for span in spans {
                    let tag_names: Vec<&str> = span
                        .tags
                        .iter()
                        .filter_map(|t| tag_lookup.get(t).map(String::as_str))
                        .collect();
                    writeln!(writer, "<!-- tagged: {} -->", tag_names.join(", "))?;
                    if let Some(m) = &span.memo {
                        writeln!(writer, "> {}", m.body)?;
                    }
                }
            }
            writeln!(writer)?;
        }
        writeln!(writer)?;
    }
    Ok(())
}
