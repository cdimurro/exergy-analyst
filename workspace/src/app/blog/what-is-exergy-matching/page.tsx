import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "What Is Exergy Matching and Why Is It Important? — Exergy Lab",
  description:
    "Exergy matching is the principle of aligning energy quality to task requirements. Getting it wrong is the single largest source of thermodynamic waste in the global energy system.",
};

export default function ExergyMatchingPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">

      <div className="relative w-full" style={{ height: "55vh", minHeight: 360 }}>
        <Image
          src="/images/feature-grid.jpg"
          alt="Energy grid and distribution infrastructure"
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
                Deep Dive
              </span>
              <span className="text-xs text-[var(--text-muted)]">March 2026</span>
              <span className="text-[var(--text-dim)] text-xs">&middot;</span>
              <span className="text-xs text-[var(--text-muted)]">The Exergy Lab Team</span>
            </div>
            <h1 className="text-[52px] font-bold tracking-tight leading-[1.1] mb-3 text-white">
              What Is Exergy Matching?
            </h1>
            <p className="text-[20px] text-white/70 font-medium max-w-2xl">
              And why getting it wrong is the most expensive mistake in energy system design.
            </p>
          </div>
        </div>
      </div>

      <main className="max-w-[1400px] mx-auto px-12 py-14">

        <div className="flex items-center gap-2 mb-10 text-xs text-[var(--text-muted)]">
          <Link href="/blog" className="hover:text-[var(--accent-blue)] transition-colors">Blog</Link>
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l4 4-4 4" /></svg>
          <span>What Is Exergy Matching?</span>
        </div>

        <div className="flex gap-16 items-start">
          <article className="flex-1 min-w-0 space-y-7">

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Exergy matching is a simple principle with profound consequences: the quality of the energy source should match the quality required by the task. Using high-quality energy for a low-quality task is thermodynamic waste. Using low-quality energy for a high-quality task is physically impossible. The art of energy system design is finding the match.
            </p>

            <SectionHeading>The Principle in Plain Terms</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Consider three common energy tasks: heating a house to 22&deg;C, running an electric motor, and melting steel at 1,500&deg;C. Each requires energy, but the quality of energy needed is vastly different.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Space heating requires the lowest quality energy imaginable &mdash; you need heat barely above ambient temperature. A heat pump that pulls low-grade thermal energy from outdoor air and concentrates it indoors is a near-perfect quality match. Burning natural gas at 2,000&deg;C to produce 22&deg;C air is the thermodynamic equivalent of using a fire hose to fill a teacup.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              An electric motor requires pure mechanical work &mdash; the highest quality energy. Electricity, which is itself pure exergy, is the perfect match. This is why electric motors achieve 90-95% efficiency. The quality of the source matches the quality of the demand.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Melting steel requires extremely high-temperature heat. Here, burning natural gas or using an electric arc furnace are both reasonable quality matches &mdash; you need high-quality energy, and both sources provide it. The exergy destruction in steelmaking is relatively low compared to space heating because the temperatures involved are commensurate with the fuel quality.
            </p>

            <SectionHeading>Why Mismatches Are So Expensive</SectionHeading>

            <div className="rounded-xl border border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/8 px-6 py-5 my-2">
              <p className="text-[18px] text-[var(--text-primary)] leading-relaxed font-semibold">
                The global energy system wastes more exergy through quality mismatches than through any other single mechanism &mdash; including inefficient power plants, transmission losses, and end-use device inefficiency combined.
              </p>
            </div>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The numbers are staggering. Roughly 50% of global final energy consumption goes to heating applications. Of that, more than half is for temperatures below 200&deg;C &mdash; process drying, food preparation, space heating, domestic hot water. The dominant heating technology worldwide remains fossil fuel combustion at flame temperatures of 1,500-2,000&deg;C.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This is the largest systematic quality mismatch in the global energy system. High-temperature combustion serving low-temperature demands. The exergy destruction in this mismatch accounts for a substantial fraction of total global thermodynamic waste.
            </p>

            <SectionHeading>The Cascade Principle</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The most elegant expression of exergy matching is the energy cascade &mdash; using energy at the highest quality first, then passing the degraded output to progressively lower-quality applications.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              A combined heat and power (CHP) plant is a textbook cascade. Natural gas first drives a turbine at high temperature, generating electricity. The exhaust heat, which would otherwise be wasted, is then used for district heating or industrial process heat. The first use extracts the high-quality component. The second use captures the remaining low-quality component. Each step is quality-matched to its task.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Industrial pinch analysis extends this idea further, systematically identifying where hot streams can heat cold streams within a factory, minimizing the need for external energy by cascading quality internally. Facilities that apply rigorous pinch analysis routinely achieve 20-40% reductions in fuel consumption &mdash; not through new technology, but through better quality matching of existing energy flows.
            </p>

            <SectionHeading>Exergy Matching in the Energy Transition</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The energy transition presents both the greatest opportunity and the greatest risk for exergy matching. The opportunity is that electrification and heat pump deployment can systematically fix the largest quality mismatches in the system. The risk is that poorly designed hydrogen pathways and synthetic fuel chains create new mismatches that are just as wasteful as the fossil fuel systems they replace.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Using renewable electricity to produce hydrogen via electrolysis, then burning that hydrogen in a boiler for space heating, achieves an end-to-end exergetic efficiency of roughly 15-20%. The same renewable electricity powering a heat pump for the same space heating achieves 35-50%. Both are &ldquo;green.&rdquo; Both are &ldquo;carbon-free.&rdquo; But one destroys two to three times more thermodynamic quality than the other.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Exergy matching does not tell you what to build. It tells you what you are wasting. And in a world with finite renewable energy capacity, finite capital, and finite time to decarbonize, understanding what you are wasting is not optional &mdash; it is essential.
            </p>

            <div className="mt-14 pt-8 border-t border-[var(--border)]">
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                Exergy Lab is a powerful, scientifically rigorous agent for deep tech teams working through messy energy evidence, unfinished models, hard technical questions, and decision-focused artifacts.
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
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-dim)] mb-5">Key Numbers</p>
            {[
              { value: "50%", label: "Share of global final energy that goes to heating applications" },
              { value: "6%", label: "Exergetic efficiency of burning gas at 2,000°C to heat a room to 22°C" },
              { value: "20-40%", label: "Fuel savings achievable through industrial pinch analysis alone" },
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
