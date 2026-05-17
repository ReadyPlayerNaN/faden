import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../Button/Button";
import { projectUpdate } from "../../ipc/project";
import { settingsRecentRename } from "../../ipc/settings";
import { currentProjectAtom } from "../../state/project";
import { EditProjectModal } from "../../views/Workspace/EditProjectModal";
import styles from "./ProjectHeader.module.css";

type ProjectHeaderProps = {
	activeView?: "coding" | "labels" | "people" | "export" | null;
	leftActions?: ReactNode;
	actions?: ReactNode;
};

export const ProjectHeader = ({
	activeView = null,
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
								<span className={styles.title}>
									{activeView === "labels"
										? t("tags.title", { defaultValue: "Labels" })
										: activeView === "people"
											? t("people.title", { defaultValue: "People" })
											: activeView === "export"
												? t("export.title", { defaultValue: "Export" })
												: t("workspace.coding", { defaultValue: "Coding" })}
								</span>
								<span aria-hidden="true">▾</span>
							</span>
						</Button>
						{viewMenuOpen && (
							<div className={styles.projectMenuDropdown} role="menu">
								{activeView !== "coding" && (
									<button
										type="button"
										role="menuitem"
										className={styles.projectMenuItem}
										onClick={() => {
											setViewMenuOpen(false);
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
										}}
									>
										{t("workspace.coding", { defaultValue: "Coding" })}
									</button>
								)}
								{activeView !== "labels" && (
									<button
										type="button"
										role="menuitem"
										className={styles.projectMenuItem}
										onClick={() => {
											setViewMenuOpen(false);
											void navigate({ to: "/tags" });
										}}
									>
										{t("tags.title", { defaultValue: "Labels" })}
									</button>
								)}
								{activeView !== "people" && (
									<button
										type="button"
										role="menuitem"
										className={styles.projectMenuItem}
										onClick={() => {
											setViewMenuOpen(false);
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
										}}
									>
										{t("people.title", { defaultValue: "People" })}
									</button>
								)}
								{activeView !== "export" && project && (
									<button
										type="button"
										role="menuitem"
										className={styles.projectMenuItem}
										onClick={() => {
											setViewMenuOpen(false);
											void navigate({
												to: "/workspace/$projectPath/export",
												params: {
													projectPath: encodeURIComponent(project.path),
												},
											});
										}}
									>
										{t("export.title", { defaultValue: "Export" })}
									</button>
								)}
							</div>
						)}
					</div>
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
