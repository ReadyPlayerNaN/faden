use crate::error::AppResult;
use crate::export::ProjectExportData;
use std::collections::HashMap;
use std::io::Write;

pub fn write_stats_csv<W: Write>(data: &ProjectExportData, writer: &mut W) -> AppResult<()> {
    let tag_path: HashMap<i64, (String, String, String)> = data
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
                        cl.map(|c| c.name.clone()).unwrap_or_default(),
                        cat.map(|c| c.name.clone()).unwrap_or_default(),
                    )
                }
                None => (String::new(), String::new()),
            };
            (t.id, (cl_name, cat_name, t.name.clone()))
        })
        .collect();

    let mut w = csv::Writer::from_writer(writer);
    w.write_record([
        "section",
        "interview",
        "speaker",
        "cluster",
        "category",
        "tag",
        "count",
    ])?;

    // Code frequency (overall)
    let mut total_by_tag: HashMap<i64, i64> = HashMap::new();
    for iv in &data.interviews {
        for span in &iv.spans {
            for tag_id in &span.tags {
                *total_by_tag.entry(*tag_id).or_insert(0) += 1;
            }
        }
    }
    let mut total_keys: Vec<&i64> = total_by_tag.keys().collect();
    total_keys.sort();
    for tag_id in total_keys {
        if let Some((cl, cat, tg)) = tag_path.get(tag_id) {
            let count = total_by_tag[tag_id].to_string();
            w.write_record(["frequency", "", "", cl, cat, tg, count.as_str()])?;
        }
    }

    // By interview
    for iv in &data.interviews {
        let mut by_tag: HashMap<i64, i64> = HashMap::new();
        for span in &iv.spans {
            for tag_id in &span.tags {
                *by_tag.entry(*tag_id).or_insert(0) += 1;
            }
        }
        let mut keys: Vec<&i64> = by_tag.keys().collect();
        keys.sort();
        for tag_id in keys {
            if let Some((cl, cat, tg)) = tag_path.get(tag_id) {
                let count = by_tag[tag_id].to_string();
                w.write_record([
                    "by_interview",
                    iv.interview.name.as_str(),
                    "",
                    cl,
                    cat,
                    tg,
                    count.as_str(),
                ])?;
            }
        }
    }

    // By speaker (per interview)
    for iv in &data.interviews {
        let mut by_speaker_tag: HashMap<(Option<i64>, i64), i64> = HashMap::new();
        for span in &iv.spans {
            let seg = iv.segments.iter().find(|s| s.id == span.span.segment_id);
            if let Some(s) = seg {
                for tag_id in &span.tags {
                    *by_speaker_tag.entry((s.speaker_id, *tag_id)).or_insert(0) += 1;
                }
            }
        }
        let mut keys: Vec<&(Option<i64>, i64)> = by_speaker_tag.keys().collect();
        keys.sort();
        for (sp_id, tag_id) in keys {
            let sp_label = sp_id
                .and_then(|id| iv.speakers.get(&id).map(|x| x.label_raw.as_str()))
                .unwrap_or("?");
            if let Some((cl, cat, tg)) = tag_path.get(tag_id) {
                let count = by_speaker_tag[&(*sp_id, *tag_id)].to_string();
                w.write_record([
                    "by_speaker",
                    iv.interview.name.as_str(),
                    sp_label,
                    cl,
                    cat,
                    tg,
                    count.as_str(),
                ])?;
            }
        }
    }

    // Co-occurrence (count of span pairs with both tags)
    let mut co: HashMap<(i64, i64), i64> = HashMap::new();
    for iv in &data.interviews {
        for span in &iv.spans {
            let mut tags: Vec<i64> = span.tags.iter().copied().collect();
            tags.sort();
            for i in 0..tags.len() {
                for j in (i + 1)..tags.len() {
                    *co.entry((tags[i], tags[j])).or_insert(0) += 1;
                }
            }
        }
    }
    let mut co_keys: Vec<&(i64, i64)> = co.keys().collect();
    co_keys.sort();
    for (a, b) in co_keys {
        let a_name = tag_path.get(a).map(|(_, _, n)| n.as_str()).unwrap_or("?");
        let b_name = tag_path.get(b).map(|(_, _, n)| n.as_str()).unwrap_or("?");
        let label = format!("{a_name}∧{b_name}");
        let count = co[&(*a, *b)].to_string();
        w.write_record([
            "co_occurrence",
            "",
            "",
            "",
            "",
            label.as_str(),
            count.as_str(),
        ])?;
    }

    w.flush()?;
    Ok(())
}

pub fn write_stats_markdown<W: Write>(data: &ProjectExportData, writer: &mut W) -> AppResult<()> {
    writeln!(writer, "# Stats: {}", data.project_name)?;
    writeln!(writer)?;
    writeln!(writer, "## Code frequency\n")?;
    writeln!(writer, "| Cluster | Category | Tag | Count |")?;
    writeln!(writer, "|---|---|---|---|")?;
    let mut counts: HashMap<i64, i64> = HashMap::new();
    for iv in &data.interviews {
        for span in &iv.spans {
            for tag_id in &span.tags {
                *counts.entry(*tag_id).or_insert(0) += 1;
            }
        }
    }
    for t in &data.tags {
        let cat = t
            .category_id
            .and_then(|cid| data.categories.iter().find(|c| c.id == cid));
        let cl = cat.and_then(|c| {
            c.cluster_id
                .and_then(|cluster_id| data.clusters.iter().find(|cl| cl.id == cluster_id))
        });
        let count = counts.get(&t.id).copied().unwrap_or(0);
        writeln!(
            writer,
            "| {} | {} | {} | {} |",
            cl.map(|c| c.name.as_str()).unwrap_or(""),
            cat.map(|c| c.name.as_str()).unwrap_or(""),
            t.name,
            count
        )?;
    }
    Ok(())
}
