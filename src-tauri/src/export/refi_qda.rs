use crate::error::{AppError, AppResult};
use crate::export::ProjectExportData;
use quick_xml::{
    events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event},
    Writer,
};
use std::collections::HashMap;
use std::io::Write;
use uuid::Uuid;

fn ns_uuid(namespace: &Uuid, name: &str) -> Uuid {
    Uuid::new_v5(namespace, name.as_bytes())
}

fn xml_err(e: quick_xml::Error) -> AppError {
    AppError::Invalid(format!("xml: {e}"))
}

pub fn write_refi_qda<W: Write>(data: &ProjectExportData, writer: &mut W) -> AppResult<()> {
    let project_ns = Uuid::new_v5(
        &Uuid::NAMESPACE_DNS,
        format!("stt-qda:{}", data.project_name).as_bytes(),
    );

    let mut w = Writer::new_with_indent(writer, b' ', 2);
    w.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
        .map_err(xml_err)?;

    let mut proj = BytesStart::new("Project");
    proj.push_attribute(("name", data.project_name.as_str()));
    proj.push_attribute(("origin", "STT-QDA"));
    w.write_event(Event::Start(proj)).map_err(xml_err)?;

    // Users
    w.write_event(Event::Start(BytesStart::new("Users")))
        .map_err(xml_err)?;
    let mut user = BytesStart::new("User");
    user.push_attribute(("guid", "00000000-0000-0000-0000-000000000001"));
    user.push_attribute(("name", "researcher"));
    w.write_event(Event::Empty(user)).map_err(xml_err)?;
    w.write_event(Event::End(BytesEnd::new("Users")))
        .map_err(xml_err)?;

    // CodeBook
    w.write_event(Event::Start(BytesStart::new("CodeBook")))
        .map_err(xml_err)?;
    w.write_event(Event::Start(BytesStart::new("Codes")))
        .map_err(xml_err)?;
    let mut tag_guids: HashMap<i64, String> = HashMap::new();
    for cl in &data.clusters {
        let cl_id = ns_uuid(&project_ns, &format!("cluster:{}", cl.name));
        let cl_id_str = cl_id.to_string();
        let mut e = BytesStart::new("Code");
        e.push_attribute(("guid", cl_id_str.as_str()));
        e.push_attribute(("name", cl.name.as_str()));
        w.write_event(Event::Start(e)).map_err(xml_err)?;
        for cat in data.categories.iter().filter(|c| c.cluster_id == cl.id) {
            let cat_id = ns_uuid(&project_ns, &format!("category:{}", cat.name));
            let cat_id_str = cat_id.to_string();
            let mut ec = BytesStart::new("Code");
            ec.push_attribute(("guid", cat_id_str.as_str()));
            ec.push_attribute(("name", cat.name.as_str()));
            w.write_event(Event::Start(ec)).map_err(xml_err)?;
            for t in data.tags.iter().filter(|t| t.category_id == cat.id) {
                let t_id = ns_uuid(&project_ns, &format!("tag:{}", t.name));
                let t_id_str = t_id.to_string();
                tag_guids.insert(t.id, t_id_str.clone());
                let mut et = BytesStart::new("Code");
                et.push_attribute(("guid", t_id_str.as_str()));
                et.push_attribute(("name", t.name.as_str()));
                w.write_event(Event::Empty(et)).map_err(xml_err)?;
            }
            w.write_event(Event::End(BytesEnd::new("Code")))
                .map_err(xml_err)?;
        }
        w.write_event(Event::End(BytesEnd::new("Code")))
            .map_err(xml_err)?;
    }
    w.write_event(Event::End(BytesEnd::new("Codes")))
        .map_err(xml_err)?;
    w.write_event(Event::End(BytesEnd::new("CodeBook")))
        .map_err(xml_err)?;

    // Sources
    w.write_event(Event::Start(BytesStart::new("Sources")))
        .map_err(xml_err)?;
    for iv in &data.interviews {
        let src_id = ns_uuid(&project_ns, &format!("interview:{}", iv.interview.name));
        let src_id_str = src_id.to_string();
        let mut src = BytesStart::new("TextSource");
        src.push_attribute(("guid", src_id_str.as_str()));
        src.push_attribute(("name", iv.interview.name.as_str()));
        w.write_event(Event::Start(src)).map_err(xml_err)?;

        // PlainTextContent: concatenated transcript
        let full_text: String = iv
            .segments
            .iter()
            .map(|s| s.text.clone())
            .collect::<Vec<_>>()
            .join("\n");
        w.write_event(Event::Start(BytesStart::new("PlainTextContent")))
            .map_err(xml_err)?;
        w.write_event(Event::Text(BytesText::new(&full_text)))
            .map_err(xml_err)?;
        w.write_event(Event::End(BytesEnd::new("PlainTextContent")))
            .map_err(xml_err)?;

        // Compute global char offsets per segment id
        let mut seg_offsets: HashMap<i64, i32> = HashMap::new();
        let mut cum = 0_i32;
        for seg in &iv.segments {
            seg_offsets.insert(seg.id, cum);
            cum += seg.text.chars().count() as i32 + 1; // +1 for newline
        }
        for span in &iv.spans {
            let base = seg_offsets
                .get(&span.span.segment_id)
                .copied()
                .unwrap_or(0);
            let g_start = base + span.span.start_offset;
            let g_end = base + span.span.end_offset;
            let sel_guid =
                ns_uuid(&project_ns, &format!("span:{}", span.span.id)).to_string();
            let g_start_str = g_start.to_string();
            let g_end_str = g_end.to_string();
            let mut sel = BytesStart::new("PlainTextSelection");
            sel.push_attribute(("guid", sel_guid.as_str()));
            sel.push_attribute(("startPosition", g_start_str.as_str()));
            sel.push_attribute(("endPosition", g_end_str.as_str()));
            w.write_event(Event::Start(sel)).map_err(xml_err)?;
            for tag_id in &span.tags {
                if let Some(g) = tag_guids.get(tag_id) {
                    let coding_guid = ns_uuid(
                        &project_ns,
                        &format!("coding:{}:{}", span.span.id, tag_id),
                    )
                    .to_string();
                    let mut c = BytesStart::new("Coding");
                    c.push_attribute(("guid", coding_guid.as_str()));
                    let mut cref = BytesStart::new("CodeRef");
                    cref.push_attribute(("targetGUID", g.as_str()));
                    w.write_event(Event::Start(c)).map_err(xml_err)?;
                    w.write_event(Event::Empty(cref)).map_err(xml_err)?;
                    w.write_event(Event::End(BytesEnd::new("Coding")))
                        .map_err(xml_err)?;
                }
            }
            w.write_event(Event::End(BytesEnd::new("PlainTextSelection")))
                .map_err(xml_err)?;
        }

        // Reference to audio if present
        if let Some(audio_rel) = &iv.interview.audio_path {
            let audio_guid =
                ns_uuid(&project_ns, &format!("audio:{}", iv.interview.name)).to_string();
            let mut au = BytesStart::new("AudioSource");
            au.push_attribute(("guid", audio_guid.as_str()));
            au.push_attribute(("path", audio_rel.as_str()));
            w.write_event(Event::Empty(au)).map_err(xml_err)?;
        }
        w.write_event(Event::End(BytesEnd::new("TextSource")))
            .map_err(xml_err)?;
    }
    w.write_event(Event::End(BytesEnd::new("Sources")))
        .map_err(xml_err)?;

    w.write_event(Event::End(BytesEnd::new("Project")))
        .map_err(xml_err)?;
    Ok(())
}
