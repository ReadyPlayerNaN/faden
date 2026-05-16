import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import { useParams } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ProjectHeader } from "../../components/ProjectHeader/ProjectHeader";
import { TextField } from "../../components/TextField/TextField";
import { projectOpen } from "../../ipc/project";
import {
	personCreate,
	personDelete,
	personList,
	personRename,
	type Person,
	type PersonInput,
} from "../../ipc/person";
import { currentProjectAtom } from "../../state/project";
import styles from "./PeopleView.module.css";

type DeleteTarget = Person | null;

type PersonDraft = {
	name: string;
	email: string;
	phone: string;
};

const emptyDraft = (): PersonDraft => ({ name: "", email: "", phone: "" });

const toInput = (draft: PersonDraft): PersonInput => ({
	name: draft.name.trim(),
	email: draft.email.trim() || null,
	phone: draft.phone.trim() || null,
});

export const PeopleView = () => {
	const { t } = useTranslation();
	const { projectPath } = useParams({ strict: false }) as {
		projectPath?: string;
	};
	const [project, setProject] = useAtom(currentProjectAtom);
	const [people, setPeople] = useState<Person[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [addOpen, setAddOpen] = useState(false);
	const [draft, setDraft] = useState<PersonDraft>(emptyDraft());
	const [editingPerson, setEditingPerson] = useState<Person | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
	const [busy, setBusy] = useState(false);

	const handleError = (e: unknown) => {
		const msg = String((e as { message?: string })?.message ?? e);
		if (msg.includes("Conflict") || msg.includes("already exists")) {
			setError(
				t("people.errorDuplicate", {
					defaultValue: "A person with that name already exists",
				}),
			);
		} else if (msg.includes("not found") || msg.includes("NotFound")) {
			setError(t("errors.notFound", { defaultValue: "Not found" }));
		} else if (msg.includes("Invalid") || msg.includes("invalid")) {
			setError(t("errors.invalid", { defaultValue: "Invalid input" }));
		} else {
			setError(msg);
		}
	};

	const reload = async () => {
		try {
			setPeople(await personList());
		} catch (e) {
			handleError(e);
		}
	};

	useEffect(() => {
		if (!projectPath) return;
		const path = decodeURIComponent(projectPath);
		if (!project || project.path !== path) {
			void projectOpen(path).then(setProject);
		}
	}, [projectPath, project, setProject]);

	useEffect(() => {
		void reload();
	}, []);

	const closeAdd = () => {
		setAddOpen(false);
		setDraft(emptyDraft());
	};

	const openEdit = (person: Person) => {
		setError(null);
		setEditingPerson(person);
		setDraft({
			name: person.name,
			email: person.email ?? "",
			phone: person.phone ?? "",
		});
	};

	const closeEdit = () => {
		setEditingPerson(null);
		setDraft(emptyDraft());
	};

	const setDraftField = (field: keyof PersonDraft, value: string) => {
		setDraft((current) => ({ ...current, [field]: value }));
	};

	const submitAdd = async () => {
		const input = toInput(draft);
		if (!input.name) return;
		setBusy(true);
		setError(null);
		try {
			await personCreate(input);
			closeAdd();
			await reload();
		} catch (e) {
			handleError(e);
		} finally {
			setBusy(false);
		}
	};

	const submitEdit = async () => {
		if (!editingPerson) return;
		const input = toInput(draft);
		if (!input.name) return;
		setBusy(true);
		setError(null);
		try {
			await personRename(editingPerson.id, input);
			closeEdit();
			await reload();
		} catch (e) {
			handleError(e);
		} finally {
			setBusy(false);
		}
	};

	const confirmDelete = async () => {
		if (!deleteTarget) return;
		setBusy(true);
		setError(null);
		try {
			await personDelete(deleteTarget.id);
			setDeleteTarget(null);
			await reload();
		} catch (e) {
			handleError(e);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={styles.shell}>
			<ProjectHeader activeView="people" />
			<div className={styles.wrap}>
				<div className={styles.headerRow}>
					<div>
						<h1 className={styles.title}>
							{t("people.title", { defaultValue: "People" })}
						</h1>
						<p className={styles.subtitle}>
							{t("people.subtitle", {
								defaultValue:
									"Manage people shared across interviews. Speakers can link to a person and inherit their name.",
							})}
						</p>
					</div>
					<Button variant="primary" onClick={() => setAddOpen(true)}>
						+ {t("people.add", { defaultValue: "Add person" })}
					</Button>
				</div>

				{error ? <div className={styles.error}>{error}</div> : null}

				<div className={styles.list}>
					{people.length === 0 ? (
						<p className={styles.empty}>
							{t("people.empty", { defaultValue: "No people yet." })}
						</p>
					) : (
						people.map((person) => (
							<div key={person.id} className={styles.row}>
								<div className={styles.meta}>
									<div className={styles.name}>{person.name}</div>
									<div className={styles.details}>
										{person.email ? <span>{person.email}</span> : null}
										{person.phone ? <span>{person.phone}</span> : null}
									</div>
									<div className={styles.count}>
										{t("people.linkedSpeakers", {
											defaultValue: "Linked speakers: {{count}}",
											count: person.linkedSpeakerCount,
										})}
									</div>
								</div>
								<div className={styles.actions}>
									<Button onClick={() => openEdit(person)}>
										{t("common.edit", { defaultValue: "Edit" })}
									</Button>
									<Button
										variant="danger"
										onClick={() => setDeleteTarget(person)}
									>
										{t("common.delete", { defaultValue: "Delete" })}
									</Button>
								</div>
							</div>
						))
					)}
				</div>
			</div>

			<Modal
				open={addOpen}
				onClose={closeAdd}
				title={t("people.add", { defaultValue: "Add person" })}
				size="sm"
				footer={
					<>
						<Button onClick={closeAdd} disabled={busy}>
							{t("common.cancel", { defaultValue: "Cancel" })}
						</Button>
						<Button
							variant="primary"
							onClick={() => void submitAdd()}
							disabled={busy || !draft.name.trim()}
						>
							{t("common.create", { defaultValue: "Create" })}
						</Button>
					</>
				}
			>
				<div className={styles.form}>
					<TextField
						label={t("people.name", { defaultValue: "Name" }) as string}
						value={draft.name}
						autoFocus
						onChange={(e) => setDraftField("name", e.target.value)}
					/>
					<TextField
						label={t("people.email", { defaultValue: "Email" }) as string}
						value={draft.email}
						onChange={(e) => setDraftField("email", e.target.value)}
					/>
					<TextField
						label={t("people.phone", { defaultValue: "Phone" }) as string}
						value={draft.phone}
						onChange={(e) => setDraftField("phone", e.target.value)}
					/>
				</div>
			</Modal>

			<Modal
				open={editingPerson !== null}
				onClose={closeEdit}
				title={t("people.edit", { defaultValue: "Edit person" })}
				size="sm"
				footer={
					<>
						<Button onClick={closeEdit} disabled={busy}>
							{t("common.cancel", { defaultValue: "Cancel" })}
						</Button>
						<Button
							variant="primary"
							onClick={() => void submitEdit()}
							disabled={busy || !draft.name.trim()}
						>
							{t("common.save", { defaultValue: "Save" })}
						</Button>
					</>
				}
			>
				<div className={styles.form}>
					<TextField
						label={t("people.name", { defaultValue: "Name" }) as string}
						value={draft.name}
						autoFocus
						onChange={(e) => setDraftField("name", e.target.value)}
					/>
					<TextField
						label={t("people.email", { defaultValue: "Email" }) as string}
						value={draft.email}
						onChange={(e) => setDraftField("email", e.target.value)}
					/>
					<TextField
						label={t("people.phone", { defaultValue: "Phone" }) as string}
						value={draft.phone}
						onChange={(e) => setDraftField("phone", e.target.value)}
					/>
				</div>
			</Modal>

			<Modal
				open={deleteTarget !== null}
				onClose={() => setDeleteTarget(null)}
				title={t("people.delete", { defaultValue: "Delete person" })}
				size="sm"
				footer={
					<>
						<Button onClick={() => setDeleteTarget(null)} disabled={busy}>
							{t("common.cancel", { defaultValue: "Cancel" })}
						</Button>
						<Button
							variant="danger"
							onClick={() => void confirmDelete()}
							disabled={busy}
						>
							{t("common.delete", { defaultValue: "Delete" })}
						</Button>
					</>
				}
			>
				<p className={styles.confirmText}>
					{t("people.confirmDelete", {
						defaultValue:
							'Delete "{{name}}"? Linked speakers will stay in interviews but become unlinked.',
						name: deleteTarget?.name ?? "",
					})}
				</p>
			</Modal>
		</div>
	);
};
