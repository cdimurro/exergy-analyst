import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How Exergy Changes Technology Evaluation — Exergy Lab",
  description:
    "Exergy-aware evaluation reveals truths that conventional energy analysis hides. Here is how it changes the way we assess batteries, heat pumps, hydrogen, and more.",
};

export default function ExergyChangesEvaluationPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">

      <div className="relative w-full" style={{ height: "55vh", minHeight: 360 }}>
        <Image
          src="/images/feature-solar.jpg"
          alt="Solar energy systems under evaluation"
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
                Analysis
              </span>
              <span className="text-xs text-[var(--text-muted)]">March 2026</span>
              <span className="text-[var(--text-dim)] text-xs">&middot;</span>
              <span className="text-xs text-[var(--text-muted)]">The Exergy Lab Team</span>
            </div>
            <h1 className="text-[48px] font-bold tracking-tight leading-[1.1] mb-3 text-white">
              How Exergy Changes the Way We Evaluate Energy Technologies
            </h1>
            <p className="text-[20px] text-white/70 font-medium max-w-2xl">
              Conventional metrics can make terrible technologies look great and great technologies look mediocre. Exergy fixes that.
            </p>
          </div>
        </div>
      </div>

      <main className="max-w-[1400px] mx-auto px-12 py-14">

        <div className="flex items-center gap-2 mb-10 text-xs text-[var(--text-muted)]">
          <Link href="/blog" className="hover:text-[var(--accent-blue)] transition-colors">Blog</Link>
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l4 4-4 4" /></svg>
          <span>How Exergy Changes Technology Evaluation</span>
        </div>

        <div className="flex gap-16 items-start">
          <article className="flex-1 min-w-0 space-y-7">

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              When you evaluate an energy technology using conventional first-law efficiency alone, you are measuring how much energy comes out relative to how much goes in. This is useful, but it misses something critical: whether the energy that comes out is still capable of doing what you need it to do. Exergy-aware evaluation changes the question from &ldquo;how much energy was preserved?&rdquo; to &ldquo;how much useful work potential was preserved?&rdquo; The answers are often dramatically different.
            </p>

            <SectionHeading>Where Exergy Adds Nothing</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Before diving into where exergy transforms evaluation, it is important to be honest about where it does not. For technologies where both input and output are electricity &mdash; batteries, inverters, power electronics, grid transmission &mdash; exergetic efficiency is essentially identical to first-law efficiency. Electricity is pure exergy. Computing the exergy of a lithium-ion battery&rsquo;s round-trip cycle adds no information beyond what you already know from its coulombic and energy efficiency. The same applies to wind turbines and hydropower, where kinetic and potential energy are pure exergy by definition.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Exergy Lab does not compute exergy for these domains because doing so would be misleading &mdash; it would suggest a deeper analysis is happening when it is not. Honesty about where a method applies is as important as the method itself.
            </p>

            <SectionHeading>Where Exergy Transforms Understanding</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The discriminative power of exergy analysis emerges precisely where energy changes quality &mdash; in combustion, heat transfer, chemical conversion, separation processes, and multi-carrier systems. Here are concrete examples of how exergy changes the evaluation of real technologies:
            </p>

            <h3 className="text-[18px] font-semibold text-[var(--text-primary)] pt-4">Heat Pumps vs. Gas Boilers</h3>
            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Conventional analysis: gas boiler 95% efficient, heat pump COP 3.5 (appears to create energy from nothing). Exergy analysis: gas boiler 6% exergetically efficient, heat pump 35-45% exergetically efficient. The heat pump preserves five to seven times more thermodynamic quality. This completely inverts the apparent ranking from conventional metrics and reveals the boiler as one of the most wasteful energy devices in widespread use.
            </p>

            <h3 className="text-[18px] font-semibold text-[var(--text-primary)] pt-4">Hydrogen Pathways</h3>
            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              A green hydrogen fuel cell vehicle: renewable electricity &rarr; electrolysis &rarr; compression &rarr; transport &rarr; fuel cell &rarr; motor. End-to-end exergetic efficiency: ~26%. A battery electric vehicle: renewable electricity &rarr; battery &rarr; motor. End-to-end exergetic efficiency: ~75%. Both are zero-emission. But the hydrogen pathway destroys three times as much thermodynamic quality. This does not mean hydrogen is wrong &mdash; it means hydrogen must justify itself by serving applications where batteries cannot.
            </p>

            <h3 className="text-[18px] font-semibold text-[var(--text-primary)] pt-4">Carbon Capture</h3>
            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Carbon capture systems are often evaluated by their energy penalty &mdash; how much of a power plant&rsquo;s output is consumed by the capture process. But exergy analysis reveals that the true thermodynamic cost of separation depends on the concentration of CO2 in the stream. Capturing CO2 from a concentrated industrial flue gas (15-30% CO2) requires far less exergy than capturing it from ambient air (0.04% CO2). The minimum thermodynamic work of separation scales with the logarithm of concentration. This is why direct air capture will always be fundamentally more energy-intensive than post-combustion capture &mdash; it is a thermodynamic reality, not an engineering limitation.
            </p>

            <h3 className="text-[18px] font-semibold text-[var(--text-primary)] pt-4">Industrial Process Heat</h3>
            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              A food processing facility needs heat at 80&deg;C. Using a natural gas boiler at 90% first-law efficiency, the exergetic efficiency is roughly 15%. Using an industrial heat pump, the exergetic efficiency jumps to 45-60%. Using waste heat recovery from a nearby process at 120&deg;C, the exergetic efficiency can exceed 70%. Same thermal service, but the exergy analysis reveals which approach is actually intelligent and which is thermodynamically reckless.
            </p>

            <SectionHeading>How This Changes Exergy Lab&rsquo;s Evaluations</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              When Exergy Lab evaluates a technology, the exergy dimension is woven into the physics and performance modules &mdash; not as a separate score, but as a lens that reveals quality destruction that conventional metrics hide. For thermal systems, the platform computes exergetic efficiency alongside first-law efficiency and flags cases where the gap between them is large enough to signal a fundamental quality mismatch.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This does not override other evaluation dimensions. A technology with perfect exergetic efficiency that cannot be manufactured at scale is still not ready for deployment. But a technology with a massive hidden quality mismatch &mdash; one that conventional metrics entirely conceal &mdash; is a risk that investors and engineers deserve to see clearly before making decisions.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              That clarity is what exergy-aware evaluation provides. Not a single number. Not a magic score. A truthful picture of where thermodynamic quality is being preserved and where it is being destroyed &mdash; so you can make decisions with your eyes open.
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
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-dim)] mb-5">Comparisons</p>
            {[
              { value: "6% vs 45%", label: "Gas boiler vs heat pump exergetic efficiency for space heating" },
              { value: "26% vs 75%", label: "Hydrogen FC vehicle vs battery EV end-to-end exergetic efficiency" },
              { value: "15% vs 60%", label: "Gas boiler vs heat pump for 80°C industrial process heat" },
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
