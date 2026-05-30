/**
 * POST /api/projects/[id]/report — Generate professional PDF assessment report.
 *
 * Pipeline:
 *   1. Load the most recent evaluation artifact with a brief
 *   2. Call DeepSeek V4 Flash (4 parallel calls) to generate report narratives
 *   3. Render PDF via @react-pdf/renderer
 *   4. Return binary PDF with Content-Disposition attachment header
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import React from "react";
import { getStorage } from "@/lib/storage";
import { isBriefPayload } from "@/lib/brief-types";
import type { DeviceDecisionBrief } from "@/lib/brief-types";
import { generateReportNarratives } from "@/lib/pdf/generate-narratives";
import { getEnvVar } from "@/lib/backend";
import type { Artifact } from "@/lib/storage/types";

export const runtime = "nodejs";
export const maxDuration = 90;

function workspaceMarkdownReport(artifact: Artifact | null): { title: string; markdown: string } | null {
  const content = artifact?.content as Record<string, unknown> | undefined;
  const markdown = typeof content?.report_markdown === "string" ? content.report_markdown.trim() : "";
  if (!markdown || markdown.length < 80) return null;
  return {
    title: artifact?.title || "Workspace Analysis Report",
    markdown,
  };
}

function plainTextFromMarkdown(markdown: string): string[] {
  return markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .slice(0, 900)
    .map((line) => line
      .replace(/^#{1,6}\s*/, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[[^\]]*]\([^)]*\)/g, "")
      .trimEnd());
}

async function renderMarkdownReportPdf(
  markdown: string,
  args: { projectName: string; title: string },
): Promise<NextResponse> {
  const { Document, Page, Text, View, StyleSheet, renderToBuffer } = await import("@react-pdf/renderer");
  const generatedDate = new Date().toISOString().split("T")[0];
  const lines = plainTextFromMarkdown(markdown);
  const styles = StyleSheet.create({
    page: { padding: 36, fontSize: 9, color: "#111827", fontFamily: "Helvetica", lineHeight: 1.35 },
    header: { marginBottom: 18, borderBottomWidth: 1, borderBottomColor: "#E5E7EB", paddingBottom: 10 },
    title: { fontSize: 16, fontWeight: 700, marginBottom: 4 },
    meta: { fontSize: 8, color: "#6B7280" },
    body: { gap: 3 },
    line: { marginBottom: 2 },
    heading: { fontSize: 12, fontWeight: 700, marginTop: 10, marginBottom: 4 },
    table: { fontSize: 7, fontFamily: "Courier", color: "#374151" },
  });
  const children = lines.map((line, index) => {
    const isHeading = /^#{1,6}\s+/.test(markdown.split(/\r?\n/)[index] || "");
    const isTable = line.trim().startsWith("|");
    return React.createElement(Text, {
      key: index,
      style: isHeading ? styles.heading : isTable ? styles.table : styles.line,
    }, line || " ");
  });
  const pdfBuffer = await renderToBuffer(
    React.createElement(Document, null,
      React.createElement(Page, { size: "LETTER", style: styles.page, wrap: true },
        React.createElement(View, { style: styles.header },
          React.createElement(Text, { style: styles.title }, args.title),
          React.createElement(Text, { style: styles.meta }, `${args.projectName} | Generated ${generatedDate}`),
        ),
        React.createElement(View, { style: styles.body }, ...children),
      ),
    ) as any,
  );
  const filename = `${(args.projectName || "Workspace_Report").replace(/[^a-z0-9]/gi, "_")}_Report.pdf`;
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const storage = getStorage();

  // 1. Load project
  const project = await storage.getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // 1a. Optional: per-artifact scoping. When the client knows which analysis
  //     the user is exporting (e.g. the canvas they opened via "View Details"),
  //     it passes { artifact_id } so we render THAT artifact's brief rather
  //     than silently falling back to the newest evaluation.
  //
  //     artifact_id is client-supplied; enforce an allow-list shape (the IDs
  //     the storage layer emits are short alphanumeric/underscore/hyphen)
  //     before it reaches the storage layer to avoid IDOR/injection paths.
  const ARTIFACT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  let requestedArtifactId: string | undefined;
  try {
    const body = await request.json();
    if (body && typeof body === "object" && typeof body.artifact_id === "string") {
      const candidate = body.artifact_id;
      if (!ARTIFACT_ID_RE.test(candidate)) {
        return NextResponse.json(
          { error: "Invalid artifact_id format." },
          { status: 400 },
        );
      }
      requestedArtifactId = candidate;
    }
  } catch (err) {
    // Missing/non-JSON body is expected (legacy callers post no body) — fall
    // through to most-recent-evaluation. Anything else is an unexpected
    // client/server fault we want visibility into.
    if (!(err instanceof SyntaxError)) {
      console.error("[report] unexpected error parsing request body:", err);
    }
  }

  let brief: DeviceDecisionBrief | null = null;
  let content: Record<string, unknown> | undefined;
  let markdownReport: { title: string; markdown: string } | null = null;

  if (requestedArtifactId) {
    const artifact = await storage.getArtifact(id, requestedArtifactId);
    content = artifact?.content as Record<string, unknown> | undefined;
    const candidateBrief = content?.brief as DeviceDecisionBrief | null;
    if (candidateBrief && isBriefPayload(candidateBrief)) {
      brief = candidateBrief;
    } else {
      const candidateMarkdown = workspaceMarkdownReport(artifact || null);
      if (candidateMarkdown) {
        markdownReport = candidateMarkdown;
      }
    }
    if (!brief && !markdownReport) {
      return NextResponse.json(
        { error: "This analysis does not contain a reportable assessment brief or workspace report." },
        { status: 404 },
      );
    }
  } else {
    // 2. Find the most recent reportable artifact. Prefer formal evaluation
    // briefs, then fall back to workspace_run report_markdown so custom agent
    // analyses can still be exported.
    const artifactSummaries = await storage.listArtifacts(id);
    const sortedSummaries = artifactSummaries
      .sort((a: { created_at: string }, b: { created_at: string }) =>
        b.created_at.localeCompare(a.created_at),
      );

    for (const summary of sortedSummaries.filter((a: { type: string }) => a.type === "evaluation")) {
      const artifact = await storage.getArtifact(id, summary.id);
      content = artifact?.content as Record<string, unknown> | undefined;
      const candidateBrief = content?.brief as DeviceDecisionBrief | null;
      if (candidateBrief && isBriefPayload(candidateBrief)) {
        brief = candidateBrief;
        break;
      }
    }

    if (!brief) {
      for (const summary of sortedSummaries) {
        const artifact = await storage.getArtifact(id, summary.id);
        const candidateMarkdown = workspaceMarkdownReport(artifact);
        if (candidateMarkdown) {
          markdownReport = candidateMarkdown;
          content = artifact?.content as Record<string, unknown> | undefined;
          break;
        }
      }
    }

    if (!brief && !markdownReport) {
      return NextResponse.json(
        { error: "No reportable analysis found. Run an analysis first." },
        { status: 404 },
      );
    }
  }

  if (markdownReport && !brief) {
    return renderMarkdownReportPdf(markdownReport.markdown, {
      projectName: project.name,
      title: markdownReport.title,
    });
  }

  if (!brief) {
    return NextResponse.json(
      { error: "No assessment brief available. Please re-run the evaluation." },
      { status: 404 },
    );
  }

  // 3. Load logo as base64
  let logoSrc: string;
  try {
    const logoPath = join(process.cwd(), "public", "exergy-lab-logo.png");
    const logoBuffer = await readFile(logoPath);
    logoSrc = `data:image/png;base64,${logoBuffer.toString("base64")}`;
  } catch {
    // Fallback: 1x1 transparent pixel if logo missing
    logoSrc = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  }

  // 4. Check for required narrative model key
  if (!getEnvVar("DEEPSEEK_API_KEY") && !getEnvVar("DEEPSEEK_V3_API_KEY")) {
    return NextResponse.json(
      { error: "PDF generation requires DEEPSEEK_API_KEY. Set it in your environment." },
      { status: 500 },
    );
  }

  // 5. Generate narratives + render PDF (wrapped in try/catch for reliability)
  try {
    const narratives = await generateReportNarratives(brief, {
      name: project.name,
      goal: (project as unknown as Record<string, unknown>).goal as string | undefined,
      domain: (project as unknown as Record<string, unknown>).domain as string | undefined,
    });

    // 5. Render PDF
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { ReportDocument } = await import("@/lib/pdf/ReportDocument");

    const generatedDate = new Date().toISOString().split("T")[0];

    const pdfBuffer = await renderToBuffer(
      React.createElement(ReportDocument, {
        brief,
        narratives,
        projectName: project.name,
        generatedDate,
        logoSrc,
        evaluation: content || undefined,
      }) as any,
    );

    // 6. Return PDF
    const deviceName = brief.commercial_name || brief.device_id || project.name;
    const filename = `${deviceName.replace(/[^a-z0-9]/gi, "_")}_Assessment_Report.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to generate PDF report. Please try again.", detail: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
