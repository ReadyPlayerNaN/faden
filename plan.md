# Pretag improvement implementation plan

## Goal
Improve pretag suggestion quality so that:
- interviewer turns remain available as context but are never tag targets
- overlapping same-tag suggestions become extension proposals instead of trashy duplicate spans
- suggested ranges align to meaningful textual units (word + clause/subsentence boundaries)
- the UI clearly distinguishes new-span suggestions from extension suggestions

---

## 1. Backend: preserve interviewer context, forbid interviewer targets

### Desired behavior
- Keep interviewer segments in the transcript sent to the model.
- Explicitly mark which segments belong to interviewer speakers.
- Instruct the model that interviewer segments are context only and must not be tagged.
- Enforce this again after model output.

### Implementation steps
1. Update transcript formatting for pretag requests so speaker role is visible.
   - Include whether a segment belongs to interviewer vs participant.
   - Keep current `segment_id` addressing.
2. Update the pretag system instruction.
   - State that interviewer segments provide context.
   - State that suggestions must target only non-interviewer segments.
3. Add backend validation in pretag finalization.
   - Load target segment speaker.
   - Reject any suggestion that points to an interviewer segment.
4. Add tests.
   - Model suggests a tag on interviewer segment -> filtered out.
   - Model sees interviewer question plus participant answer -> participant suggestion still accepted.

---

## 2. Backend: normalize spans to useful textual boundaries

### Desired behavior
Normalize model offsets in two phases:
1. snap to word boundaries
2. expand to the smallest meaningful subsentence/clause-sized unit

### Implementation steps
1. Keep current word-boundary snapping as base normalization.
2. Add clause/subsentence boundary detection.
   - Use punctuation and conjunction heuristics conservatively.
   - Treat commas, semicolons, dashes, sentence-ending punctuation, and similar separators as possible clause boundaries.
   - Do not force full-sentence expansion when only one clause is relevant.
3. Expand normalized spans outward to nearest acceptable clause/subsentence boundaries.
   - Avoid mid-word and awkward mid-clause starts/ends.
   - Preserve short valid spans when they already form a complete unit.
4. Ensure normalization happens before duplicate/overlap analysis.
5. Add tests.
   - phrase-level suggestion expands to a clause-sized unit
   - already-good span stays stable
   - multilingual/Czech punctuation examples

---

## 3. Backend: convert overlapping same-tag suggestions into extension proposals

### Desired behavior
When a suggestion overlaps an existing tagged span with the same tag:
- if it adds no useful coverage -> ignore it as duplicate/no-op
- if it expands the covered text left and/or right -> convert it into an extension proposal
- do not create a second overlapping tagged span for the same tag

### Implementation steps
1. Extend overlap analysis.
   - Compare normalized suggestion against existing tagged spans in same segment.
   - Evaluate overlap per tag, not just per span.
2. Introduce extension classification.
   - Cases:
     - exact duplicate
     - contained duplicate
     - left extension
     - right extension
     - bidirectional extension
3. Add backend proposal payload support.
   - Current proposal model only expresses new spans.
   - Extend payload schema so one item can represent either:
     - `new_span`
     - `extend_span`
   - `extend_span` should reference the existing tagged span and the proposed new normalized boundaries.
4. Merge logic.
   - If multiple model calls suggest compatible extensions for the same existing span/tag, merge them into one extension proposal.
5. Acceptance logic.
   - Applying an extension proposal should update the existing tagged span boundaries instead of creating a new span.
   - Preserve existing attached tags.
   - If proposal also adds a new tag, apply both boundary extension and tag attach.
6. Add tests.
   - same-tag smaller overlap inside existing span -> no new span proposal
   - same-tag larger overlap -> extension proposal
   - different-tag overlap on same text -> still allowed as normal/new association behavior

---

## 4. Backend: refine model instructions for scope selection

### Desired behavior
Prompt should steer the model toward:
- complete relevant clauses/subsentences
- not random flashy fragments
- not full turns unless the whole turn is relevant
- no interviewer targeting
- preference for extending existing same-tag coverage when appropriate

### Implementation steps
1. Rewrite pretag system prompt instructions.
2. Add guidance such as:
   - choose the smallest complete relevant unit
   - prefer a self-contained clause/subsentence over a fragment
   - when same code already exists on overlapping text, prefer extending that coverage rather than proposing a separate overlapping span
   - interviewer segments are context only
3. Keep transcript/codebook as separate user parts.
4. Add prompt snapshot tests.

---

## 5. Data model and proposal schema changes

### Desired behavior
Proposal payload must support both new spans and extensions.

### Implementation steps
1. Define a new proposal item schema for pretag suggestions.
   - Example shape:
     - `kind: "new_span" | "extend_span"`
     - `segment_id`
     - `start_offset`
     - `end_offset`
     - `tag_names`
     - `rationale`
     - `existing_span_id?`
2. Update Rust structs and JSON schema constants.
3. Ensure backward compatibility for old pending proposals if needed.
4. Update proposal acceptance code paths.

---

## 6. UI: represent extension proposals explicitly

### Desired behavior
The user must be able to see whether a proposal is:
- a brand new tagged span
- an extension of an existing tagged span

### UI requirements
1. Proposal list/detail view must show proposal type.
   - Badge/label: `New span` vs `Extend existing span`
2. Extension proposals must show before/after boundaries.
   - Existing text range
   - Proposed extended text range
   - Visual diff/highlight for added left/right text
3. Tag display must show whether the tag is:
   - already on the existing span
   - newly proposed to attach
4. For interviewer-context cases, no UI suggestion should appear if target was rejected.

### Implementation steps
1. Extend frontend types for pretag proposal items.
2. Update proposal rendering components.
3. Add copy/labels for extension proposals.
4. Add visual text preview.
   - highlight existing covered text
   - highlight newly added text separately
5. Update accept/reject actions.
   - Accepting `extend_span` updates the existing tagged span in place.
   - Rejecting behaves like any other proposal item.
6. Ensure proposal counters/statuses still work.

---

## 7. UI: transcript/tagging surface integration

### Desired behavior
When viewing the transcript/tagging UI, accepted extensions should feel like a refinement of the same tag, not a new separate overlapping annotation.

### Implementation steps
1. After accepting an extension proposal, refresh transcript/tagging state.
2. Ensure the existing highlighted span expands visually rather than duplicating.
3. If history/audit UI exists, record that the span was extended by AI proposal acceptance.
4. If conflict messaging exists, show why an extension was proposed instead of a new span.

---

## 8. Testing plan

### Backend tests
- interviewer segment suggestions are rejected
- participant segment suggestions survive with interviewer context present
- word snapping works
- clause/subsentence expansion works on Czech examples
- exact duplicate same-tag suggestion is removed
- contained same-tag overlap becomes no-op
- larger same-tag overlap becomes extension proposal
- extension acceptance updates span boundaries correctly

### UI tests
- proposal item renders `New span`
- proposal item renders `Extend existing span`
- extension preview highlights delta text
- accepting extension updates transcript highlight without creating overlap duplication

### Manual QA scenarios
1. interviewer asks question; participant answers; only participant gets proposals
2. existing partial span receives better wider same-tag suggestion -> extension proposal shown
3. conceptual tag on long turn expands to a meaningful clause/subsentence, not a tiny phrase
4. acceptance of extension does not create duplicate overlapping tagged spans

---

## 9. Suggested implementation order

1. Prompt update for interviewer-context-only behavior
2. Backend interviewer-target filtering
3. Clause/subsentence normalization
4. Overlap classification and extension proposal schema
5. Acceptance logic for extensions
6. UI proposal rendering for extension type
7. Transcript refresh/visualization updates
8. Tests + QA pass

---

## 10. Risks / design questions

1. **Clause detection heuristics**
   - Need to stay conservative to avoid over-expanding spans.
2. **Extension proposal granularity**
   - Decide whether extension is always tied to one existing span or can merge multiple spans.
3. **Backward compatibility**
   - Pending proposals created under old schema may need migration handling.
4. **UI complexity**
   - Extension preview should be obvious but not noisy.

---

## 11. Expected result

After implementation:
- pretag sees full conversational context
- interviewer turns are never tagged
- suggested spans align to words and meaningful subsentence/clause units
- overlapping same-tag suggestions become extension proposals instead of duplicate overlapping spans
- the UI makes these extensions understandable and actionable
