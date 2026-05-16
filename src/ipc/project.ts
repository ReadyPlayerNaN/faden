import { invoke } from "@tauri-apps/api/core";

export type ProjectInfo = {
  path: string;
  name: string;
};

export const projectCreate = (name: string): Promise<ProjectInfo> =>
  invoke<ProjectInfo>("project_create", { name });

export const projectOpen = (path: string): Promise<ProjectInfo> =>
  invoke<ProjectInfo>("project_open", { path });
