/**
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { AgentThinkingPanel } from "../AgentThinkingPanel";

describe("AgentThinkingPanel", () => {
  it("renders the execution plan and visible activity timeline", () => {
    render(
      <AgentThinkingPanel
        title="Completed Process"
        plan={[
          {
            step: 1,
            title: "Extract Document Data",
            description: "Read uploaded files and extract useful parameters.",
            action_type: "document_analysis",
            status: "done",
          },
        ]}
        events={[
          {
            id: "evt_1",
            title: "Extract Document Data complete",
            detail: "The document was parsed and summarized.",
            status: "done",
            actionType: "document_analysis",
            timestamp: "2026-05-24T12:00:00.000Z",
            durationMs: 1500,
            artifactTitle: "Document Analysis",
          },
        ]}
      />,
    );

    expect(screen.getByText("Completed Process")).toBeInTheDocument();
    expect(screen.getByText("Execution Plan")).toBeInTheDocument();
    expect(screen.getAllByText("Extract Document Data").length).toBeGreaterThan(0);
    expect(screen.getByText("Activity Timeline")).toBeInTheDocument();
    expect(screen.getByText("The document was parsed and summarized.")).toBeInTheDocument();
    expect(screen.getByText("Document Analysis")).toBeInTheDocument();
  });

  it("handles responses without recorded events", () => {
    render(<AgentThinkingPanel events={[]} plan={[]} />);

    expect(screen.getByText("No process events were recorded for this response.")).toBeInTheDocument();
  });
});
