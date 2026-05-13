import { invoke } from "@tauri-apps/api/core";

export type ExportScope = {
  interviewIds: number[] | null;
  tagIds: number[] | null;
};

const toRawScope = (s: ExportScope) => ({
  interview_ids: s.interviewIds,
  tag_ids: s.tagIds,
});

export const exportCsv = (
  scope: ExportScope,
  destination: string,
): Promise<void> =>
  invoke("export_csv", { scope: toRawScope(scope), destination });

export const exportMarkdown = (
  scope: ExportScope,
  destination: string,
): Promise<void> =>
  invoke("export_markdown", { scope: toRawScope(scope), destination });

export const exportRefi = (
  scope: ExportScope,
  destination: string,
): Promise<void> =>
  invoke("export_refi", { scope: toRawScope(scope), destination });

export const exportStats = (
  scope: ExportScope,
  format: "csv" | "markdown",
  destination: string,
): Promise<void> =>
  invoke("export_stats", { scope: toRawScope(scope), format, destination });

export const exportCodebook = (
  format: "json" | "csv",
  destination: string,
): Promise<void> => invoke("export_codebook", { format, destination });
