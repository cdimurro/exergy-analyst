import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Why All Joules Are Not Equal — Exergy Lab",
  description:
    "A joule of electricity and a joule of lukewarm water contain the same energy but vastly different potential to do useful work. Understanding this distinction changes everything.",
};

export default function WhyAllJoulesPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">

      {/* Hero image */}
      <div className="relative w-full" style={{ height: "55vh", minHeight: 360 }}>
        <Image
          src="/blog/combustion.jpg"
          alt="Industrial combustion — high-quality energy being transformed and lost as heat"
          fill
          className="object-cover object-center"
          priority
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(11,14,26,0.6) 70%, rgba(11,14,26,1) 100%)",
          }}
        />
        <div className="absolute bottom-0 left-0 right-0 px-12 pb-10">
          <div className="max-w-[1400px] mx-auto">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-[var(--accent-blue)]/20 text-[var(--accent-blue)] border border-[var(--accent-blue)]/30">
                Fundamentals
              </span>
              <span className="text-xs text-[var(--text-muted)]">March 2026</span>
              <span className="text-[var(--text-dim)] text-xs">&middot;</span>
              <span className="text-xs text-[var(--text-muted)]">The Exergy Lab Team</span>
            </div>
            <h1 className="text-[52px] font-bold tracking-tight leading-[1.1] mb-3 text-white">
              Why All Joules Are Not Equal
            </h1>
            <p className="text-[20px] text-white/70 font-medium max-w-2xl">
              The distinction between energy quantity and energy quality is the most important concept missing from mainstream energy analysis.
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <main className="max-w-[1400px] mx-auto px-12 py-14">

        <div className="flex items-center gap-2 mb-10 text-xs text-[var(--text-muted)]">
          <Link href="/blog" className="hover:text-[var(--accent-blue)] transition-colors">Blog</Link>
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l4 4-4 4" /></svg>
          <span>Why All Joules Are Not Equal</span>
        </div>

        <div className="flex gap-16 items-start">
          <article className="flex-1 min-w-0 space-y-7">

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Imagine two containers. One holds a liter of boiling water at 100&deg;C. The other holds a liter of water at 25&deg;C sitting in a 25&deg;C room. Both contain thermal energy. But the boiling water can drive a small turbine, sterilize medical equipment, or heat a chemical reaction. The room-temperature water can do none of those things. Same substance. Similar energy content relative to absolute zero. Completely different usefulness.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This is the fundamental insight that the concept of exergy captures: energy has quality, not just quantity. A joule of electricity is not the same as a joule of lukewarm air. A joule of concentrated sunlight at 5,500&deg;C is not the same as a joule of geothermal heat at 80&deg;C. The first law of thermodynamics tells us energy is conserved. The second law tells us something far more useful for making decisions &mdash; that the capacity of energy to do useful work is destroyed in every real process, and the rate of that destruction depends entirely on how well we match energy quality to the task at hand.
            </p>

            <SectionHeading>The Hierarchy of Energy Quality</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Not all forms of energy are created equal. There is a natural hierarchy of energy quality, determined by how much useful work can be extracted from each form:
            </p>

            <div className="rounded-xl border border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/8 px-6 py-5 my-2">
              <p className="text-[18px] text-[var(--text-primary)] leading-relaxed font-semibold">
                Electricity &gt; Chemical energy &gt; High-temperature heat &gt; Low-temperature heat &gt; Ambient heat
              </p>
            </div>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Electricity is pure exergy &mdash; it can be converted to any other form of energy with very high efficiency. A motor converts electricity to mechanical work at 90-95% efficiency. An electrolyzer converts it to chemical energy. A resistance heater converts it to heat. Electricity sits at the top of the quality hierarchy because it is maximally versatile.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Chemical energy in fuels &mdash; natural gas, hydrogen, gasoline &mdash; carries nearly as much exergy as its heating value. The chemical bonds store concentrated, high-quality energy. But the moment you combust that fuel, you begin destroying exergy irreversibly. The flame temperature might be 2,000&deg;C, but if your end use only requires 60&deg;C hot water, you have annihilated 95% of the fuel&rsquo;s work potential in the process.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Heat quality depends entirely on temperature. Heat at 1,000&deg;C has a Carnot factor of about 0.77 &mdash; meaning 77% of its energy content is theoretically convertible to work. Heat at 50&deg;C in a 25&deg;C environment has a Carnot factor of about 0.08 &mdash; only 8% of its energy is convertible to work. Same joules, ten times less usefulness.
            </p>

            <SectionHeading>Why This Matters for Real Decisions</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The reason this matters is not academic. It determines which energy technologies actually make sense and which ones are thermodynamic dead ends disguised by misleading efficiency numbers.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Consider two ways to heat a building in winter. A natural gas furnace rated at 95% efficiency burns high-quality chemical fuel and delivers low-quality heat at 40&deg;C. Its exergetic efficiency is roughly 6%. An air-source heat pump with a COP of 3.5 uses one unit of electricity (pure exergy) to move 3.5 units of heat from outdoors to indoors. Its exergetic efficiency is 30-45%.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The gas furnace looks nearly perfect by conventional metrics. The heat pump looks merely decent. But the heat pump is five to seven times more efficient at preserving thermodynamic quality. It achieves this by matching the quality of its energy source to the quality of the task &mdash; low-grade heating requires low-grade energy, and the heat pump delivers exactly that.
            </p>

            <SectionHeading>The Invisible Tax on Every Energy System</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Every time energy changes form or flows across a temperature difference, exergy is destroyed. This is not an engineering failure &mdash; it is a law of physics. But the amount of destruction varies enormously depending on how the system is designed.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              A combined-cycle gas turbine that first extracts work at high temperature and then uses the remaining heat for a steam cycle achieves 55-60% exergetic efficiency. It cascades energy quality thoughtfully. A simple boiler that burns the same gas to make steam at 200&deg;C achieves 35-40% exergetic efficiency. Same fuel, same energy content, but dramatically different quality preservation.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This invisible tax &mdash; exergy destruction &mdash; is the true cost of every energy conversion. And it is the cost that conventional energy analysis systematically fails to see.
            </p>

            <SectionHeading>Thinking in Quality, Not Just Quantity</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Once you see energy through the lens of quality, you cannot unsee it. The 95% efficient gas boiler becomes a thermodynamic tragedy. The &ldquo;wasteful&rdquo; heat pump becomes an elegant quality-matching device. The hydrogen economy becomes a nuanced question of where quality destruction is justified and where it is not.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This is why we built Exergy Lab around exergy-aware analysis. Not because exergy is the only thing that matters &mdash; economics, safety, regulatory compliance, and manufacturing readiness all matter too. But because the quality dimension of energy is the one that mainstream analysis consistently gets wrong, and getting it wrong leads to billions of dollars of misallocated capital and decades of unnecessary thermodynamic waste.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              All joules are not equal. The sooner the energy industry internalizes this, the faster the transition will move.
            </p>

            <div className="mt-14 pt-8 border-t border-[var(--border)]">
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                Exergy Lab is a platform for discovering and validating energy innovations &mdash; purpose-built for the energy and deep-tech industries. It is free for anyone working to advance clean energy deployment.
              </p>
            </div>

            <div className="mt-10">
              <Link href="/blog" className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent-blue)] transition-colors">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3L5 7l4 4" /></svg>
                Back to blog
              </Link>
            </div>
          </article>

          <aside className="w-72 shrink-0 sticky top-24 space-y-4 hidden lg:block">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-dim)] mb-5">Key Concepts</p>
            {[
              { value: "Exergy", label: "The maximum useful work obtainable as a system comes into equilibrium with its environment" },
              { value: "Carnot Factor", label: "The fraction of heat energy that is theoretically convertible to work — depends entirely on temperature" },
              { value: "6% vs 95%", label: "A gas boiler's exergetic vs first-law efficiency — the gap reveals hidden thermodynamic waste" },
            ].map(stat => (
              <div key={stat.value} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
                <p className="text-[24px] font-bold tracking-tight text-[var(--accent-blue)] leading-none mb-2">{stat.value}</p>
                <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">{stat.label}</p>
              </div>
            ))}
          </aside>
        </div>
      </main>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-bold tracking-tight text-[var(--text-primary)] pt-6 pb-1">{children}</h2>;
}
