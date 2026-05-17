use crate::settings::{canonical_project_language, project_language_name};
use std::collections::HashMap;

pub const DEFAULT_CODEBOOK_GEN: &str = "You are helping a qualitative researcher derive and refine a codebook.\nRead the following interview(s) and propose a flat list of tags (codes)\ninferred from the transcript. Do not group them into clusters or categories.\nEach tag should have a short definition and optional evidence quotes taken\nfrom the interview text. Return JSON matching the provided schema. Do not\ninvent codes that aren't supported by the text. If an existing codebook is\nprovided, treat it as the starting point and improve it only where the new\ninterview(s) justify it. Do not recreate existing tags, do not propose near-duplicates or semantically equivalent tags with different wording, and prefer\nreusing or broadening an existing tag over adding a redundant new one. Only\npropose genuinely new tags when they add distinct analytical value beyond the\nexisting codebook.\n\nTranscripts:\n{{transcripts}}\n\nExisting codebook:\n{{existing_codebook}}";

pub const DEFAULT_PRETAG: &str = "Given this interview transcript and codebook,\nidentify spans of text that should be supplemented with existing codes from the\ncodebook. Only propose tags that are supported by the literal text. Use only\nexisting tags from the provided codebook; do not invent or rename tags, and do\nnot suggest new ones. Be conservative. Avoid unnecessary duplication: do not\nrepeat an existing tagged span, do not propose the same tag twice for the same\npassage, and do not create overlapping near-duplicate suggestions when one\nclear suggestion is enough. If no existing code clearly applies to a passage,\ndo not propose anything for it. For each span, return the segment id,\ncharacter offsets within that segment, and the tag(s) you propose.\n\nTranscript:\n{{transcript}}\n\nAll available tags (name: description):\n{{available_tags}}\n\nCodebook:\n{{codebook}}\n\nAlready tagged spans in this interview:\n{{existing_tagged_spans}}";

pub const DEFAULT_FIND_MORE: &str = "The researcher has tagged the following\npassages with the code \"{{tag_name}}\" (definition: \"{{tag_description}}\").\nFind other passages in the transcript below that fit the same code. Be\nconservative — only propose spans that genuinely match. Return spans as\nsegment_id + character offsets + a brief rationale.\n\nExample passages:\n{{example_spans}}\n\nTranscript:\n{{transcript}}";

pub const DEFAULT_CATEGORIZE: &str = "You are helping a qualitative researcher organize an existing codebook.\nRead the existing tags below and suggest how they should be grouped into\ncategories. Prioritize analytic coherence, shared meaning, and interpretive\nusefulness over surface word similarity. Focus on the best analytic fit, not\njust shared wording. Reuse an existing category whenever the fit is genuinely\nstrong by copying its exact existing_category_id from the provided context.\nOnly suggest a new category when the evidence shows that existing categories do\nnot fit well enough. Avoid generic catch-all labels such as 'miscellaneous',\n'general issues', or other weak umbrella groups unless the evidence clearly\nsupports them. It is better to leave a tag unassigned than to force-fit it\ninto a weak category. Do not invent new tags. Assign each tag to at most one\nsuggested category, and omit tags that do not have a strong home. Rationales\nmust be evidence-based: cite the tag definition, existing parent context,\nusage counts, and example quotes when relevant. Return JSON matching the\nprovided schema.\n\nCurrent codebook:\n{{codebook}}\n\nExisting tags and reusable categories:\n{{tags}}";

pub const DEFAULT_CLUSTER: &str = "You are helping a qualitative researcher organize an existing codebook.\nRead the existing categories below and suggest how they should be grouped into\nclusters. Prioritize analytic coherence, conceptual relatedness, and the role\nthese categories play in the analysis over surface word similarity. Focus on\nthe best analytic fit, not just shared wording. Reuse an existing cluster\nwhenever the fit is genuinely strong by copying its exact existing_cluster_id\nfrom the provided context. Only suggest a new cluster when the evidence shows\nthat existing clusters do not fit well enough. Avoid generic catch-all cluster\nlabels or weak umbrella themes unless the evidence clearly supports them. It is\nbetter to leave a category unassigned than to force-fit it into a weak\ncluster. Do not invent new categories. Assign each category to at most one\nsuggested cluster, and omit categories that do not have a strong home.\nRationales must be evidence-based: cite the member categories, existing parent\ncontext, usage counts, and example quotes when relevant. Return JSON matching\nthe provided schema.\n\nCurrent codebook:\n{{codebook}}\n\nExisting categories and reusable clusters:\n{{categories}}";

pub fn render(template: &str, vars: &HashMap<&str, String>) -> String {
    let mut out = template.to_string();
    for (key, value) in vars {
        let placeholder = format!("{{{{{key}}}}}");
        out = out.replace(&placeholder, value);
    }
    out
}

pub fn with_project_language(prompt: &str, language: &str) -> String {
    format!(
        "Project output language requirement:\n- The interviews or transcript excerpts may be in different languages.\n- Produce all generated labels, descriptions, rationales, summaries, and other free-text output in {}.\n- Keep the required JSON schema, field names, and structure unchanged.\n- Do not translate verbatim quotations copied from the transcript unless explicitly asked to do so.\n\n{}",
        canonical_project_language(language)
            .as_deref()
            .and_then(project_language_name)
            .unwrap_or(language.trim()),
        prompt
    )
}
