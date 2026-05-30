import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Pre-launch mode: only the coming soon page and the Exergy Imperative
// blog post are accessible. Everything else redirects to /landing.
// Remove this file (or flip the flag) when you're ready to go live.
const PRE_LAUNCH = false;

const ALLOWED_PREFIXES = [
  "/landing",
  "/blog/the-exergy-imperative",
  "/api",
  "/_next",
  "/favicon",
  "/images",
  "/logo",
];

export function middleware(request: NextRequest) {
  if (!PRE_LAUNCH) return NextResponse.next();

  const { pathname } = request.nextUrl;

  // Allow static assets and allowed pages
  if (
    ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    pathname.match(/\.\w+$/) // static files (.png, .ico, .js, .css, etc.)
  ) {
    return NextResponse.next();
  }

  // Rewrite root to landing (keeps URL clean)
  if (pathname === "/") {
    return NextResponse.rewrite(new URL("/landing", request.url));
  }

  // Everything else redirects to landing
  return NextResponse.redirect(new URL("/landing", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
