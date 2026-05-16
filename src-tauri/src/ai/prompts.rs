use std::collections::HashMap;

pub const DEFAULT_CODEBOOK_GEN: &str = "You are helping a qualitative researcher derive and refine a codebook.\nRead the following interview(s) and propose a flat list of tags (codes)\ninferred from the transcript. Do not group them into clusters or categories.\nEach tag should have a short definition and optional evidence quotes taken\nfrom the interview text. Return JSON matching the provided schema. Do not\ninvent codes that aren't supported by the text. If an existing codebook is\nprovided, treat it as the starting point and improve it only where the new\ninterview(s) justify it. Do not recreate existing tags, do not propose near-duplicates or semantically equivalent tags with different wording, and prefer\nreusing or broadening an existing tag over adding a redundant new one. Only\npropose genuinely new tags when they add distinct analytical value beyond the\nexisting codebook.\n\nTranscripts:\n{{transcripts}}\n\nExisting codebook:\n{{existing_codebook}}";

pub const DEFAULT_PRETAG: &str = "Given this interview transcript and codebook,\nidentify spans of text that should be supplemented with existing codes from the\ncodebook. Only propose tags that are supported by the literal text. Use only\nexisting tags from the provided codebook; do not invent or rename tags, and do\nnot suggest new ones. Be conservative. Avoid unnecessary duplication: do not\nrepeat an existing tagged span, do not propose the same tag twice for the same\npassage, and do not create overlapping near-duplicate suggestions when one\nclear suggestion is enough. If no existing code clearly applies to a passage,\ndo not propose anything for it. For each span, return the segment id,\ncharacter offsets within that segment, and the tag(s) you propose.\n\nTranscript:\n{{transcript}}\n\nAll available tags (name: description):\n{{available_tags}}\n\nCodebook:\n{{codebook}}\n\nAlready tagged spans in this interview:\n{{existing_tagged_spans}}";

pub const DEFAULT_FIND_MORE: &str = "The researcher has tagged the following\npassages with the code \"{{tag_name}}\" (definition: \"{{tag_description}}\").\nFind other passages in the transcript below that fit the same code. Be\nconservative — only propose spans that genuinely match. Return spans as\nsegment_id + character offsets + a brief rationale.\n\nExample passages:\n{{example_spans}}\n\nTranscript:\n{{transcript}}";

pub fn render(template: &str, vars: &HashMap<&str, String>) -> String {
    let mut out = template.to_string();
    for (key, value) in vars {
        let placeholder = format!("{{{{{key}}}}}");
        out = out.replace(&placeholder, value);
    }
    out
}
