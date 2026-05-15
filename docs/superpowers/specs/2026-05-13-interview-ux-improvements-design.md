# Interview UX Improvements

**Date:** 2026-05-13

## Summary

Three targeted UX fixes:
1. Delete interview from the project
2. Insert new segments in the transcript editor
3. AI dropdown opens upward (it sits at the bottom of the screen)

---

## 1. Delete Interview

### Problem
There is no UI to remove an interview from the project. The backend command `interview_delete` and the IPC function `interviewDelete` already exist but are unused.

Additionally, the current Tauri `interview_delete` command does not clean up the audio file from disk.

### Design

**Backend — `src-tauri/src/commands/interview.rs`**

Rewrite the `interview_delete` Tauri command to:
1. Read the interview record first.
2. Delete it from the DB (cascades to speakers, segments, tagged_spans).
3. Best-effort remove the audio file from disk (same pattern as `interview_clear_audio`).

**Frontend — `src/views/Workspace/LeftPane/InterviewList.tsx`**

- Add "Delete interview…" menu item to the existing `⋯` dropdown in `InterviewRow`, below the audio actions.
- Wire a second confirmation `Modal` (same pattern as the existing "Remove audio" modal). Body: "This will permanently delete the interview and all its data. This cannot be undone."
- On confirm: call `interviewDelete(iv.id)`, refresh the interview list, and clear `selectedInterviewIdAtom` if the deleted interview was selected.

**i18n** (`src/i18n/en.json`, `src/i18n/cs.json`)

New keys:
- `interview.delete` — "Delete interview…"
- `interview.confirmDelete` — "Delete interview?"
- `interview.confirmDeleteBody` — body text

---

## 2. Insert New Segment

### Problem
The transcript editor allows editing, splitting, merging, and deleting existing segments, but there is no way to add a new blank segment at an arbitrary position.

### Design

**Backend — `src-tauri/src/commands/segment.rs`**

New Tauri command `segment_insert_after(segment_id: i64)`:
1. Load the target segment (to get `interview_id`, `order_index`, `end_sec`, `speaker_id`).
2. Shift all segments in the same interview with `order_index > target.order_index` by +1.
3. Insert a new blank segment immediately after:
   - `interview_id` = same
   - `speaker_id` = same as target (sensible default)
   - `start_sec` = `target.end_sec`
   - `end_sec` = `target.end_sec` (zero-length; user sets timestamps via split or direct edit)
   - `text` = `""` (empty)
   - `order_index` = `target.order_index + 1`
4. Renumber order indices (defensive, consistent with existing commands).

**Backend — `src-tauri/src/lib.rs`**

Register `commands::segment::segment_insert_after`.

**Frontend — `src/ipc/segment.ts`**

Add:
```ts
export const segmentInsertAfter = (segmentId: number): Promise<void> =>
  invoke("segment_insert_after", { segmentId });
```

**Frontend — `src/views/Workspace/CenterPane/TranscriptViewer.tsx`**

- Add `onAddAfter: () => Promise<void>` prop to `SegmentEditor`.
- Add "Add segment after" button in `editorActions` that calls `onAddAfter`.
- In `TranscriptViewer`, pass:
  ```tsx
  onAddAfter={() => segmentInsertAfter(s.id).then(refetchSegments)}
  ```

**i18n**

New key: `transcript.insertAfter` — "Add segment after"

---

## 3. AI Dropdown Direction

### Problem
`AiMenu` sits inside the `AudioPlayer` bar which is pinned to the bottom of the window. The dropdown opens downward (`top: calc(100% + 4px)`) and is cut off by the window edge.

### Design

**`src/views/Workspace/AudioPlayer/AiMenu.module.css`**

Change `.menu`:
```css
/* before */
top: calc(100% + 4px);
/* after */
bottom: calc(100% + 4px);
```

No other changes needed.

---

## Out of Scope

- Renaming interviews (backend exists; separate task if needed)
- Reordering segments by drag-and-drop
- Timestamp editing on manually inserted segments
