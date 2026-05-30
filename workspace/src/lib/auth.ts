/**
 * Auth.js v5 configuration — email + password authentication.
 *
 * Session strategy: JWT with httpOnly cookies (30-day persistent).
 * All pages are public. Auth is optional. Feature gating at API level.
 *
 * IMPORTANT: No database imports at the top level. All DB access is
 * inside the authorize() callback so the app works without DATABASE_URL.
 */

import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getEnvVar } from "@/lib/backend";

const authSecret =
  getEnvVar("AUTH_SECRET") ||
  getEnvVar("NEXTAUTH_SECRET") ||
  (process.env.NODE_ENV !== "production"
    ? "exergy-lab-local-dev-auth-secret-do-not-use-in-production"
    : undefined);

export const {
  handlers,
  signIn,
  signOut,
  auth,
} = NextAuth({
  secret: authSecret,
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          // Dynamic imports — app works without DATABASE_URL
          const { getDb } = await import("@/lib/db");
          const { users } = await import("@/lib/db/schema");
          const { eq } = await import("drizzle-orm");
          const bcrypt = await import("bcryptjs");
          const db = getDb();

          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.email, credentials.email as string))
            .limit(1);

          if (!user) return null;
          if (!user.emailVerified) return null;

          const valid = await bcrypt.compare(
            credentials.password as string,
            user.passwordHash,
          );
          if (!valid) return null;

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            tier: user.accountTier,
          };
        } catch {
          // Database not available — auth disabled gracefully
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  cookies: {
    sessionToken: {
      name: "exergy-session",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 24 * 60 * 60,
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tier = (user as any).tier || "free";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).tier = token.tier || "free";
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    newUser: "/signup",
  },
  trustHost: true,
});

/**
 * Get the current session (returns null if not logged in or auth unavailable).
 */
export async function getSession() {
  try {
    return await auth();
  } catch {
    return null;
  }
}

/**
 * Get user ID from session (returns null if not logged in).
 */
export async function getUserId(): Promise<string | null> {
  const session = await getSession();
  return (session?.user as any)?.id || null;
}

/**
 * Get user tier from session (returns "anonymous" if not logged in).
 */
export async function getUserTier(): Promise<string> {
  const session = await getSession();
  return (session?.user as any)?.tier || "anonymous";
}
