/**
 * POST /api/auth/signup — Create a new user account.
 *
 * Hashes password, creates user, sends verification email.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json();

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }

    const { isDatabaseAvailable } = await import("@/lib/db");
    if (!isDatabaseAvailable()) {
      return NextResponse.json(
        { error: "Account creation is not available in local development mode" },
        { status: 503 },
      );
    }

    const { getDb } = await import("@/lib/db");
    const { users } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDb();

    // Check if user already exists
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken = randomBytes(32).toString("hex");

    // Create user
    const [user] = await db
      .insert(users)
      .values({
        email: email.toLowerCase().trim(),
        name: name.trim(),
        passwordHash,
        emailVerifyToken: verifyToken,
        emailVerified: false,
        accountTier: "free",
        accountStatus: "active",
      })
      .returning({ id: users.id, email: users.email });

    // Send verification email
    try {
      const { sendVerificationEmail } = await import("@/lib/email");
      await sendVerificationEmail(user.email, verifyToken, name.trim());
    } catch (emailErr) {
      // Don't fail signup if email fails — user can request resend
      console.warn("Failed to send verification email:", emailErr);
    }

    return NextResponse.json({
      success: true,
      message: "Account created. Please check your email to verify your account.",
    });
  } catch (err) {
    console.error("Signup error:", err);
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 },
    );
  }
}
