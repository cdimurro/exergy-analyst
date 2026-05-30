/**
 * Square payments — subscription management.
 *
 * Handles checkout session creation, webhook processing,
 * and customer portal redirects for Plus ($19/mo) and Pro ($99/mo).
 */

import { SquareClient, SquareEnvironment } from "square";

function getClient(): SquareClient | null {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) return null;

  return new SquareClient({
    token,
    environment:
      process.env.NODE_ENV === "production"
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  });
}

/**
 * Plan IDs — set these from Square Dashboard catalog IDs.
 */
export const PLAN_IDS = {
  plus: process.env.SQUARE_PLUS_PLAN_ID || "",
  pro: process.env.SQUARE_PRO_PLAN_ID || "",
};

/**
 * Create a Square checkout link for a subscription.
 */
export async function createCheckoutLink(
  plan: "plus" | "pro",
  customerEmail: string,
  userId: string,
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const planId = PLAN_IDS[plan];
  if (!planId) return null;

  try {
    const result = await client.subscriptions.create({
      locationId: process.env.SQUARE_LOCATION_ID || "",
      planVariationId: planId,
      customerId: "", // Will be created via Square
      idempotencyKey: `${userId}-${plan}-${Date.now()}`,
    });

    return result.subscription?.id || null;
  } catch (err) {
    console.error("Square checkout error:", err);
    return null;
  }
}

/**
 * Verify a Square webhook signature.
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
): boolean {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key) return false;

  try {
    const crypto = require("crypto");
    const hmac = crypto.createHmac("sha256", key);
    hmac.update(body);
    const expected = hmac.digest("base64");
    return signature === expected;
  } catch {
    return false;
  }
}

/**
 * Check if Square is configured.
 */
export function isSquareConfigured(): boolean {
  return !!(
    process.env.SQUARE_ACCESS_TOKEN &&
    process.env.SQUARE_LOCATION_ID
  );
}
