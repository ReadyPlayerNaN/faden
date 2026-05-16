# Proposal: simplify the "Add interview" dialog

## Problem in the current dialog
Current `AddInterviewModal` starts with 5 top-level choices:

- Pouze zvuk
- Přepis (text)
- Přepis (JSON)
- Zvuk + přepis
- Zvuk + přepis (JSON)

This makes a simple action feel too technical and too branching. The user must understand internal data combinations before they can even start.

## Design goal
Replace the mode-first UI with **one single dialog view** that matches the mental model:

1. What is the interview called?
2. Do I have audio?
3. Do I also have an existing transcript?
4. If yes, is it text or JSON?

## Proposed new dialog

### 1) Always-visible top section
- **Název**
- **Zvuk**
  - button: `Vybrat zvuk…`
  - selected file shown below
  - optional, not required

This makes audio a normal optional input, not a separate mode.

### 2) Transcript section as a simple choice
Under audio:

- **Přepis**
  - radio / segmented choice:
    - `Nemám přepis`
    - `Text`
    - `JSON`

Default: `Nemám přepis`

### 3) Conditional transcript input
Only when `Text` or `JSON` is selected:
- button: `Vybrat soubor…`
- textarea below it
- placeholder changes by type:
  - text: `Vložte přepis sem`
  - JSON: `Vložte JSON sem`

## Resulting user flow
The dialog becomes a single linear form:

1. Enter name
2. Optionally attach audio
3. Choose transcript type
4. Optionally paste / import transcript
5. Create

No tabs, no mode switching, no 5-way decision upfront.

## Recommended layout

```text
[Přidat rozhovor]

Název
[______________________]

Zvuk (volitelné)
[Vybrat zvuk…]  selected-file.mp3

Přepis
(o) Nemám přepis
( ) Text
( ) JSON

[only if Text/JSON]
[Vybrat soubor…]  selected-file.txt/json
[textarea]

[Zrušit] [Vytvořit]
```

## Why this is better
- **One view only** — no exploded combinations
- **Progressive disclosure** — only relevant fields appear
- **Less technical** — user does not choose a backend import mode
- **Audio becomes optional metadata**, not a separate workflow
- **Scales better** if more import helpers are added later

## Validation rules
- `Název` required
- If transcript type = `Text`, textarea/file content must be non-empty
- If transcript type = `JSON`, content must be valid JSON
- Audio remains optional

## Submit behavior mapping
No backend redesign is required immediately. Frontend can map the single form to existing commands:

- audio + no transcript → `interviewCreateWithAudio`
- no audio + text → `interviewImportText`
- no audio + json → `interviewImportJson`
- audio + text → `interviewImportAudioText`
- audio + json → `interviewImportAudioJson`
- no audio + no transcript → ideally `interviewCreate`

This means the UX can be simplified first, while keeping current backend capabilities.

## Small copy changes
Suggested labels:

- `Zvuk (volitelné)` instead of mode `Pouze zvuk`
- `Přepis` with values `Nemám přepis / Text / JSON`
- `Vybrat soubor…` can stay shared
- Primary button could stay `Vytvořit`

## Nice optional improvements
- Auto-fill name from selected audio or transcript file
- Show a short hint under `JSON`: `Např. diarizovaný export z přepisu`
- If both audio and transcript are missing, disable submit until at least one source exists **or** allow empty interview creation intentionally

## Implementation note
Main file to simplify:
- `src/views/Workspace/LeftPane/AddInterviewModal.tsx`

Likely cleanup:
- remove tabs styles from `src/views/Workspace/LeftPane/AddInterviewModal.module.css`
- replace `import.tabs.*` translation keys with simpler `import.transcriptType.*` labels

## Recommendation
I would implement the dialog as a **single form with optional audio and transcript sections**, and completely remove the 5-tab mode selector.
