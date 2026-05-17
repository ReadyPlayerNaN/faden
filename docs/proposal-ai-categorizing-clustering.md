# Proposal — AI categorizing, clustering, and analysis workspace

## Goal

Add two new AI assists to Faden's qualitative coding workflow:

- **Categorizing** — read existing tags and propose how they should be grouped into categories.
- **Clustering** — read existing categories and propose how they should be grouped into clusters.

The main design question is not only "where do the buttons go?" but also how analysts should **review, accept, inspect, and use** the resulting higher-order structure.

My recommendation is:

1. Treat **Categorizing** and **Clustering** as **codebook-structuring actions**, not as generic AI utilities.
2. Place their entry points primarily in the **Labels / Codebook area**.
3. Add a separate **Analysis workspace** for interpretation and validation views, instead of overloading the current Coding or Labels screens.
4. Keep review in the existing **Suggestions center / staging pattern**, extended for hierarchy proposals.

---

## Why this needs more than one new view

These two actions create or change the **analytic structure** of the project. Once that structure exists, analysts need to:

- inspect the proposed hierarchy,
- validate it against evidence,
- compare prevalence across interviews,
- notice co-occurrence patterns,
- and write interpretive memos.

So the solution should separate three functions:

1. **Build structure** — make and revise clusters/categories/tags.
2. **Review proposals** — accept/reject AI restructuring suggestions safely.
3. **Interpret structure** — explore evidence, prevalence, and relationships.

A single extra view will likely become overloaded.

---

## Recommended information architecture

Add a new top-level area:

- **Coding** — transcript work, tagging, span review
- **Labels** — codebook management
- **People** — participants / attributes
- **Analysis** — higher-level qualitative analysis

Within **Analysis**, split into subviews/tabs:

1. **Theme map**
2. **Prevalence matrix**
3. **Evidence browser**
4. **Co-occurrence**
5. **Memos**

This keeps the current app simple while giving qualitative analysis its own home.

---

## Where the new AI action buttons should live

## Primary placement: Labels view

The best primary home for both actions is the current **Labels** view, because both actions operate on the codebook itself.

Add a new section near the top of `TagsView`:

- **AI structure**
  - **Categorize tags**
  - **Cluster categories**
  - optional later: **Rebalance structure** / **Suggest merges**

Why here:

- the user is already in codebook-management mode,
- the action target is clear,
- the result is structural rather than transcript-specific,
- it matches the existing explicit-user-triggered AI philosophy.

## Secondary placement: Analysis / Theme map

Also allow these actions from the future **Theme map** view:

- **Categorize uncategorized tags**
- **Cluster uncategorized categories**
- **Re-run suggestions**

Why:

- once analysts are reviewing the hierarchy visually, they may spot gaps and want a contextual rerun,
- the theme map is the natural place for refinement after the first pass.

## Avoid primary placement in Coding view

Do **not** make these primary actions in the transcript Coding view.

Reason:

- Coding is interview/span-level work,
- categorizing and clustering are project-level synthesis tasks,
- placing them beside transcript actions would mix micro-coding with macro-analysis.

---

## Recommended workflow

## Phase 1 — Open coding / tag generation

Analyst creates tags manually or with existing AI support.

## Phase 2 — AI categorizing

User triggers **Categorize tags**.

Input:

- existing tags,
- tag descriptions,
- usage counts,
- sample quotes for each tag,
- optional existing categories.

Output proposal:

- suggested categories,
- suggested assignment of tags to categories,
- rationale per category,
- confidence,
- warnings for ambiguous tags / possible duplicates / outliers.

Review mode:

- accept full proposal,
- accept per category,
- accept per tag assignment,
- reject or leave unmatched.

## Phase 3 — AI clustering

User triggers **Cluster categories**.

Input:

- existing categories,
- category descriptions,
- member tags,
- prevalence summaries,
- representative evidence.

Output proposal:

- suggested clusters,
- assignment of categories to clusters,
- rationale per cluster,
- flags for weak clusters or cross-cutting categories.

Review mode:

- accept full proposal,
- accept per cluster,
- accept per category placement,
- reject weak groupings.

## Phase 4 — Analysis and interpretation

After structure is accepted, the analyst moves into **Analysis** views to test and refine the interpretation.

---

## View design proposal

## 1. Theme map

**Purpose:** show the analytic hierarchy and support explanation.

Structure:

- clusters
n  - categories
    - tags/codes
- counts at each level
- expandable hierarchy
- optional evidence preview and memo indicator

Actions:

- create/edit/delete/reorder cluster/category/tag
- run **Categorize tags**
- run **Cluster categories**
- inspect rationale from accepted AI proposals
- jump to evidence browser filtered to the selected node

Why it matters:

- this becomes the main representation of the emerging thematic structure,
- it is the best place to understand the whole analysis at a glance.

## 2. Theme prevalence matrix

**Purpose:** compare how themes appear across interviews.

Rows:

- interviews, participants, or groups

Columns:

- clusters or categories

Cells:

- binary presence,
- coded quote count,
- optional normalized intensity.

Controls:

- switch between cluster/category granularity,
- filter interviews,
- sort by prevalence,
- click a cell to open evidence browser with the exact subset.

Why it matters:

- analysts often need to see whether themes are concentrated, widespread, or group-specific.

## 3. Evidence browser

**Purpose:** verify that themes are grounded in actual data.

Filters:

- cluster,
- category,
- tag,
- interview,
- participant attributes,
- accepted/rejected AI provenance,
- memo presence.

Results:

- quotes/snippets,
- attached tags,
- parent category/cluster,
- memo preview,
- jump back to transcript/audio.

Why it matters:

- every structural claim needs evidence checking,
- this is the validation bridge between abstract themes and raw material.

## 4. Co-occurrence view

**Purpose:** surface relationships between codes/themes.

Possible forms:

- matrix,
- ranked pair list,
- simple network graph later.

Levels:

- tag ↔ tag,
- category ↔ category,
- optional cluster ↔ cluster summaries.

Controls:

- within same quote/span,
- within same interview,
- threshold by count,
- exclude trivial parent-child aggregation artifacts.

Why it matters:

- helps discover patterned relationships,
- supports interpretation such as tensions, mechanisms, or sequences.

## 5. Memo / interpretation layer

**Purpose:** turn coding structure into analytic argument.

Objects with memos:

- tag,
- category,
- cluster,
- interview,
- project-level analytic memo.

Features:

- show memo badges across all analysis views,
- timeline or list of recent memos,
- pin important memos,
- link memo to evidence filters.

Why it matters:

- qualitative analysis is not just classification; it is interpretation.

---

## Suggested UI split by analyst workflow

Instead of one monolithic Analysis screen, use this progression:

### A. Structure

- **Labels** for manual codebook editing
- **Theme map** for hierarchy review

### B. Validation

- **Evidence browser**
- **Prevalence matrix**
- **Co-occurrence**

### C. Interpretation

- **Memos**

This mirrors typical workflow:

1. create codes,
2. organize them,
3. test the organization against data,
4. write the interpretation.

---

## Proposal review model

The current proposal/staging pattern is a strong base and should be extended rather than replaced.

Add new proposal kinds:

- `categorize`
- `cluster`

Suggested payload shape for categorizing:

- proposed categories
- each category has:
  - name
  - description
  - tag ids
  - rationale
  - confidence
- unmatched tag ids
- merge warnings / ambiguity warnings

Suggested payload shape for clustering:

- proposed clusters
- each cluster has:
  - name
  - description
  - category ids
  - rationale
  - confidence
- unmatched category ids
- overlap warnings

Review interactions should support partial acceptance, because hierarchy proposals are rarely all-or-nothing.

---

## Acceptance granularity

For qualitative work, granular acceptance is important.

Recommended acceptance levels:

### Categorizing

- accept all
- accept one proposed category
- accept only selected tag placements
- create category but leave some tags unassigned

### Clustering

- accept all
- accept one proposed cluster
- accept only selected category placements
- create cluster shell first, move categories selectively

This is safer than a single "apply everything" action.

---

## Suggested navigation model

## Top-level view switcher

Extend current top-level navigation from:

- Coding
- Labels
- People

to:

- Coding
- Labels
- People
- Analysis

This likely means updating:

- `src/components/ProjectHeader/ProjectHeader.tsx`
- `src/router.tsx`

## Analysis sub-navigation

Inside Analysis, add tabs or a left rail:

- Theme map
- Matrix
- Evidence
- Co-occurrence
- Memos

This is preferable to putting all of them into the top-level switcher.

---

## Recommended first implementation slice

To keep scope realistic, implement in this order:

### Step 1 — AI structuring in Labels

Add:

- **Categorize tags** button
- **Cluster categories** button
- new proposal kinds in staging/review

No new analysis workspace yet.

### Step 2 — Theme map + Evidence browser

These two provide the highest value first:

- Theme map for hierarchy understanding
- Evidence browser for validation

### Step 3 — Prevalence matrix

Useful once hierarchy is stable and participant metadata matters.

### Step 4 — Co-occurrence

Important, but can come after the evidence and matrix views.

### Step 5 — Memo workspace

Can begin as lightweight attached memos and later grow into a richer interpretation hub.

---

## Concrete recommendation

If we must choose the simplest good solution now:

1. Put **Categorize tags** and **Cluster categories** in **Labels**.
2. Reuse the **Suggestions center** for reviewing and partially accepting proposals.
3. Add a new top-level **Analysis** area.
4. Start Analysis with only:
   - **Theme map**
   - **Evidence browser**
5. Add matrix, co-occurrence, and memo-focused views after that.

This gives a clean separation:

- **Labels** = build the codebook
- **Suggestions** = review AI changes
- **Analysis** = interpret and validate themes

---

## Candidate implementation anchors in the current codebase

Likely touch points:

- `src/views/Tags/TagsView.tsx`
  - add AI structure actions
- `src/ipc/ai.ts`
  - add new start functions and proposal kinds
- `src/views/Workspace/AI/StagingPanel.tsx`
  - extend proposal review handling
- `src/views/AI/SuggestionsView.tsx`
  - no major pattern change, but new proposal rendering
- `src/components/ProjectHeader/ProjectHeader.tsx`
  - add Analysis top-level view
- `src/router.tsx`
  - add Analysis routes
- new views under `src/views/Analysis/`
  - `ThemeMapView.tsx`
  - `EvidenceBrowserView.tsx`
  - later matrix/co-occurrence/memos

---

## Final recommendation

Do not treat Categorizing and Clustering as just two extra buttons.

Treat them as the start of a new **analysis-structure workflow**:

- trigger in **Labels**,
- review in **Suggestions**,
- inspect and refine in **Analysis**.

That aligns better with real qualitative research practice than trying to fit everything into one additional screen.