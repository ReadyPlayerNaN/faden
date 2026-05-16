import { atom } from "jotai";
import type { Interview } from "../ipc/interview";

export const interviewListAtom = atom<Interview[]>([]);
export const selectedInterviewIdAtom = atom<number | null>(null);
export const interviewContentVersionAtom = atom(0);

export const selectedInterviewAtom = atom((get) => {
  const id = get(selectedInterviewIdAtom);
  if (id === null) return null;
  return get(interviewListAtom).find((i) => i.id === id) ?? null;
});

export const effectiveSelectedInterviewIdAtom = atom(
  (get) => get(selectedInterviewAtom)?.id ?? null,
);
