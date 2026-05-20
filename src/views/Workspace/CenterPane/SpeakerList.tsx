import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import {
	aiCodebookGenStart,
	aiCostEstimate,
	aiPretagStart,
	aiProposalList,
	aiRunList,
	type CostEstimate,
	type ProposalKind,
} from "../../../ipc/ai";
import {
	speakerCreate,
	speakerDelete,
	speakerListForInterview,
	speakerMerge,
	speakerSetDisplayName,
	speakerSetInterviewer,
	speakerSetPerson,
	type Speaker,
} from "../../../ipc/speaker";
import { personList, type Person } from "../../../ipc/person";
import { Modal } from "../../../components/Modal/Modal";
import { Button } from "../../../components/Button/Button";
import {
	activeAiOperationsAtom,
	aiRunHistoryAtom,
	pendingProposalsAtom,
	skipCostConfirmAtom,
} from "../../../state/ai";
import { interviewListAtom } from "../../../state/interview";
import { CostPreviewModal } from "../AI/CostPreviewModal";
import type { TranscriptionLens } from "./transcriptionLens";
import styles from "./SpeakerList.module.css";

type Props = {
	interviewId: number;
	transcriptionLens: TranscriptionLens;
	onTranscriptionLensChange: (lens: TranscriptionLens) => void;
	onChanged?: () => void;
};

type Action = "" | "add" | "merge";

type PendingAction = {
	kind: "codebook_gen" | "pretag";
};

export const SpeakerList = ({
	interviewId,
	transcriptionLens,
	onTranscriptionLensChange,
	onChanged,
}: Props) => {
	const { t } = useTranslation();
	const interviews = useAtomValue(interviewListAtom);
	const skipCostConfirm = useAtomValue(skipCostConfirmAtom);
	const aiRuns = useAtomValue(aiRunHistoryAtom);
	const activeOps = useAtomValue(activeAiOperationsAtom);
	const setSkipCostConfirm = useSetAtom(skipCostConfirmAtom);
	const setPendingProposals = useSetAtom(pendingProposalsAtom);
	const setAiRuns = useSetAtom(aiRunHistoryAtom);
	const setActiveOps = useSetAtom(activeAiOperationsAtom);
	const [speakers, setSpeakers] = useState<Speaker[]>([]);
	const [people, setPeople] = useState<Person[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [action, setAction] = useState<Action>("");
	const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
	const [estimate, setEstimate] = useState<CostEstimate | null>(null);
	const [newLabel, setNewLabel] = useState("");
	const [newDisplayName, setNewDisplayName] = useState("");
	const [newPersonId, setNewPersonId] = useState("");
	const [mergeSpeakerIds, setMergeSpeakerIds] = useState<number[]>([]);
	const [mergeNewName, setMergeNewName] = useState("");
	const [detailSpeaker, setDetailSpeaker] = useState<Speaker | null>(null);
	const [detailDisplayName, setDetailDisplayName] = useState("");
	const [detailPersonId, setDetailPersonId] = useState("");
	const [detailInterviewer, setDetailInterviewer] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const interviewName = useMemo(
		() => interviews.find((item) => item.id === interviewId)?.name ?? `#${interviewId}`,
		[interviewId, interviews],
	);
	const isCodebookRunning =
		activeOps.some((op) => op.kind === "codebook_gen" && op.interviewId === interviewId) ||
		aiRuns.some(
			(run) =>
				run.status === "running" &&
				run.kind === "codebook_gen" &&
				run.interviewId === interviewId,
		);
	const isPretagRunning =
		activeOps.some((op) => op.kind === "pretag" && op.interviewId === interviewId) ||
		aiRuns.some(
			(run) => run.status === "running" && run.kind === "pretag" && run.interviewId === interviewId,
		);

	const refresh = async () => {
		const [nextSpeakers, nextPeople] = await Promise.all([
			speakerListForInterview(interviewId),
			personList(),
		]);
		setSpeakers(nextSpeakers);
		setPeople(nextPeople);
		onChanged?.();
	};

	useEffect(() => {
		void refresh();
	}, [interviewId]);

	useEffect(() => {
		if (!menuOpen) return;
		const onMouseDown = (e: MouseEvent) => {
			if (!containerRef.current) return;
			if (!containerRef.current.contains(e.target as Node)) {
				setMenuOpen(false);
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setMenuOpen(false);
		};
		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [menuOpen]);

	const closeActionModal = () => {
		setAction("");
		setNewLabel("");
		setNewDisplayName("");
		setNewPersonId("");
		setMergeSpeakerIds([]);
		setMergeNewName("");
	};

	const openAction = (nextAction: Action) => {
		setError(null);
		setMenuOpen(false);
		setAction(nextAction);
	};

	const openSpeakerDetail = (speaker: Speaker) => {
		setError(null);
		setDetailSpeaker(speaker);
		setDetailDisplayName(speaker.displayName ?? "");
		setDetailPersonId(
			speaker.personId === null ? "" : String(speaker.personId),
		);
		setDetailInterviewer(speaker.interviewer);
	};

	const closeSpeakerDetail = () => {
		setDetailSpeaker(null);
		setDetailDisplayName("");
		setDetailPersonId("");
		setDetailInterviewer(false);
	};

	const refreshProposals = async () => setPendingProposals(await aiProposalList());
	const refreshRuns = async () => setAiRuns(await aiRunList());

	const startLocalOperation = (kind: ProposalKind): string => {
		const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		setActiveOps((prev) => [
			{
				id,
				runId: null,
				kind,
				startedAt: new Date().toISOString(),
				interviewId,
				label: t("ai.operationWithInterview", {
					kind: t(`ai.kinds.${kind}`),
					name: interviewName,
				}),
			},
			...prev,
		]);
		return id;
	};

	const setLocalOperationRunId = (id: string, runId: number) => {
		setActiveOps((prev) => prev.map((op) => (op.id === id ? { ...op, runId } : op)));
	};

	const finishLocalOperation = (id: string) => {
		setActiveOps((prev) => prev.filter((op) => op.id !== id));
	};

	const startAiAction = async (kind: PendingAction["kind"]) => {
		const localId = startLocalOperation(kind);
		try {
			const runId =
				kind === "codebook_gen"
					? await aiCodebookGenStart([interviewId], true)
					: await aiPretagStart(interviewId);
			setLocalOperationRunId(localId, runId);
			await Promise.all([refreshProposals(), refreshRuns()]);
		} catch (err) {
			await refreshRuns().catch(() => undefined);
			setError(String((err as { message?: string }).message ?? err));
		} finally {
			finishLocalOperation(localId);
		}
	};

	const requestAiAction = async (kind: PendingAction["kind"]) => {
		setError(null);
		setMenuOpen(false);
		const isRunning = kind === "codebook_gen" ? isCodebookRunning : isPretagRunning;
		if (isRunning) return;
		if (skipCostConfirm[kind]) {
			await startAiAction(kind);
			return;
		}
		try {
			const args =
				kind === "codebook_gen"
					? { interview_ids: [interviewId], include_existing_codebook: true }
					: { interview_id: interviewId };
			setEstimate(await aiCostEstimate(kind, args));
			setPendingAction({ kind });
		} catch (err) {
			setError(String((err as { message?: string }).message ?? err));
		}
	};

	const closeCostPreview = () => {
		setPendingAction(null);
		setEstimate(null);
	};

	const confirmAiAction = async (dontAsk: boolean) => {
		const nextAction = pendingAction;
		setPendingAction(null);
		setEstimate(null);
		if (!nextAction) return;
		if (dontAsk) {
			setSkipCostConfirm({ ...skipCostConfirm, [nextAction.kind]: true });
		}
		await startAiAction(nextAction.kind);
	};

	const toggleMergeSpeaker = (speakerId: number) => {
		setMergeSpeakerIds((current) =>
			current.includes(speakerId)
				? current.filter((id) => id !== speakerId)
				: [...current, speakerId],
		);
	};

	const submitAdd = async () => {
		const label = newLabel.trim();
		const displayName = newDisplayName.trim();
		const personId = newPersonId ? Number(newPersonId) : null;
		if (!label && personId === null) return;
		setError(null);
		try {
			await speakerCreate(interviewId, {
				labelRaw: label || null,
				displayName: displayName || null,
				personId,
			});
			await refresh();
			closeActionModal();
		} catch (err) {
			setError(String(err));
		}
	};

	const submitMerge = async () => {
		if (mergeSpeakerIds.length < 2) {
			setError(
				t("speakers.mergeSelectAtLeastTwo", {
					defaultValue: "Select at least two speakers to merge.",
				}),
			);
			return;
		}
		if (!mergeNewName.trim()) {
			setError(
				t("speakers.mergeNameRequired", {
					defaultValue: "Enter a name for the merged speaker.",
				}),
			);
			return;
		}
		setError(null);
		try {
			await speakerMerge(interviewId, mergeSpeakerIds, mergeNewName.trim());
			await refresh();
			closeActionModal();
		} catch (err) {
			setError(String(err));
		}
	};

	const submitDetail = async () => {
		if (!detailSpeaker) return;
		setError(null);
		try {
			await speakerSetDisplayName(
				detailSpeaker.id,
				detailDisplayName.trim() ? detailDisplayName.trim() : null,
			);
			await speakerSetPerson(
				detailSpeaker.id,
				detailPersonId ? Number(detailPersonId) : null,
			);
			await speakerSetInterviewer(detailSpeaker.id, detailInterviewer);
			await refresh();
			closeSpeakerDetail();
		} catch (err) {
			setError(String(err));
		}
	};

	const deleteFromDetail = async () => {
		if (!detailSpeaker) return;
		setError(null);
		try {
			await speakerDelete(detailSpeaker.id);
			await refresh();
			closeSpeakerDetail();
		} catch (err) {
			setError(String(err));
		}
	};

	return (
		<>
			<div className={styles.bar}>
				<span className={styles.label}>
					{t("speakers.title", { defaultValue: "Speakers" })}:
				</span>
				<div className={styles.list}>
					{speakers.map((speaker) => (
						<span key={speaker.id} className={styles.item}>
							<button
								className={`${styles.name} ${speaker.interviewer ? styles.nameInterviewer : ""}`}
								onClick={() => openSpeakerDetail(speaker)}
							>
								{speaker.effectiveName}
								{speaker.interviewer ? (
									<span className={styles.badge}>
										{t("speakers.interviewer", { defaultValue: "Interviewer" })}
									</span>
								) : null}
							</button>
						</span>
					))}
				</div>
				<div className={styles.lensSelector} role="group" aria-label={t("transcript.viewLens", { defaultValue: "Transcript lens" })}>
					{([
						["codes", t("transcript.lensCodes", { defaultValue: "Codes" })],
						["categories", t("transcript.lensCategories", { defaultValue: "Categories" })],
						["clusters", t("transcript.lensClusters", { defaultValue: "Clusters" })],
					] as const).map(([lens, label]) => (
						<button
							key={lens}
							type="button"
							className={`${styles.lensButton} ${transcriptionLens === lens ? styles.lensButtonActive : ""}`}
							onClick={() => onTranscriptionLensChange(lens)}
							aria-pressed={transcriptionLens === lens}
						>
							{label}
						</button>
					))}
				</div>
				<div className={styles.actions} ref={containerRef}>
					<Button
						onClick={() => setMenuOpen((value) => !value)}
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						className={styles.trigger}
					>
						{t("speakers.actions", { defaultValue: "Actions..." })} ▾
					</Button>
					{menuOpen && (
						<div className={styles.menu} role="menu">
							<button
								type="button"
								role="menuitem"
								className={styles.menuItem}
								disabled={isCodebookRunning}
								onClick={() => void requestAiAction("codebook_gen")}
							>
								{t("ai.generateCodebook")}
							</button>
							<button
								type="button"
								role="menuitem"
								className={styles.menuItem}
								disabled={isPretagRunning}
								onClick={() => void requestAiAction("pretag")}
							>
								{t("ai.preTag")}
							</button>
							<button
								type="button"
								role="menuitem"
								className={styles.menuItem}
								onClick={() => openAction("add")}
							>
								{t("speakers.add", { defaultValue: "Add speaker" })}
							</button>
							<button
								type="button"
								role="menuitem"
								className={styles.menuItem}
								disabled={speakers.length < 2}
								onClick={() => openAction("merge")}
							>
								{t("speakers.merge", { defaultValue: "Merge speakers" })}
							</button>
						</div>
					)}
				</div>
			</div>
			{error && <div className={styles.error}>{error}</div>}
			{pendingAction && estimate && (
				<CostPreviewModal
					estimate={estimate}
					prompt=""
					onSend={confirmAiAction}
					onCancel={closeCostPreview}
				/>
			)}

			<Modal
				open={action === "add"}
				onClose={closeActionModal}
				title={t("speakers.add", { defaultValue: "Add speaker" })}
				size="sm"
				footer={
					<>
						<Button type="button" onClick={closeActionModal}>
							{t("common.cancel", { defaultValue: "Cancel" })}
						</Button>
						<Button
							type="button"
							variant="primary"
							onClick={() => void submitAdd()}
							disabled={!newLabel.trim() && !newPersonId}
						>
							{t("common.create", { defaultValue: "Create" })}
						</Button>
					</>
				}
			>
				<div className={styles.fields}>
					<label className={styles.field}>
						<span>{t("people.title", { defaultValue: "People" })}</span>
						<select
							value={newPersonId}
							onChange={(e) => setNewPersonId(e.target.value)}
						>
							<option value="">
								{t("speakers.noPerson", { defaultValue: "No linked person" })}
							</option>
							{people.map((person) => (
								<option key={person.id} value={String(person.id)}>
									{person.name}
								</option>
							))}
						</select>
					</label>
					<label className={styles.field}>
						<span>{t("speakers.label", { defaultValue: "Label" })}</span>
						<input
							value={newLabel}
							onChange={(e) => setNewLabel(e.target.value)}
							placeholder={
								newPersonId
									? t("speakers.labelOptionalWhenLinked", {
											defaultValue: "Optional when linking a person",
										})
									: t("speakers.labelPlaceholder", { defaultValue: "e.g. S3" })
							}
						/>
					</label>
					<label className={styles.field}>
						<span>
							{t("speakers.displayName", { defaultValue: "Display name" })}
						</span>
						<input
							value={newDisplayName}
							onChange={(e) => setNewDisplayName(e.target.value)}
							placeholder={
								newPersonId
									? t("speakers.inheritPersonName", {
											defaultValue: "Leave empty to inherit the person's name",
										})
									: t("speakers.displayNamePlaceholder", {
											defaultValue: "Optional",
										})
							}
						/>
					</label>
				</div>
			</Modal>

			<Modal
				open={action === "merge"}
				onClose={closeActionModal}
				title={t("speakers.merge", { defaultValue: "Merge speakers" })}
				size="sm"
				footer={
					<>
						<Button type="button" onClick={closeActionModal}>
							{t("common.cancel", { defaultValue: "Cancel" })}
						</Button>
						<Button type="button" variant="primary" onClick={() => void submitMerge()}>
							{t("speakers.merge", { defaultValue: "Merge speakers" })}
						</Button>
					</>
				}
			>
				<div className={styles.fields}>
					<p className={styles.help}>
						{t("speakers.mergeHelp", {
							defaultValue:
								"Select multiple speakers to merge, then give the merged speaker a new name.",
						})}
					</p>
					<label className={styles.field}>
						<span>
							{t("speakers.mergeName", { defaultValue: "Merged speaker name" })}
						</span>
						<input
							value={mergeNewName}
							onChange={(e) => setMergeNewName(e.target.value)}
							placeholder={t("speakers.mergeNamePlaceholder", {
								defaultValue: "Enter merged speaker name",
							})}
						/>
					</label>
					<div className={styles.field}>
						<span>
							{t("speakers.mergeSelection", {
								defaultValue: "Speakers to merge",
							})}
						</span>
						<div className={styles.checkboxGroup}>
							{speakers.map((speaker) => {
								const checked = mergeSpeakerIds.includes(speaker.id);
								return (
									<label key={speaker.id} className={styles.checkboxItem}>
										<input
											type="checkbox"
											checked={checked}
											onChange={() => toggleMergeSpeaker(speaker.id)}
										/>
										<span>
											{speaker.effectiveName}
											<span className={styles.checkboxMeta}>
												{" "}
												({speaker.labelRaw})
											</span>
										</span>
									</label>
								);
							})}
						</div>
					</div>
				</div>
			</Modal>

			<Modal
				open={detailSpeaker !== null}
				onClose={closeSpeakerDetail}
				title={t("speakers.details", { defaultValue: "Speaker details" })}
				size="sm"
				footer={
					<>
						<Button type="button" onClick={closeSpeakerDetail}>
							{t("common.cancel", { defaultValue: "Cancel" })}
						</Button>
						<Button
							type="button"
							variant="danger"
							onClick={() => void deleteFromDetail()}
						>
							{t("common.delete", { defaultValue: "Delete" })}
						</Button>
						<Button type="button" variant="primary" onClick={() => void submitDetail()}>
							{t("common.save", { defaultValue: "Save" })}
						</Button>
					</>
				}
			>
				<div className={styles.fields}>
					<label className={styles.field}>
						<span>{t("speakers.label", { defaultValue: "Label" })}</span>
						<input value={detailSpeaker?.labelRaw ?? ""} disabled />
					</label>
					<label className={styles.field}>
						<span>
							{t("speakers.displayName", { defaultValue: "Display name" })}
						</span>
						<input
							value={detailDisplayName}
							onChange={(e) => setDetailDisplayName(e.target.value)}
							placeholder={
								detailPersonId
									? t("speakers.inheritPersonName", {
											defaultValue: "Leave empty to inherit the person's name",
										})
									: t("speakers.displayNamePlaceholder", {
											defaultValue: "Optional",
										})
							}
						/>
					</label>
					<label className={styles.field}>
						<span>{t("people.title", { defaultValue: "People" })}</span>
						<select
							value={detailPersonId}
							onChange={(e) => setDetailPersonId(e.target.value)}
						>
							<option value="">
								{t("speakers.noPerson", { defaultValue: "No linked person" })}
							</option>
							{people.map((person) => (
								<option key={person.id} value={String(person.id)}>
									{person.name}
								</option>
							))}
						</select>
					</label>
					<label className={styles.checkboxItem}>
						<input
							type="checkbox"
							checked={detailInterviewer}
							onChange={(e) => setDetailInterviewer(e.target.checked)}
						/>
						<span>
							{t("speakers.interviewer", { defaultValue: "Interviewer" })}
						</span>
					</label>
					{detailSpeaker?.personName ? (
						<p className={styles.help}>
							{t("speakers.currentInheritance", {
								defaultValue: "Currently inheriting from: {{name}}",
								name: detailSpeaker.personName,
							})}
						</p>
					) : null}
				</div>
			</Modal>
		</>
	);
};
