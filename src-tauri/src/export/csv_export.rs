use crate::error::AppResult;
use crate::export::ProjectExportData;
use std::collections::HashMap;
use std::io::Write;

pub fn write_csv<W: Write>(data: &ProjectExportData, writer: &mut W) -> AppResult<()> {
    let mut w = csv::Writer::from_writer(writer);
    w.write_record([
        "interview_name",
        "speaker_label",
        "speaker_display_name",
        "segment_start_sec",
        "segment_end_sec",
        "span_start_sec",
        "span_end_sec",
        "cluster_name",
        "category_name",
        "tag_name",
        "quote",
        "memo",
    ])?;

    // Index tags -> (cluster name, category name, tag name)
    let tag_lookup: HashMap<i64, (&str, &str, &str)> = data
        .tags
        .iter()
        .map(|t| {
            let (cl_name, cat_name) = match t.category_id {
                Some(cid) => {
                    let cat = data.categories.iter().find(|c| c.id == cid);
                    let cl = cat.and_then(|c| {
                        c.cluster_id.and_then(|cluster_id| {
                            data.clusters.iter().find(|cl| cl.id == cluster_id)
                        })
                    });
                    (
                        cl.map(|c| c.name.as_str()).unwrap_or(""),
                        cat.map(|c| c.name.as_str()).unwrap_or(""),
                    )
                }
                None => ("", ""),
            };
            (t.id, (cl_name, cat_name, t.name.as_str()))
        })
        .collect();

    for iv in &data.interviews {
        for span in &iv.spans {
            let seg = iv.segments.iter().find(|s| s.id == span.span.segment_id);
            let speaker = seg.and_then(|s| s.speaker_id.and_then(|id| iv.speakers.get(&id)));
            for tag_id in &span.tags {
                let (cl, cat, tg) = tag_lookup.get(tag_id).copied().unwrap_or(("", "", ""));
                let seg_start = seg
                    .map(|s| format!("{:.3}", s.start_sec))
                    .unwrap_or_default();
                let seg_end = seg.map(|s| format!("{:.3}", s.end_sec)).unwrap_or_default();
                let span_start = format!("{:.3}", span.span.audio_start_sec);
                let span_end = format!("{:.3}", span.span.audio_end_sec);
                w.write_record([
                    iv.interview.name.as_str(),
                    speaker.map(|s| s.label_raw.as_str()).unwrap_or(""),
                    speaker
                        .and_then(|s| s.effective_display_name())
                        .unwrap_or(""),
                    seg_start.as_str(),
                    seg_end.as_str(),
                    span_start.as_str(),
                    span_end.as_str(),
                    cl,
                    cat,
                    tg,
                    span.span.text_snapshot.as_str(),
                    span.memo.as_ref().map(|m| m.body.as_str()).unwrap_or(""),
                ])?;
            }
        }
    }
    w.flush()?;
    Ok(())
}
