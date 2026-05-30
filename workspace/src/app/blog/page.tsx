import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog — Exergy Lab",
  description: "Insights, open-source guides, and lessons learned from building a platform for energy technology validation.",
};

const POSTS = [
  {
    slug: "the-exergy-imperative",
    title: "The Exergy Imperative",
    subtitle: "Why We Built Our Platform Around Exergy, Not Just Energy",
    date: "March 2026",
    description:
      "The global energy system runs on a lie of omission: it treats every joule as interchangeable. Exergy is the concept that reveals what's actually being wasted — and why it matters for the energy transition.",
    tag: "Open Source",
    image: "/images/feature-industrial.jpg",
  },
  {
    slug: "why-all-joules-are-not-equal",
    title: "Why All Joules Are Not Equal",
    subtitle: "The distinction between energy quantity and energy quality",
    date: "March 2026",
    description:
      "A joule of electricity and a joule of lukewarm bathwater contain the same amount of energy. But one can run a motor, split water into hydrogen, and power a city. The other can do almost nothing. Understanding this distinction changes how we evaluate every energy technology.",
    tag: "Fundamentals",
    image: "/blog/combustion.jpg",
  },
  {
    slug: "what-is-exergy-matching",
    title: "What Is Exergy Matching and Why Is It Important?",
    subtitle: "The principle of aligning energy quality to task requirements",
    date: "March 2026",
    description:
      "Burning natural gas at 2,000°C to heat a room to 22°C is the thermodynamic equivalent of using a fire hose to fill a teacup. Exergy matching is the principle that reveals this waste — and shows how to fix it.",
    tag: "Deep Dive",
    image: "/images/feature-grid.jpg",
  },
  {
    slug: "exergy-changes-evaluation",
    title: "How Exergy Changes the Way We Evaluate Energy Technologies",
    subtitle: "Why conventional efficiency metrics can be dangerously misleading",
    date: "March 2026",
    description:
      "A 95% efficient gas boiler is actually 6% efficient by the metric that matters. A heat pump with a COP of 3.5 is five to seven times better. Exergy-aware evaluation reveals truths that conventional analysis hides — and changes which technologies look like winners.",
    tag: "Analysis",
    image: "/images/feature-solar.jpg",
  },
  {
    slug: "exergy-and-better-investments",
    title: "Can Measuring Exergy Help Us Make Better Investments?",
    subtitle: "The thermodynamic dimension most energy investors have never heard of",
    date: "March 2026",
    description:
      "Financial models cannot see thermodynamic quality. A technology that looks financially attractive but is built on a fundamental quality mismatch is a hidden risk that no spreadsheet will surface. Exergy analysis makes that risk visible.",
    tag: "Investment",
    image: "/images/feature-ev.jpg",
  },
];

function Logo({ size = 28 }: { size?: number }) {
  return (
    <div
      className="shrink-0 rounded-lg flex items-center justify-center shadow-lg"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, var(--accent-blue), var(--accent-cyan))",
        boxShadow: "0 4px 12px rgba(91,141,217,0.25)",
      }}
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 16 16" fill="none">
        <path d="M8 1L3 5v6l5 4 5-4V5L8 1z" fill="white" fillOpacity="0.9" />
      </svg>
    </div>
  );
}

export default function BlogIndexPage() {
  return (
    <div className="min-h-screen bg-[#080c16]">

      <main className="max-w-5xl mx-auto px-6 sm:px-10 lg:px-16 py-24">
        {/* Page title */}
        <div className="mb-16">
          <p className="text-[13px] font-medium text-[#4db8a4] uppercase tracking-widest mb-4">
            From the Team
          </p>
          <h1 className="text-[36px] sm:text-[42px] font-bold tracking-tight leading-tight mb-5 text-[#d0d8e4]">
            Writing &amp; Open Source
          </h1>
          <p className="text-[17px] text-[#7a8a9e] leading-relaxed max-w-2xl">
            Insights, open-source guides, and lessons learned as we build a platform for energy
            technology validation. Free for anyone working to advance clean energy.
          </p>
        </div>

        {/* Post list */}
        <div className="space-y-10">
          {POSTS.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="block group rounded-2xl border border-[#1a2a3e] bg-[#0d1220] hover:bg-[#0a1528] hover:border-[#2a4a6a] transition-all overflow-hidden"
            >
              <img src={post.image} alt="" className="w-full h-72 object-cover" style={{ filter: "brightness(0.8)" }} />
              <div className="p-8 sm:p-10">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[11px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-[#4db8a4]/10 text-[#4db8a4] border border-[#4db8a4]/20">
                  {post.tag}
                </span>
                <span className="text-[13px] text-[#5a6a7e]">{post.date}</span>
              </div>
              <h2 className="text-[24px] font-semibold tracking-tight mb-2 text-[#d0d8e4] group-hover:text-[#5ba8c8] transition-colors">
                {post.title}
              </h2>
              <p className="text-[16px] text-[#8a9aae] mb-4">{post.subtitle}</p>
              <p className="text-[16px] text-[#6a7a8e] leading-[1.75]">
                {post.description}
              </p>
              <div className="mt-6 flex items-center gap-1.5 text-[14px] font-medium text-[#4db8a4]">
                Read post
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:translate-x-0.5 transition-transform">
                  <path d="M5 3l4 4-4 4" />
                </svg>
              </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
