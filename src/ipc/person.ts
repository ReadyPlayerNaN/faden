import { invoke } from "@tauri-apps/api/core";

export type Person = {
	id: number;
	name: string;
	linkedSpeakerCount: number;
};

type Raw = {
	id: number;
	name: string;
	linked_speaker_count: number;
};

const fromRaw = (r: Raw): Person => ({
	id: r.id,
	name: r.name,
	linkedSpeakerCount: r.linked_speaker_count,
});

export const personList = async (): Promise<Person[]> =>
	(await invoke<Raw[]>("person_list")).map(fromRaw);

export const personCreate = async (name: string): Promise<Person> =>
	fromRaw(await invoke<Raw>("person_create", { name }));

export const personRename = (personId: number, name: string): Promise<void> =>
	invoke("person_rename", { personId, name });

export const personDelete = (personId: number): Promise<void> =>
	invoke("person_delete", { personId });
