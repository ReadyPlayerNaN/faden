use std::collections::HashMap;

pub const DEFAULT_CODEBOOK_GEN: &str = "You are helping a qualitative researcher build a codebook.\nRead the following interview(s) and propose a three-level coding scheme:\nclusters (broad themes), categories (sub-themes within a cluster), and tags\n(specific codes within a category). Each tag should have a short definition.\nReturn JSON matching the provided schema. Do not invent codes that aren't\nsupported by the text. If an existing codebook is provided, prefer extending\nit over duplicating existing codes.\n\nTranscripts:\n{{transcripts}}\n\nExisting codebook:\n{{existing_codebook}}";

pub const DEFAULT_PRETAG: &str = "Given this interview transcript and codebook,\nidentify spans of text that should be tagged with codes from the codebook.\nOnly propose tags that are supported by the literal text. For each span,\nreturn the segment id, character offsets within that segment, and the tag(s)\nyou propose. Do not invent new tags. If no codes apply to a passage, do not\npropose anything for it.\n\nTranscript:\n{{transcript}}\n\nCodebook:\n{{codebook}}";

pub const DEFAULT_FIND_MORE: &str = "The researcher has tagged the following\npassages with the code \"{{tag_name}}\" (definition: \"{{tag_description}}\").\nFind other passages in the transcript below that fit the same code. Be\nconservative — only propose spans that genuinely match. Return spans as\nsegment_id + character offsets + a brief rationale.\n\nExample passages:\n{{example_spans}}\n\nTranscript:\n{{transcript}}";

pub fn render(template: &str, vars: &HashMap<&str, String>) -> String {
    let mut out = template.to_string();
    for (key, value) in vars {
        let placeholder = format!("{{{{{key}}}}}");
        out = out.replace(&placeholder, value);
    }
    out
}
