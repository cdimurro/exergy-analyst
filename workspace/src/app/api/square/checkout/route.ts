/**
 * POST /api/square/checkout — Create a subscription checkout.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { plan } = await req.json();

    if (!plan || !["plus", "pro"].includes(plan)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const { isSquareConfigured } = await import("@/lib/square");
    if (!isSquareConfigured()) {
      return NextResponse.json(
        { error: "Payment processing is not configured yet. Please check back soon." },
        { status: 503 },
      );
    }

    // Get user session
    const { getUserId } = await import("@/lib/auth");
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sign in required to upgrade" }, { status: 401 });
    }

    const { createCheckoutLink } = await import("@/lib/square");
    const subscriptionId = await createCheckoutLink(plan, "", userId);

    if (!subscriptionId) {
      return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }

    // Pre-link: store subscription record with user ID so webhook can find them
    try {
      const { getDb, isDatabaseAvailable } = await import("@/lib/db");
      const { subscriptions } = await import("@/lib/db/schema");
      if (isDatabaseAvailable()) {
        const db = getDb();
        await db.insert(subscriptions).values({
          userId,
          squareSubscriptionId: subscriptionId,
          plan,
          status: "pending", // Will be updated to "active" by webhook
        });
      }
    } catch (dbErr) {
      // Non-fatal: webhook will still work via squareCustomerId lookup
      console.warn("Failed to pre-link subscription:", dbErr);
    }

    return NextResponse.json({ subscriptionId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Checkout failed" },
      { status: 500 },
    );
  }
}
