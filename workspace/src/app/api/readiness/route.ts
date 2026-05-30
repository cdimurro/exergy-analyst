import { NextResponse } from "next/server";
import { buildEnvironmentReadiness } from "@/lib/environment-readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(buildEnvironmentReadiness());
}
