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
  "Analyzing the attached evidence now. I am checking what can be computed, what remains uncertain, and which data would improve confidence.";

function cleanAck(value: string): string {
  const cleaned = value.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Reading the request and workspace context.";
  if (!/[.!?]$/.test(cleaned)) return "Reading the request and workspace context.";
  if (/\b(to|and|or|with|for|the|a|an)$/i.test(cleaned)) return "Reading the request and workspace context.";
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
      return NextResponse.json({ ack: "Reading the request and workspace context." });
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

    return NextResponse.json({ ack: cleanAck(ack) });
  } catch {
    // Non-fatal — frontend falls back to hardcoded ack
    return NextResponse.json({ ack: "Reading the request and workspace context." });
  }
}
