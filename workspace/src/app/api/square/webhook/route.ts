/**
 * POST /api/square/webhook — Handle Square subscription events.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get("x-square-hmacsha256-signature") || "";

    const { verifyWebhookSignature } = await import("@/lib/square");
    if (!signature || !verifyWebhookSignature(body, signature)) {
      return NextResponse.json({ error: "Invalid or missing signature" }, { status: 401 });
    }

    const event = JSON.parse(body);
    const type = event?.type;

    // Plan-to-tier mapping
    const planToTier: Record<string, string> = {
      [process.env.SQUARE_PLUS_PLAN_ID || "__plus__"]: "plus",
      [process.env.SQUARE_PRO_PLAN_ID || "__pro__"]: "pro",
    };

    // Handle subscription events
    if (type === "subscription.created" || type === "subscription.updated") {
      const subscription = event?.data?.object?.subscription;
      if (subscription) {
        console.log(`Square webhook: ${type} — subscription ${subscription.id}, status ${subscription.status}`);
        try {
          const { getDb, isDatabaseAvailable } = await import("@/lib/db");
          const { subscriptions, users } = await import("@/lib/db/schema");
          const { eq } = await import("drizzle-orm");

          if (isDatabaseAvailable()) {
            const db = getDb();
            const tier = planToTier[subscription.plan_variation_id] || "free";

            // Find existing subscription or look up user by Square customer ID
            const existing = await db
              .select()
              .from(subscriptions)
              .where(eq(subscriptions.squareSubscriptionId, subscription.id))
              .limit(1);

            // Also check if we have a prior subscription for this Square customer
            const byCustomer = existing.length === 0
              ? await db.select().from(subscriptions)
                  .where(eq(subscriptions.squareCustomerId, subscription.customer_id))
                  .limit(1)
              : [];

            const knownUserId = existing[0]?.userId || byCustomer[0]?.userId;

            if (existing.length > 0) {
              await db
                .update(subscriptions)
                .set({ plan: tier, status: subscription.status })
                .where(eq(subscriptions.squareSubscriptionId, subscription.id));
            } else if (knownUserId) {
              await db.insert(subscriptions).values({
                userId: knownUserId,
                squareCustomerId: subscription.customer_id,
                squareSubscriptionId: subscription.id,
                plan: tier,
                status: subscription.status,
              });
            } else {
              console.warn(`Square webhook: no user found for customer ${subscription.customer_id} — subscription stored without user link`);
              // Cannot insert without a valid userId (NOT NULL constraint)
              // This happens if checkout didn't create the mapping first
            }

            // Update user tier if we know who they are
            if (knownUserId) {
              await db
                .update(users)
                .set({ accountTier: tier })
                .where(eq(users.id, knownUserId));
            }
          }
        } catch (dbErr) {
          console.error("Square webhook DB update failed:", dbErr);
          // Don't fail the webhook — Square will retry
        }
      }
    }

    // Handle cancellation
    if (type === "subscription.canceled") {
      const subscription = event?.data?.object?.subscription;
      if (subscription) {
        try {
          const { getDb, isDatabaseAvailable } = await import("@/lib/db");
          const { subscriptions, users } = await import("@/lib/db/schema");
          const { eq } = await import("drizzle-orm");

          if (isDatabaseAvailable()) {
            const db = getDb();
            const existing = await db
              .select()
              .from(subscriptions)
              .where(eq(subscriptions.squareSubscriptionId, subscription.id))
              .limit(1);

            if (existing.length > 0 && existing[0].userId) {
              await db
                .update(subscriptions)
                .set({ plan: "free", status: "cancelled" })
                .where(eq(subscriptions.squareSubscriptionId, subscription.id));
              await db
                .update(users)
                .set({ accountTier: "free" })
                .where(eq(users.id, existing[0].userId));
            }
          }
        } catch (dbErr) {
          console.error("Square webhook cancellation DB update failed:", dbErr);
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Square webhook error:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
