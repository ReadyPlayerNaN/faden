import { invoke } from "@tauri-apps/api/core";

export type Person = {
	id: number;
	name: string;
	email: string | null;
	phone: string | null;
	linkedSpeakerCount: number;
};

type Raw = {
	id: number;
	name: string;
	email: string | null;
	phone: string | null;
	linked_speaker_count: number;
};

export type PersonInput = {
	name: string;
	email?: string | null;
	phone?: string | null;
};

const fromRaw = (r: Raw): Person => ({
	id: r.id,
	name: r.name,
	email: r.email,
	phone: r.phone,
	linkedSpeakerCount: r.linked_speaker_count,
});

export const personList = async (): Promise<Person[]> =>
	(await invoke<Raw[]>("person_list")).map(fromRaw);

export const personCreate = async (input: PersonInput): Promise<Person> =>
	fromRaw(
		await invoke<Raw>("person_create", {
			name: input.name,
			email: input.email ?? null,
			phone: input.phone ?? null,
		}),
	);

export const personRename = (
	personId: number,
	input: PersonInput,
): Promise<void> =>
	invoke("person_rename", {
		personId,
		name: input.name,
		email: input.email ?? null,
		phone: input.phone ?? null,
	});

export const personDelete = (personId: number): Promise<void> =>
	invoke("person_delete", { personId });
