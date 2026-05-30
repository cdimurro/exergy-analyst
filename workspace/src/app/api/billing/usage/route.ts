/**
 * Billing usage API — returns action counts for the current billing period.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUsageToday } from "@/lib/usage";
import { isDatabaseAvailable } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDatabaseAvailable()) {
    return NextResponse.json({
      chat_messages: 0,
      analyses: 0,
      briefs: 0,
      extractions: 0,
      projects: 0,
    });
  }

  try {
    const usage = await getUsageToday(session.user.id);
    return NextResponse.json({
      chat_messages: usage.chat_message || 0,
      analyses: usage.analysis || 0,
      briefs: usage.brief || 0,
      extractions: usage.extraction || 0,
      projects: usage.project_create || 0,
    });
  } catch {
    return NextResponse.json({
      chat_messages: 0,
      analyses: 0,
      briefs: 0,
      extractions: 0,
      projects: 0,
    });
  }
}
