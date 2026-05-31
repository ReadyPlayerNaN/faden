import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import { SuggestionReviewPopover } from "./SuggestionReviewPopover";
import { activeSuggestionReviewAtom } from "../../../state/ai";
import { activeTextSelectionAtom } from "../../../state/tagging";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key }),
}));

vi.mock("../../../ipc/ai", () => ({
  aiProposalAccept: vi.fn(),
  aiProposalList: vi.fn(),
  aiProposalReject: vi.fn(),
}));

vi.mock("../../../ipc/codebook", () => ({
  codebookTree: vi.fn(),
}));

const Hydrate = ({ children }: { children: React.ReactNode }) => {
  useHydrateAtoms([
    [
      activeSuggestionReviewAtom,
      {
        proposalId: 1,
        proposalKind: "pretag" as const,
        interviewId: 7,
        currentIndex: 0,
        decisions: [null],
        suggestions: [
          {
            kind: "extend_span" as const,
            existingSpanId: 10,
            segmentId: 1,
            startOffset: 0,
            endOffset: 22,
            tagNames: ["known"],
            rationale: "extend it",
          },
        ],
      },
    ],
    [
      activeTextSelectionAtom,
      {
        segmentId: 1,
        startOffset: 0,
        endOffset: 22,
        text: "alpha beta gamma delta",
        anchorRect: { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10, x: 0, y: 0, toJSON: () => ({}) },
      },
    ],
  ]);
  return <>{children}</>;
};

describe("SuggestionReviewPopover", () => {
  it("labels extension suggestions in review UI", () => {
    render(
      <Provider>
        <Hydrate>
          <SuggestionReviewPopover />
        </Hydrate>
      </Provider>,
    );

    expect(screen.getByText("Extend existing span")).toBeTruthy();
    expect(screen.getByText("alpha beta gamma delta")).toBeTruthy();
  });

  it("closes on Escape", () => {
    render(
      <Provider>
        <Hydrate>
          <SuggestionReviewPopover />
        </Hydrate>
      </Provider>,
    );

    expect(screen.getByText("Extend existing span")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Extend existing span")).toBeNull();
  });

  it("closes from the Cancel button", () => {
    render(
      <Provider>
        <Hydrate>
          <SuggestionReviewPopover />
        </Hydrate>
      </Provider>,
    );

    expect(screen.getByText("Extend existing span")).toBeTruthy();
    fireEvent.pointerDown(screen.getByText("common.cancel"));
    expect(screen.queryByText("Extend existing span")).toBeNull();
  });
});
