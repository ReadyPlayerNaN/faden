import { atom } from "jotai";
import type { ProjectInfo } from "../ipc/project";

export const currentProjectAtom = atom<ProjectInfo | null>(null);
