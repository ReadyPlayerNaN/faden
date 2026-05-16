import { invoke } from "@tauri-apps/api/core";

export type Speaker = {
	id: number;
	interviewId: number;
	labelRaw: string;
	displayName: string | null;
	personId: number | null;
	personName: string | null;
	effectiveName: string;
};

type Raw = {
	id: number;
	interview_id: number;
	label_raw: string;
	display_name: string | null;
	person_id: number | null;
	person_name: string | null;
};

export type SpeakerCreateInput = {
	labelRaw?: string | null;
	displayName?: string | null;
	personId?: number | null;
};

const fromRaw = (r: Raw): Speaker => ({
	id: r.id,
	interviewId: r.interview_id,
	labelRaw: r.label_raw,
	displayName: r.display_name,
	personId: r.person_id,
	personName: r.person_name,
	effectiveName: r.display_name ?? r.person_name ?? r.label_raw,
});

export const speakerListForInterview = async (
	interviewId: number,
): Promise<Speaker[]> =>
	(await invoke<Raw[]>("speaker_list_for_interview", { interviewId })).map(
		fromRaw,
	);

export const speakerSetDisplayName = (
	speakerId: number,
	displayName: string | null,
): Promise<void> =>
	invoke("speaker_set_display_name", { speakerId, displayName });

export const speakerSetPerson = (
	speakerId: number,
	personId: number | null,
): Promise<void> => invoke("speaker_set_person", { speakerId, personId });

export const speakerCreate = async (
	interviewId: number,
	input: SpeakerCreateInput,
): Promise<Speaker> =>
	fromRaw(
		await invoke<Raw>("speaker_create", {
			interviewId,
			labelRaw: input.labelRaw ?? null,
			displayName: input.displayName ?? null,
			personId: input.personId ?? null,
		}),
	);

export const speakerMerge = async (
	interviewId: number,
	sourceSpeakerIds: number[],
	newName: string,
): Promise<Speaker> =>
	fromRaw(
		await invoke<Raw>("speaker_merge", {
			interviewId,
			sourceSpeakerIds,
			newName,
		}),
	);

export const speakerDelete = (speakerId: number): Promise<void> =>
	invoke("speaker_delete", { speakerId });
