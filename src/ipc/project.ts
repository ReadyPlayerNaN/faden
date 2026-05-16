import { invoke } from "@tauri-apps/api/core";

export type ProjectInfo = {
  path: string;
  name: string;
  language: string;
};

export const projectCreate = (
  name: string,
  language?: string,
): Promise<ProjectInfo> => invoke<ProjectInfo>("project_create", { name, language });

export const projectOpen = (path: string): Promise<ProjectInfo> =>
  invoke<ProjectInfo>("project_open", { path });

export const projectRename = (name: string): Promise<void> =>
  invoke("project_rename", { name });

export const projectUpdate = (
  name: string,
  language?: string,
): Promise<ProjectInfo> => invoke<ProjectInfo>("project_update", { name, language });
