/**
 * GET /api/auth/verify-email?token=xxx — Verify email address.
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Verification token required" }, { status: 400 });
    }

    const { isDatabaseAvailable, getDb } = await import("@/lib/db");
    if (!isDatabaseAvailable()) {
      return NextResponse.json({ error: "Not available" }, { status: 503 });
    }

    const { users } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDb();

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.emailVerifyToken, token))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "Invalid or expired verification token" }, { status: 400 });
    }

    if (user.emailVerified) {
      return NextResponse.redirect(new URL("/login?verified=true", req.url));
    }

    await db
      .update(users)
      .set({ emailVerified: true, emailVerifyToken: null })
      .where(eq(users.id, user.id));

    // Send welcome email (non-blocking — don't delay the redirect)
    try {
      const { sendWelcomeEmail } = await import("@/lib/email");
      sendWelcomeEmail(user.email, user.name || "there").catch(() => {});
    } catch {}

    return NextResponse.redirect(new URL("/login?verified=true", req.url));
  } catch (err) {
    console.error("Email verification error:", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
