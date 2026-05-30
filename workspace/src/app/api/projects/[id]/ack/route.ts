/**
 * Fast acknowledgment endpoint — responds in 2-3 seconds.
 *
 * Uses the cheap text model with minimal context and short max tokens
 * to generate an accurate, context-aware acknowledgment of the user's
 * request. Called in parallel with the full /chat endpoint.
 *
 * The ack tells the user what we understood and what we're about to do,
 * while the full chat call builds the actual plan/action.
 */

import { NextRequest, NextResponse } from "next/server";
import { callGemma4 } from "@/lib/backend";

const FALLBACK_DOCUMENT_ACK =
  "Reading the uploaded evidence now, separating source-backed claims from gaps, and identifying what can be computed from the files.";

function requestSubject(message: string): string {
  const text = message.toLowerCase();
  if (/\b(nmc|lithium|battery|cathode|anode|electrolyte|cycle life)\b/.test(text)) return "battery material readiness";
  if (/\b(waste heat|heat recovery|district heating|thermal|exergy)\b/.test(text)) return "thermal and exergy opportunity";
  if (/\b(capex|opex|npv|irr|lcoe|payback|financial model|economics)\b/.test(text)) return "techno-economic model";
  if (/\b(report|brief|memo|deck|pitch|presentation|spec sheet|schematic)\b/.test(text)) return "deliverable";
  if (/\b(simulation|physics|solver|model|calculation)\b/.test(text)) return "physics calculation";
  if (/\b(research|benchmark|literature|market|competitor)\b/.test(text)) return "research benchmark";
  return "technical request";
}

function fallbackAck(message: string, hasDocuments?: boolean, agentMode?: "plan" | "implement"): string {
  const subject = requestSubject(message);
  if (hasDocuments) {
    return agentMode === "plan"
      ? `Drafting a grounded plan for the uploaded ${subject} evidence and holding execution for approval.`
      : FALLBACK_DOCUMENT_ACK;
  }
  return agentMode === "plan"
    ? `Drafting a plan for the ${subject} and holding execution for approval.`
    : `Starting the ${subject} from the prompt and project history.`;
}

function cleanAck(value: string): string {
  const cleaned = value.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (!/[.!?]$/.test(cleaned)) return "";
  if (/\b(to|and|or|with|for|the|a|an)$/i.test(cleaned)) return "";
  return cleaned;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = await request.json();
    const { message, domain, hasDocuments, agentMode } = body as {
      message: string;
      domain?: string;
      hasDocuments?: boolean;
      agentMode?: "plan" | "implement";
    };

    if (!message) {
      return NextResponse.json({ ack: "Starting from the current project context." });
    }

    if (hasDocuments) {
      return NextResponse.json({
        ack: agentMode === "plan"
          ? "Drafting a grounded plan for the attached evidence. I will hold execution until you approve it."
          : FALLBACK_DOCUMENT_ACK,
      });
    }

    const domainLabel = domain && domain !== "general"
      ? domain.replace(/_/g, " ")
      : "";

    const prompt = `You are a concise energy technology analyst. The user just sent a message${hasDocuments ? " with attached documents" : ""}${domainLabel ? ` about ${domainLabel}` : ""}.

Respond with exactly 1-2 sentences acknowledging their request and briefly describing what you will do. Be specific about their actual request — don't be generic. Don't ask questions. Don't use phrases like "I'll" or "Let me" — use active present tense ("Analyzing...", "Building...", "Running..."). ${agentMode === "plan" ? "The UI is in Plan mode, so say you are drafting a plan and will hold execution for approval." : "The UI is in Implement mode, so say you are starting the work."}

User message: "${message.slice(0, 500)}"

Your 1-2 sentence acknowledgment:`;

    const ack = await callGemma4(
      [
        { role: "user", content: prompt },
      ],
      {
        temperature: 0.3,
        maxTokens: 150,
      },
    );

    return NextResponse.json({ ack: cleanAck(ack) || fallbackAck(message, hasDocuments, agentMode) });
  } catch {
    // Non-fatal — frontend falls back to hardcoded ack
    return NextResponse.json({ ack: "Starting from the prompt and project history." });
  }
}
