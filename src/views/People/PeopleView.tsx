import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ProjectHeader } from "../../components/ProjectHeader/ProjectHeader";
import {
	personCreate,
	personDelete,
	personList,
	personRename,
	type Person,
} from "../../ipc/person";
import styles from "./PeopleView.module.css";

type DeleteTarget = Person | null;

export const PeopleView = () => {
	const { t } = useTranslation();
	const [people, setPeople] = useState<Person[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [addOpen, setAddOpen] = useState(false);
	const [draftName, setDraftName] = useState("");
	const [editingPerson, setEditingPerson] = useState<Person | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
	const [busy, setBusy] = useState(false);

	const reload = async () => {
		try {
			setPeople(await personList());
		} catch (e) {
			setError(String(e));
		}
	};

	useEffect(() => {
		void reload();
	}, []);

	const closeAdd = () => {
		setAddOpen(false);
		setDraftName("");
	};

	const openEdit = (person: Person) => {
		setError(null);
		setEditingPerson(person);
		setDraftName(person.name);
	};

	const closeEdit = () => {
		setEditingPerson(null);
		setDraftName("");
	};

	const submitAdd = async () => {
		const name = draftName.trim();
		if (!name) return;
		setBusy(true);
		setError(null);
		try {
			await personCreate(name);
			closeAdd();
			await reload();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	};

	const submitEdit = async () => {
		if (!editingPerson) return;
		const name = draftName.trim();
		if (!name) return;
		setBusy(true);
		setError(null);
		try {
			await personRename(editingPerson.id, name);
			closeEdit();
			await reload();
		} catch (e) {
			setError(String(e));
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
			setError(String(e));
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
									<div className={styles.count}>
										{t("people.linkedSpeakers", {
											defaultValue: "Linked speakers: {{count}}",
											count: person.linkedSpeakerCount,
										})}
									</div>
								</div>
								<div className={styles.actions}>
									<Button onClick={() => openEdit(person)}>
										{t("common.rename", { defaultValue: "Rename" })}
									</Button>
									<Button onClick={() => setDeleteTarget(person)}>
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
						<button type="button" onClick={closeAdd}>
							{t("common.cancel", { defaultValue: "Cancel" })}
						</button>
						<button
							type="button"
							onClick={() => void submitAdd()}
							disabled={busy || !draftName.trim()}
						>
							{t("common.create", { defaultValue: "Create" })}
						</button>
					</>
				}
			>
				<label className={styles.field}>
					<span>{t("people.name", { defaultValue: "Name" })}</span>
					<input
						value={draftName}
						autoFocus
						onChange={(e) => setDraftName(e.target.value)}
					/>
				</label>
			</Modal>

			<Modal
				open={editingPerson !== null}
				onClose={closeEdit}
				title={t("people.rename", { defaultValue: "Rename person" })}
				size="sm"
				footer={
					<>
						<button type="button" onClick={closeEdit}>
							{t("common.cancel", { defaultValue: "Cancel" })}
						</button>
						<button
							type="button"
							onClick={() => void submitEdit()}
							disabled={busy || !draftName.trim()}
						>
							{t("common.save", { defaultValue: "Save" })}
						</button>
					</>
				}
			>
				<label className={styles.field}>
					<span>{t("people.name", { defaultValue: "Name" })}</span>
					<input
						value={draftName}
						autoFocus
						onChange={(e) => setDraftName(e.target.value)}
					/>
				</label>
			</Modal>

			<Modal
				open={deleteTarget !== null}
				onClose={() => setDeleteTarget(null)}
				title={t("people.delete", { defaultValue: "Delete person" })}
				size="sm"
				footer={
					<>
						<button type="button" onClick={() => setDeleteTarget(null)}>
							{t("common.cancel", { defaultValue: "Cancel" })}
						</button>
						<button
							type="button"
							onClick={() => void confirmDelete()}
							disabled={busy}
						>
							{t("common.delete", { defaultValue: "Delete" })}
						</button>
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
