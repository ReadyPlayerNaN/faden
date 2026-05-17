import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
	pendingProposalsAtom,
	activeProposalIdAtom,
	hasOngoingAiOperationsAtom,
} from "../../../state/ai";
import {
	aiProposalList,
	aiProposalReject,
	aiProposalGet,
	type ProposalDTO,
	type ProposalStatus,
} from "../../../ipc/ai";
import { interviewContentVersionAtom } from "../../../state/interview";
import { codebookTreeAtom } from "../../../state/codebook";
import { codebookTree as fetchCodebookTree } from "../../../ipc/codebook";
import { CodebookProposalView } from "./CodebookProposalView";
import { SpanProposalView } from "./SpanProposalView";
import { Button } from "../../../components/Button/Button";
import { ErrorBanner } from "../../../components/ErrorBanner";
import { Modal } from "../../../components/Modal/Modal";
import styles from "./StagingPanel.module.css";

type StagingPanelProps = {
	fullHeight?: boolean;
	initialSelectedStatuses?: ProposalStatus[];
};

export const StagingPanel = ({
	fullHeight = false,
	initialSelectedStatuses = ["pending"],
}: StagingPanelProps) => {
	const { t } = useTranslation();
	const [proposals, setProposals] = useAtom(pendingProposalsAtom);
	const [activeId, setActiveId] = useAtom(activeProposalIdAtom);
	const hasOngoingAiOperations = useAtomValue(hasOngoingAiOperationsAtom);
	const setInterviewContentVersion = useSetAtom(interviewContentVersionAtom);
	const setCodebookTree = useSetAtom(codebookTreeAtom);
	const [active, setActive] = useState<ProposalDTO | null>(null);
	const [selectedStatuses, setSelectedStatuses] = useState<ProposalStatus[]>(
		initialSelectedStatuses,
	);
	const [filterOpen, setFilterOpen] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const filterRef = useRef<HTMLDivElement | null>(null);
	const prevHasOngoingRef = useRef(false);

	const refreshProposals = async () => {
		try {
			setError(null);
			const nextProposals = await aiProposalList();
			setProposals(nextProposals);
			return nextProposals;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(message);
			return proposals;
		} finally {
			setLoading(false);
		}
	};

	const refreshActiveProposal = async () => {
		if (activeId === null) return null;
		try {
			const nextActive = await aiProposalGet(activeId);
			setActive(nextActive);
			return nextActive;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(message);
			setActive(null);
			setActiveId(null);
			return null;
		}
	};

	useEffect(() => {
		void refreshProposals();
	}, [setProposals]);

	useEffect(() => {
		if (activeId === null) {
			setActive(null);
			return;
		}
		void refreshActiveProposal();
	}, [activeId]);

	useEffect(() => {
		const hadOngoing = prevHasOngoingRef.current;
		prevHasOngoingRef.current = hasOngoingAiOperations;

		if (!hasOngoingAiOperations) {
			if (hadOngoing) {
				void Promise.all([refreshProposals(), refreshActiveProposal()]);
			}
			return;
		}

		void Promise.all([refreshProposals(), refreshActiveProposal()]);
		const interval = window.setInterval(() => {
			void Promise.all([refreshProposals(), refreshActiveProposal()]);
		}, 2000);
		return () => {
			window.clearInterval(interval);
		};
	}, [activeId, hasOngoingAiOperations, setProposals]);

	useEffect(() => {
		if (!filterOpen) return;
		const onMouseDown = (event: MouseEvent) => {
			if (!filterRef.current?.contains(event.target as Node)) {
				setFilterOpen(false);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setFilterOpen(false);
		};
		document.addEventListener("mousedown", onMouseDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [filterOpen]);

	const onReject = async (id: number) => {
		await aiProposalReject(id);
		const [, nextActive] = await Promise.all([
			refreshProposals(),
			activeId === id ? refreshActiveProposal() : Promise.resolve(null),
		]);
		if (nextActive) setActive(nextActive);
	};

	const onClose = async () => {
		setActiveId(null);
		await refreshProposals();
	};

	const toggleStatus = (status: ProposalStatus) => {
		setSelectedStatuses((current) => {
			if (current.includes(status)) {
				return current.length === 1
					? current
					: current.filter((value) => value !== status);
			}
			return [...current, status];
		});
	};

	const visibleProposals = useMemo(() => {
		if (selectedStatuses.length === 0) return proposals;
		return proposals.filter((proposal) =>
			selectedStatuses.includes(proposal.status),
		);
	}, [proposals, selectedStatuses]);

	const filterLabel = useMemo(() => {
		if (selectedStatuses.length === 3) {
			return t("ai.filterSuggestionsAll", { defaultValue: "All statuses" });
		}
		return selectedStatuses
			.map((status) =>
				t(`ai.proposalStatus.${status === "pending" ? "new" : status}`),
			)
			.join(", ");
	}, [selectedStatuses, t]);

	const onAccepted = async () => {
		setInterviewContentVersion((version) => version + 1);
		setCodebookTree(await fetchCodebookTree());
	};

	return (
		<div
			className={`${styles.dock} ${fullHeight ? styles.fullHeight : ""}`.trim()}
		>
			<header className={styles.header}>
				<span>{t("ai.staging", { count: visibleProposals.length })}</span>
			</header>
			{error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
			<div className={styles.filters} ref={filterRef}>
				<Button
					onClick={() => setFilterOpen((open) => !open)}
					aria-haspopup="menu"
					aria-expanded={filterOpen}
					className={styles.filterButton}
				>
					<span aria-hidden="true" className={styles.filterIcon}>
						<svg
							viewBox="0 0 16 16"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M2 3h12l-4.8 5.2v3.6l-2.4 1.2V8.2L2 3Z"
								fill="currentColor"
							/>
						</svg>
					</span>
					<span>{filterLabel}</span>
					<span aria-hidden="true"> ▾</span>
				</Button>
				{filterOpen && (
					<div className={styles.filterDropdown} role="menu">
						{(["pending", "accepted", "rejected"] as ProposalStatus[]).map(
							(status) => (
								<label key={status} className={styles.filterOption}>
									<input
										type="checkbox"
										checked={selectedStatuses.includes(status)}
										onChange={() => toggleStatus(status)}
									/>
									{t(
										`ai.proposalStatus.${status === "pending" ? "new" : status}`,
									)}
								</label>
							),
						)}
					</div>
				)}
			</div>
			{loading && proposals.length === 0 ? (
				<p className={styles.empty}>{t("ai.loadingSuggestions", { defaultValue: "Loading suggestions…" })}</p>
			) : error && proposals.length === 0 ? (
				<p className={styles.empty}>
					{t("ai.suggestionsLoadFailed", {
						defaultValue: "Couldn’t load suggestions right now.",
					})}
				</p>
			) : proposals.length === 0 ? (
				<p className={styles.empty}>{t("ai.noProposals")}</p>
			) : visibleProposals.length === 0 ? (
				<p className={styles.empty}>{t("ai.noFilteredProposals")}</p>
			) : (
				<ul className={styles.list}>
					{visibleProposals.map((p) => (
						<li key={p.id}>
							<button
								type="button"
								className={styles.rowButton}
								onClick={() => setActiveId(p.id)}
							>
								<span className={styles.kind}>{t(`ai.kinds.${p.kind}`)}</span>
								<span
									className={`${styles.status} ${styles[`status_${p.status}`]}`}
								>
									{t(
										`ai.proposalStatus.${p.status === "pending" ? "new" : p.status}`,
									)}
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
			<Modal open={active !== null} onClose={() => void onClose()} size="lg">
				{active &&
					(active.kind === "pretag" || active.kind === "find_more" ? (
						<SpanProposalView
							key={active.id}
							proposal={active}
							onAccepted={() => void onAccepted()}
							onReject={() => void onReject(active.id)}
							onDone={() => void onClose()}
						/>
					) : (
						<CodebookProposalView
							key={active.id}
							proposal={active}
							onAccepted={() => void onAccepted()}
							onReject={() => void onReject(active.id)}
							onDone={() => void onClose()}
						/>
					))}
			</Modal>
		</div>
	);
};
