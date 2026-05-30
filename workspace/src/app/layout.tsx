import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/layout/Providers";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

// Hide navbar/footer only when explicitly running a pre-launch splash.
const PRE_LAUNCH = process.env.NEXT_PUBLIC_PRE_LAUNCH === "true";

export const metadata: Metadata = {
  title: "Exergy Lab — Powerful Agent for Deep Tech Challenges",
  description: "A powerful, scientifically rigorous agent for turning messy energy evidence into clearer models, generated briefs, and better next moves.",
  icons: { icon: "/favicon.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased min-h-screen flex flex-col">
        <Providers>
          {!PRE_LAUNCH && <Navbar />}
          <main className="flex-1">{children}</main>
          {!PRE_LAUNCH && <Footer />}
        </Providers>
      </body>
    </html>
  );
}
