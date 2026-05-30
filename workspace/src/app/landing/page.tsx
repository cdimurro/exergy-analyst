import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Exergy Lab — Coming Soon",
  description:
    "A platform for discovering and validating energy innovations. Purpose-built for scientists, engineers, researchers, founders and investors. Free for anyone working to advance clean energy.",
};

export default function LandingPage() {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-[#0b0e1a]">
      {/* Subtle radial glow */}
      <div
        className="pointer-events-none absolute top-[-20%] left-1/2 -translate-x-1/2 w-[900px] h-[500px]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(77,184,164,0.06) 0%, rgba(91,141,217,0.04) 40%, transparent 70%)",
          filter: "blur(80px)",
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-2xl">
        {/* Logo */}
        <Image
          src="/images/exergy-lab-logo-white.png"
          alt="Exergy Lab"
          width={260}
          height={60}
          priority
          className="mb-12 select-none"
        />

        {/* Headline */}
        <h1 className="text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-tight tracking-[-0.02em] text-[var(--text-primary)] mb-5">
          Coming Soon
        </h1>

        {/* Subheading */}
        <p className="text-[var(--text-secondary)] text-lg leading-relaxed max-w-lg mb-4">
          A platform for discovering and validating energy innovations.
          Purpose-built for scientists, engineers, researchers, founders and investors.
        </p>
        <p className="text-[var(--text-muted)] text-base leading-relaxed max-w-md mb-12">
          Free for anyone to use to advance clean energy solutions.
        </p>

        {/* Divider */}
        <div className="w-16 h-px bg-[var(--border-mid)] mb-10" />

        {/* Links */}
        <div className="flex flex-col sm:flex-row items-center gap-4 text-sm">
          <a
            href="https://github.com/cdimurro/the-exergy-imperative"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 rounded-lg border border-[var(--border-mid)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-light)] transition-colors"
          >
            Read The Exergy Imperative
          </a>
        </div>
      </div>

      {/* Bottom accent line */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent" />
    </div>
  );
}
