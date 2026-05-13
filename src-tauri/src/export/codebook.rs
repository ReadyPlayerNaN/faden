use crate::error::AppResult;
use crate::export::ProjectExportData;
use serde_json::json;
use std::io::Write;

pub fn write_codebook_json<W: Write>(
    data: &ProjectExportData,
    writer: &mut W,
) -> AppResult<()> {
    let mut clusters = Vec::new();
    for cl in &data.clusters {
        let cats: Vec<_> = data
            .categories
            .iter()
            .filter(|c| c.cluster_id == cl.id)
            .map(|cat| {
                let tags: Vec<_> = data
                    .tags
                    .iter()
                    .filter(|t| t.category_id == cat.id)
                    .map(|t| {
                        json!({
                            "name": t.name,
                            "description": t.description,
                            "color": t.color,
                        })
                    })
                    .collect();
                json!({
                    "name": cat.name,
                    "description": cat.description,
                    "color": cat.color,
                    "tags": tags,
                })
            })
            .collect();
        clusters.push(json!({
            "name": cl.name,
            "description": cl.description,
            "color": cl.color,
            "categories": cats,
        }));
    }
    let out = json!({ "clusters": clusters });
    writer.write_all(serde_json::to_string_pretty(&out)?.as_bytes())?;
    Ok(())
}

pub fn write_codebook_csv<W: Write>(data: &ProjectExportData, writer: &mut W) -> AppResult<()> {
    let mut w = csv::Writer::from_writer(writer);
    w.write_record(["cluster", "category", "tag", "description"])?;
    for cl in &data.clusters {
        for cat in data.categories.iter().filter(|c| c.cluster_id == cl.id) {
            for t in data.tags.iter().filter(|t| t.category_id == cat.id) {
                w.write_record([
                    cl.name.as_str(),
                    cat.name.as_str(),
                    t.name.as_str(),
                    t.description.as_deref().unwrap_or(""),
                ])?;
            }
        }
    }
    w.flush()?;
    Ok(())
}
