"use client";

import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      // Refetch session every 5 minutes, but don't crash if auth is unavailable
      refetchInterval={300}
      refetchOnWindowFocus={false}
    >
      {children}
    </SessionProvider>
  );
}
