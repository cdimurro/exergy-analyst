/**
 * Usage tracking — query and record action usage for quota enforcement.
 */

import { getDb, isDatabaseAvailable } from "./db";
import { usageTracking } from "./db/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export async function getUsageToday(
  userId: string
): Promise<Record<string, number>> {
  if (!isDatabaseAvailable()) return {};
  try {
    const db = getDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = await db
      .select({
        actionType: usageTracking.actionType,
        count: sql<number>`count(*)`,
      })
      .from(usageTracking)
      .where(
        and(eq(usageTracking.userId, userId), gte(usageTracking.createdAt, today))
      )
      .groupBy(usageTracking.actionType);
    return Object.fromEntries(rows.map((r) => [r.actionType, Number(r.count)]));
  } catch {
    return {};
  }
}

export async function trackUsage(
  userId: string,
  actionType: string,
  projectId?: string
): Promise<void> {
  if (!isDatabaseAvailable()) return;
  try {
    const db = getDb();
    await db.insert(usageTracking).values({
      userId,
      actionType,
      projectId: projectId || undefined,
    });
  } catch {
    // Non-fatal: don't break the action if tracking fails
  }
}
