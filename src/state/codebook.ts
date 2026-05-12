import { atom } from "jotai";
import type { CodebookTree } from "../ipc/codebook";

export const codebookTreeAtom = atom<CodebookTree | null>(null);

export type SelectedCodebookNode =
  | { kind: "cluster"; id: number }
  | { kind: "category"; id: number }
  | { kind: "tag"; id: number }
  | null;

export const selectedCodebookNodeAtom = atom<SelectedCodebookNode>(null);
