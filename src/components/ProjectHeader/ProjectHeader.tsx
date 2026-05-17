import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../Button/Button";
import { ViewModeLabel, type ViewMode } from "../ViewModeIcon/ViewModeIcon";
import { projectUpdate } from "../../ipc/project";
import { settingsRecentRename } from "../../ipc/settings";
import { currentProjectAtom } from "../../state/project";
import { EditProjectModal } from "../../views/Workspace/EditProjectModal";
import styles from "./ProjectHeader.module.css";

type ProjectHeaderProps = {
	activeView?: ViewMode | null;
	viewAccessory?: ReactNode;
	leftActions?: ReactNode;
	actions?: ReactNode;
};

const getViewLabel = (t: ReturnType<typeof useTranslation>["t"], activeView: ViewMode | null) => {
	switch (activeView) {
		case "interviews":
			return t("workspace.interviews", { defaultValue: "Interviews" });
		case "labels":
			return t("tags.title", { defaultValue: "Labels" });
		case "people":
			return t("people.title", { defaultValue: "People" });
		case "analysis":
			return t("analysis.title", { defaultValue: "Analysis" });
		case "export":
			return t("export.title", { defaultValue: "Export" });
		case "coding":
		default:
			return t("workspace.coding", { defaultValue: "Coding" });
	}
};

export const ProjectHeader = ({
	activeView = null,
	viewAccessory,
	leftActions,
	actions,
}: ProjectHeaderProps) => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [project, setProject] = useAtom(currentProjectAtom);
	const [projectMenuOpen, setProjectMenuOpen] = useState(false);
	const [viewMenuOpen, setViewMenuOpen] = useState(false);
	const [editProjectOpen, setEditProjectOpen] = useState(false);
	const projectMenuRef = useRef<HTMLDivElement | null>(null);
	const viewMenuRef = useRef<HTMLDivElement | null>(null);
	const resolvedActiveView = activeView ?? "coding";

	useEffect(() => {
		if (!projectMenuOpen && !viewMenuOpen) return;
		const onMouseDown = (e: MouseEvent) => {
			const target = e.target as Node;
			if (!projectMenuRef.current?.contains(target)) {
				setProjectMenuOpen(false);
			}
			if (!viewMenuRef.current?.contains(target)) {
				setViewMenuOpen(false);
			}
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setProjectMenuOpen(false);
				setViewMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", onMouseDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [projectMenuOpen, viewMenuOpen]);

	const onEditProject = async (name: string, language: string) => {
		if (!project) return;
		const updated = await projectUpdate(name, language);
		await settingsRecentRename(project.path, name).catch(() => undefined);
		setProject(updated);
	};

	const viewOptions: Array<{
		view: ViewMode;
		label: string;
		onClick: () => void;
	}> = [
		...(project
			? [
					{
						view: "interviews" as const,
						label: t("workspace.interviews", { defaultValue: "Interviews" }),
						onClick: () => {
							void navigate({
								to: "/workspace/$projectPath/interviews",
								params: {
									projectPath: encodeURIComponent(project.path),
								},
							});
						},
					},
			  ]
			: []),
		{
			view: "coding",
			label: t("workspace.coding", { defaultValue: "Coding" }),
			onClick: () => {
				void navigate(
					project
						? {
								to: "/workspace/$projectPath",
								params: {
									projectPath: encodeURIComponent(project.path),
								},
						  }
						: { to: "/" },
				);
			},
		},
		{
			view: "labels",
			label: t("tags.title", { defaultValue: "Labels" }),
			onClick: () => {
				void navigate({ to: "/tags" });
			},
		},
		{
			view: "people",
			label: t("people.title", { defaultValue: "People" }),
			onClick: () => {
				void navigate(
					project
						? {
								to: "/workspace/$projectPath/people",
								params: {
									projectPath: encodeURIComponent(project.path),
								},
						  }
						: { to: "/people" },
				);
			},
		},
		...(project
			? [
					{
						view: "analysis" as const,
						label: t("analysis.title", { defaultValue: "Analysis" }),
						onClick: () => {
							void navigate({
								to: "/workspace/$projectPath/analysis",
								params: {
									projectPath: encodeURIComponent(project.path),
								},
							});
						},
					},
			  ]
			: []),
		...(project
			? [
					{
						view: "export" as const,
						label: t("export.title", { defaultValue: "Export" }),
						onClick: () => {
							void navigate({
								to: "/workspace/$projectPath/export",
								params: {
									projectPath: encodeURIComponent(project.path),
								},
							});
						},
					},
			  ]
			: []),
	];

	return (
		<>
			<header className={styles.header}>
				<div className={styles.headerLeft}>
					<div className={styles.projectMenuWrap} ref={projectMenuRef}>
						<Button
							onClick={() => setProjectMenuOpen((v) => !v)}
							aria-haspopup="menu"
							aria-expanded={projectMenuOpen}
							className={styles.projectMenuTrigger}
						>
							<span className={styles.projectMenuTriggerContent}>
								<span className={styles.title}>
									{project?.name ?? t("common.loading")}
								</span>
								<span aria-hidden="true">▾</span>
							</span>
						</Button>
						{projectMenuOpen && (
							<div className={styles.projectMenuDropdown} role="menu">
								<button
									type="button"
									role="menuitem"
									className={styles.projectMenuItem}
									onClick={() => {
										setProjectMenuOpen(false);
										setEditProjectOpen(true);
									}}
								>
									{t("workspace.editProject", { defaultValue: "Edit project" })}
								</button>
								<button
									type="button"
									role="menuitem"
									className={styles.projectMenuItem}
									onClick={() => {
										setProjectMenuOpen(false);
										void navigate(
											project
												? {
														to: "/settings/$projectPath",
														params: {
															projectPath: encodeURIComponent(project.path),
														},
												  }
												: { to: "/settings" },
										);
									}}
								>
									{t("workspace.settings", { defaultValue: "Settings" })}
								</button>
								<button
									type="button"
									role="menuitem"
									className={styles.projectMenuItem}
									onClick={() => {
										setProjectMenuOpen(false);
										setProject(null);
										void navigate({ to: "/" });
									}}
								>
									{t("workspace.openAnotherProject", {
										defaultValue: "Open another project",
									})}
								</button>
							</div>
						)}
					</div>
					<div className={styles.viewMenuWrap} ref={viewMenuRef}>
						<Button
							onClick={() => setViewMenuOpen((v) => !v)}
							aria-haspopup="menu"
							aria-expanded={viewMenuOpen}
							className={styles.viewMenuTrigger}
						>
							<span className={styles.projectMenuTriggerContent}>
								<ViewModeLabel view={resolvedActiveView} className={styles.viewLabelWrap}>
									<span className={styles.title}>{getViewLabel(t, activeView)}</span>
								</ViewModeLabel>
								<span aria-hidden="true">▾</span>
							</span>
						</Button>
						{viewMenuOpen && (
							<div className={styles.projectMenuDropdown} role="menu">
								{viewOptions.map(({ view, label, onClick }) => {
									const isActive = resolvedActiveView === view;
									return (
										<button
											key={view}
											type="button"
											role="menuitemradio"
											aria-checked={isActive}
											className={`${styles.projectMenuItem} ${isActive ? styles.projectMenuItemActive : ""}`}
											onClick={() => {
												setViewMenuOpen(false);
												onClick();
											}}
										>
											<ViewModeLabel view={view} className={styles.viewMenuItemContent}>
												{label}
											</ViewModeLabel>
										</button>
									);
								})}
							</div>
						)}
					</div>
					{viewAccessory ? <div className={styles.viewAccessory}>{viewAccessory}</div> : null}
					{leftActions ? (
						<>
							<div className={styles.separator} aria-hidden="true" />
							<div className={styles.headerActions}>{leftActions}</div>
						</>
					) : null}
				</div>
				<div className={styles.headerActions}>{actions}</div>
			</header>
			{project && (
				<EditProjectModal
					open={editProjectOpen}
					initialName={project.name}
					initialLanguage={project.language}
					onClose={() => setEditProjectOpen(false)}
					onSave={onEditProject}
				/>
			)}
		</>
	);
};
