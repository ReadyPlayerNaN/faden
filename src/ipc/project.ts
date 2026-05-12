import { invoke } from "@tauri-apps/api/core";

export type ProjectInfo = {
  path: string;
  name: string;
};

export const projectCreate = (path: string, name: string): Promise<ProjectInfo> =>
  invoke<ProjectInfo>("project_create", { path, name });

export const projectOpen = (path: string): Promise<ProjectInfo> =>
  invoke<ProjectInfo>("project_open", { path });
