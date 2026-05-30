/**
 * Memory Vault API — CRUD for encrypted vault entries (Pro only).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb, isDatabaseAvailable } from "@/lib/db";
import { memoryVaultEntries } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/db/encryption";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDatabaseAvailable()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(memoryVaultEntries)
      .where(eq(memoryVaultEntries.userId, session.user.id))
      .orderBy(memoryVaultEntries.createdAt);

    const entries = rows.map((r) => ({
      id: r.id,
      key: r.key,
      value: decrypt(r.valueEncrypted),
      category: r.category,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return NextResponse.json({ entries });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("ENCRYPTION_KEY")) {
      return NextResponse.json({ error: "Encryption not configured" }, { status: 500 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user as Record<string, unknown>).tier !== "pro") {
    return NextResponse.json({ error: "Memory Vault requires a Pro subscription" }, { status: 403 });
  }
  if (!isDatabaseAvailable()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { key, value, category } = body;

    if (!key || !value) {
      return NextResponse.json({ error: "key and value are required" }, { status: 400 });
    }

    const db = getDb();
    const encrypted = encrypt(value);

    const [entry] = await db
      .insert(memoryVaultEntries)
      .values({
        userId: session.user.id,
        key,
        valueEncrypted: encrypted,
        category: category || "custom",
      })
      .returning();

    return NextResponse.json({ entry: { id: entry.id, key: entry.key, category: entry.category } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("ENCRYPTION_KEY")) {
      return NextResponse.json({ error: "Encryption not configured" }, { status: 500 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDatabaseAvailable()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const db = getDb();
    await db
      .delete(memoryVaultEntries)
      .where(
        and(eq(memoryVaultEntries.id, id), eq(memoryVaultEntries.userId, session.user.id))
      );

    return NextResponse.json({ deleted: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
