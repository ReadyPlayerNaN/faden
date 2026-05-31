import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import { SpanProposalView } from "./SpanProposalView";
import type { ProposalDTO } from "../../../ipc/ai";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/workspace/test" }),
}));

const { aiRunGet, aiProposalAccept, segmentListForInterview, spanListForInterview, codebookTree } = vi.hoisted(() => ({
  aiRunGet: vi.fn(),
  aiProposalAccept: vi.fn(),
  segmentListForInterview: vi.fn(),
  spanListForInterview: vi.fn(),
  codebookTree: vi.fn(),
}));
vi.mock("../../../ipc/ai", async () => {
  const actual = await vi.importActual<typeof import("../../../ipc/ai")>("../../../ipc/ai");
  return {
    ...actual,
    aiRunGet,
    aiProposalAccept,
  };
});

vi.mock("../../../ipc/segment", () => ({
  segmentListForInterview,
}));

vi.mock("../../../ipc/tagging", () => ({
  spanListForInterview,
}));

vi.mock("../../../ipc/codebook", async () => {
  const actual = await vi.importActual<typeof import("../../../ipc/codebook")>("../../../ipc/codebook");
  return {
    ...actual,
    codebookTree,
  };
});

describe("SpanProposalView", () => {
  beforeEach(() => {
    aiRunGet.mockReset();
    aiProposalAccept.mockReset();
    segmentListForInterview.mockReset();
    spanListForInterview.mockReset();
    codebookTree.mockReset();
  });

  it("renders extension preview with before/after text and existing/new tags", async () => {
    aiRunGet.mockResolvedValue({ interviewId: 7 });
    segmentListForInterview.mockResolvedValue([
      { id: 1, interviewId: 7, speakerId: 1, speakerLabelRaw: "A", speakerDisplayName: null, startSec: 0, endSec: 1, text: "alpha beta gamma delta", orderIndex: 0 },
    ]);
    spanListForInterview.mockResolvedValue([
      {
        id: 10,
        interviewId: 7,
        segmentId: 1,
        startOffset: 6,
        endOffset: 16,
        textSnapshot: "beta gamma",
        audioStartSec: 0,
        audioEndSec: 1,
        createdAt: "now",
        tags: [{ tagId: 1, source: "manual" }],
        memo: null,
      },
    ]);
    codebookTree.mockResolvedValue({
      clusters: [],
      standaloneCategories: [],
      standaloneTags: [
        { id: 1, categoryId: null, name: "known", description: null, color: null, orderIndex: 0, count: 0 },
        { id: 2, categoryId: null, name: "new-tag", description: null, color: null, orderIndex: 1, count: 0 },
      ],
    });

    const proposal: ProposalDTO = {
      id: 1,
      aiRunId: 1,
      kind: "pretag",
      status: "pending",
      createdAt: "now",
      decidedAt: null,
      payload: {
        suggestions: [
          {
            kind: "extend_span",
            existing_span_id: 10,
            segment_id: 1,
            start_offset: 0,
            end_offset: 22,
            tag_names: ["known", "new-tag"],
            rationale: "extend it",
          },
        ],
      },
    };

    render(
      <Provider>
        <SpanProposalView proposal={proposal} onDone={() => {}} />
      </Provider>,
    );

    await waitFor(() => expect(screen.getByText(/Existing/i)).toBeTruthy());
    expect(screen.getAllByText("beta gamma").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Proposed/i)[0].parentElement?.textContent).toContain("alpha");
    expect(screen.getByText(/Already on span/i).parentElement?.textContent).toContain("known");
    expect(screen.getByText(/Newly proposed/i).parentElement?.textContent).toContain("new-tag");
  });

  it("renders a clear new span label", async () => {
    aiRunGet.mockResolvedValue({ interviewId: 7 });
    segmentListForInterview.mockResolvedValue([]);
    spanListForInterview.mockResolvedValue([]);
    codebookTree.mockResolvedValue({ clusters: [], standaloneCategories: [], standaloneTags: [] });

    const proposal: ProposalDTO = {
      id: 3,
      aiRunId: 1,
      kind: "pretag",
      status: "pending",
      createdAt: "now",
      decidedAt: null,
      payload: {
        suggestions: [
          {
            kind: "new_span",
            segment_id: 1,
            start_offset: 0,
            end_offset: 4,
            tag_names: ["known"],
          },
        ],
      },
    };

    render(
      <Provider>
        <SpanProposalView proposal={proposal} onDone={() => {}} />
      </Provider>,
    );

    expect(
      screen.getAllByText((_, element) =>
        element?.textContent?.includes("New span suggestion") ?? false,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("applies an extension proposal through aiProposalAccept", async () => {
    aiRunGet.mockResolvedValue({ interviewId: 7 });
    segmentListForInterview.mockResolvedValue([]);
    spanListForInterview.mockResolvedValue([]);
    codebookTree.mockResolvedValue({ clusters: [], standaloneCategories: [], standaloneTags: [] });
    aiProposalAccept.mockResolvedValue({ created_count: 1, skipped: [] });
    const onAccepted = vi.fn();

    const proposal: ProposalDTO = {
      id: 2,
      aiRunId: 1,
      kind: "pretag",
      status: "pending",
      createdAt: "now",
      decidedAt: null,
      payload: {
        suggestions: [
          {
            kind: "extend_span",
            existing_span_id: 10,
            segment_id: 1,
            start_offset: 0,
            end_offset: 22,
            tag_names: ["known"],
          },
        ],
      },
    };

    render(
      <Provider>
        <SpanProposalView proposal={proposal} onAccepted={onAccepted} onDone={() => {}} />
      </Provider>,
    );

    fireEvent.click(await screen.findByText("ai.accept"));
    await waitFor(() => expect(aiProposalAccept).toHaveBeenCalledWith(2, { span_indices: [0] }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
  });
});
