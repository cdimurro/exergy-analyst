import { NextResponse } from "next/server";
import { callGemma4 } from "@/lib/backend";

/**
 * Lightweight warm-up endpoint — sends a minimal request to Gemma 4
 * so the API connection is hot by the time the user sends their first message.
 * Called from the homepage on page load.
 */
export async function GET() {
  try {
    await callGemma4(
      [{ role: "user", content: "Reply with OK" }],
      { temperature: 0, maxTokens: 4 },
    );
    return NextResponse.json({ status: "warm" });
  } catch {
    return NextResponse.json({ status: "cold" }, { status: 200 });
  }
}
