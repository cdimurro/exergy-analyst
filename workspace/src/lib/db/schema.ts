/**
 * Database schema — Drizzle ORM with Neon Postgres.
 *
 * Stores: user profiles, project metadata, subscriptions, usage tracking,
 * memory vault entries. Does NOT store client documents or messages.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";

// ── Users ────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifyToken: varchar("email_verify_token", { length: 255 }),
  accountTier: varchar("account_tier", { length: 20 }).notNull().default("free"), // free | plus | pro
  accountStatus: varchar("account_status", { length: 20 }).notNull().default("active"), // active | suspended | cancelled
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Projects (metadata only — content in local encrypted storage) ──

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 500 }).notNull(),
  domain: varchar("domain", { length: 100 }).notNull().default("general"),
  description: text("description").default(""),
  goal: text("goal").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Subscriptions (Square) ───────────────────────────────────

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  squareCustomerId: varchar("square_customer_id", { length: 255 }),
  squareSubscriptionId: varchar("square_subscription_id", { length: 255 }),
  plan: varchar("plan", { length: 20 }).notNull().default("free"), // free | plus | pro
  status: varchar("status", { length: 20 }).notNull().default("active"), // active | cancelled | past_due
  currentPeriodEnd: timestamp("current_period_end"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Memory Vault (Pro only, encrypted at rest) ───────────────

export const memoryVaultEntries = pgTable("memory_vault_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  key: varchar("key", { length: 255 }).notNull(),
  valueEncrypted: text("value_encrypted").notNull(), // AES-256-GCM encrypted
  category: varchar("category", { length: 100 }).notNull().default("custom"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Usage Tracking ───────────────────────────────────────────

export const usageTracking = pgTable("usage_tracking", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  actionType: varchar("action_type", { length: 100 }).notNull(), // chat_message | analysis | brief | extraction
  projectId: uuid("project_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
