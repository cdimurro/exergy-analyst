import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Exergy Imperative — Exergy Lab",
  description:
    "Why we built our platform around exergy, not just energy. Our first open-source contribution to the broader energy community.",
};

function Logo({ size = 28 }: { size?: number }) {
  return (
    <div
      className="shrink-0 rounded-lg flex items-center justify-center"
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

export default function TheExergyImperativePage() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">

      {/* Header provided by global Navbar in layout.tsx */}

      {/* Hero image — full viewport width */}
      <div className="relative w-full" style={{ height: "55vh", minHeight: 360 }}>
        <Image
          src="/images/feature-industrial.jpg"
          alt="Industrial energy systems and manufacturing infrastructure"
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
        {/* Title overlaid on hero */}
        <div className="absolute bottom-0 left-0 right-0 px-12 pb-10">
          <div className="max-w-[1400px] mx-auto">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-[var(--accent-blue)]/20 text-[var(--accent-blue)] border border-[var(--accent-blue)]/30">
                Open Source
              </span>
              <span className="text-xs text-[var(--text-muted)]">March 2026</span>
              <span className="text-[var(--text-dim)] text-xs">·</span>
              <span className="text-xs text-[var(--text-muted)]">The Exergy Lab Team</span>
            </div>
            <h1 className="text-[52px] font-bold tracking-tight leading-[1.1] mb-3 text-white">
              The Exergy Imperative
            </h1>
            <p className="text-[20px] text-white/70 font-medium max-w-2xl">
              Why We Built Our Platform Around Exergy, Not Just Energy
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <main className="max-w-[1400px] mx-auto px-12 py-14">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-10 text-xs text-[var(--text-muted)]">
          <Link href="/blog" className="hover:text-[var(--accent-blue)] transition-colors">
            Blog
          </Link>
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 3l4 4-4 4" />
          </svg>
          <span>The Exergy Imperative</span>
        </div>

        {/* Two-column layout: article + sidebar */}
        <div className="flex gap-16 items-start">

          {/* Main article */}
          <article className="flex-1 min-w-0 space-y-7">

            <p className="text-[14px] text-[var(--text-muted)] leading-relaxed border-l-2 border-[var(--accent-blue)]/50 pl-5 italic">
              This blog post accompanies our recent open-source release of The Exergy Imperative — a
              complete technical guide to exergy analysis and its role in the energy transition. It is
              our first contribution to the open-source community, and we hope it helps highlight more
              clearly about where the real waste in our energy system is hiding.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Every year, humanity produces roughly 600 exajoules of primary energy. We track it
              meticulously — barrels of oil, cubic meters of gas, megawatt-hours of electricity. We
              measure efficiency. We optimize. We build dashboards and write reports.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              And nearly all of it treats every joule as interchangeable. They are not.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Energy has both quantitative and qualitative aspects to it. Exergy is fundamentally
              important because it measures the quality of energy, yet it is almost entirely ignored
              in traditional energy analyses that only focus on quantity.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This is the blind spot at the center of energy analysis today, and it is why we built
              Exergy Lab around a concept that has been rigorously proven for decades but almost never
              appears in the investment reports, policy frameworks, or technology evaluations that
              shape which energy innovations get funded and which ones do not.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              That concept is exergy — the capacity of energy to do useful work.
            </p>

            <SectionHeading>What Exergy Actually Means</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Exergy is not a new idea. It has been rigorously defined since the mid-20th century,
              refined across thousands of peer-reviewed papers, and applied in detailed studies of
              power plants, chemical processes, and industrial systems. It is taught in advanced
              thermodynamics courses at every major engineering university. And it is almost completely
              absent from the energy policy, investment analysis, and technology evaluation that will
              determine whether the energy transition succeeds or fails.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Here is the core insight in plain terms:
            </p>

            <Callout>
              Energy is conserved in every process. Exergy is destroyed in every real process.
            </Callout>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              When natural gas burns in a boiler, the energy does not go anywhere — the first law of
              thermodynamics guarantees that. But its capacity to do useful work is largely gone by
              the time it has warmed your building to 22 °C. The chemical energy of the gas, which
              could have driven a turbine, powered a motor, or produced hydrogen, is now dispersed as
              low-grade heat. The quantity was preserved. The quality was obliterated.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The thermodynamic quantity that measures this quality — the maximum useful work
              obtainable from an energy system as it comes into equilibrium with its surroundings — is
              exergy. When a hot gas at 500 °C exists in a 25 °C environment, it has enormous exergy:
              it can run a heat engine, expand against a piston, drive a process. As it cools toward
              ambient temperature, its exergy diminishes. At 25 °C, its energy is still there — but
              its ability to do anything useful is essentially zero.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This is why a joule of electricity and a joule of lukewarm bathwater are not the same
              thing. Electricity can do almost anything — run a motor, split water into hydrogen, heat
              a building. Lukewarm water can do almost nothing useful. Same joules. Vastly different
              exergy.
            </p>

            <SectionHeading>
              The Blind Spot in Action: Why a "95% Efficient" Boiler Is Actually 6% Efficient
            </SectionHeading>

            {/* Smoke image */}
            <figure className="my-6 rounded-2xl overflow-hidden">
              <div className="relative w-full" style={{ height: 380 }}>
                <Image
                  src="/blog/smoke.jpg"
                  alt="Steam and dissipated heat — visible exergy destruction"
                  fill
                  className="object-cover object-center"
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(to top, rgba(11,14,26,0.75) 0%, transparent 55%)",
                  }}
                />
                <p className="absolute bottom-4 left-5 right-5 text-[12px] text-white/60 leading-relaxed">
                  Visible waste — low-grade heat dissipating from an industrial process. The energy is
                  still there. The ability to do useful work is largely gone.
                </p>
              </div>
            </figure>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The most powerful illustration of why exergy matters involves the natural gas boiler —
              arguably the most common energy device on Earth.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              A modern condensing gas boiler heating a building achieves a first-law efficiency of
              about 95%. By conventional metrics, this is excellent. Nearly all the fuel energy ends
              up as useful heat. The system appears well-optimized.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Its exergetic efficiency — measuring what fraction of the work potential was preserved —
              is approximately 5 to 8 percent.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              How is this possible? Natural gas has a chemical exergy nearly equal to its heating
              value. It is high-quality energy. When you burn it at an adiabatic flame temperature of
              roughly 2,000 °C and use the result to warm water to 40–60 °C for space heating, you
              have consumed energy with a Carnot factor near 0.85 to produce heat with a Carnot factor
              near 0.05. The combustion itself destroys 25–35% of the fuel's work potential
              immediately, before any heat transfer occurs. The subsequent heat transfer from flame to
              water across a 1,900 °C temperature difference destroys most of the rest.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              A heat pump doing exactly the same job — delivering the same amount of warmth to the
              same building — achieves an exergetic efficiency of 30–50%. Same service. Five to ten
              times less thermodynamic waste. The heat pump's apparent COP of 3–5 is not a miracle;
              it is what happens when you match energy quality to the task at hand.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This is the insight exergy makes visible: the most wasteful energy systems in the world
              are often the ones that look most efficient by conventional metrics. The gas boiler's
              95% first-law efficiency creates a powerful illusion that masks the 90%+ destruction of
              thermodynamic quality happening inside it.
            </p>

            <SectionHeading>
              The Energy Transition's Biggest Opportunity — and Why It's Hidden
            </SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The global conversation about decarbonization focuses heavily on electricity generation —
              replacing coal and gas power plants with solar, wind, and storage. That work is critical.
              But exergy analysis reveals that the single largest pool of wasted thermodynamic quality
              in the global energy system is not in power generation, which has been optimized for
              over a century, but in industrial process heat.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              More than half of all global industrial energy consumption goes to heating. The
              temperature requirements range from below 100 °C (food processing, drying, space
              heating) to above 1,500 °C (steel, glass, cement). And the dominant method worldwide
              remains the same: burn fossil fuels.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The exergetic efficiency of this arrangement is catastrophic for low- and
              medium-temperature applications. A factory needing process heat at 150 °C, using a
              natural gas burner with 90% first-law efficiency, achieves an exergetic efficiency of
              roughly 25%. Three-quarters of the fuel's work potential is destroyed before a single
              useful thing is done with it.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The alternatives — industrial heat pumps, waste heat recovery, quality-matched heating —
              can deliver the same 150 °C process heat with exergetic efficiencies of 40–70%. The
              thermodynamic prize here is not a 10–15% incremental improvement. It is a 50–80%
              reduction in quality waste for an application that accounts for an enormous share of
              global energy consumption and greenhouse gas emissions.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This opportunity is hidden in plain sight, masked by an energy accounting system that
              cannot see it.
            </p>

            <SectionHeading>
              Hydrogen, Batteries, and the Art of Quality Chain Analysis
            </SectionHeading>

            {/* Power lines image */}
            <figure className="my-6 rounded-2xl overflow-hidden">
              <div className="relative w-full" style={{ height: 380 }}>
                <Image
                  src="/blog/power-lines.avif"
                  alt="Power transmission lines at sunset — the infrastructure backbone of the energy transition"
                  fill
                  className="object-cover object-center"
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(to top, rgba(11,14,26,0.75) 0%, transparent 55%)",
                  }}
                />
                <p className="absolute bottom-4 left-5 right-5 text-[12px] text-white/60 leading-relaxed">
                  Every link in the energy chain — generation, transmission, storage, conversion —
                  carries a thermodynamic cost. Exergy makes that cost visible.
                </p>
              </div>
            </figure>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Exergy analysis also provides the clearest possible framework for one of the central
              debates of the energy transition: when does hydrogen make sense, and when does it not?
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The answer is not ideological. It is thermodynamic.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Every step in the hydrogen value chain — electrolysis, compression or liquefaction,
              transport, conversion in a fuel cell — destroys exergy. The cumulative destruction is
              substantial. For a green hydrogen pathway powering a fuel cell vehicle, the end-to-end
              exergetic efficiency from renewable electricity to wheel is approximately 26%.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The battery-electric pathway for the same vehicle, charged from the same renewable
              electricity, achieves an end-to-end exergetic efficiency of approximately 75%.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Exergy analysis does not say hydrogen is always wrong. It says: the hydrogen pathway
              destroys roughly three times as much thermodynamic quality as the battery-electric
              pathway for personal mobility. Hydrogen must therefore justify itself by serving
              applications where batteries cannot — long-haul trucking, maritime shipping, aviation,
              seasonal storage at grid scale, industrial chemical feedstocks. Not by competing
              head-to-head with direct electrification where direct electrification is feasible.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This is arguably the most strategically important insight exergy analysis provides for
              energy transition planning. It is also almost entirely absent from the investment theses
              and policy frameworks that are currently allocating hundreds of billions of dollars to
              energy transition technologies.
            </p>

            <SectionHeading>What Exergy Cannot Do — And Why That Matters Too</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              We want to be clear about something: exergy is not a silver bullet.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              A thermodynamically elegant system that costs too much will not be built. A process with
              excellent exergetic efficiency can still be dangerous. A technology that approaches the
              Carnot limit in the laboratory can still be decades from commercial readiness. Exergy
              measures thermodynamic quality, not economic viability, safety, regulatory compliance,
              market readiness, or environmental impact.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This is precisely why Exergy Lab is not an exergy analysis tool. It is a technology
              deployment readiness platform that uses exergy-aware analysis as one of ten evaluation
              dimensions — alongside physics, economics, safety, regulatory compliance, manufacturing
              readiness, environmental impact, scalability, system integration, and novelty. The
              exergy lens is baked into how we evaluate every candidate technology, but it is not the
              only lens.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              We also want to be explicit about where exergy analysis adds no value. For systems where
              the input and output are both electricity — batteries, power electronics, inverters, grid
              transmission — exergetic efficiency is essentially identical to first-law efficiency.
              Computing and reporting exergy for a lithium-ion battery adds no information. It is
              identity math. The same is true for wind turbines and hydroelectric plants, where kinetic
              and potential energy are pure exergy by definition.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The discriminative power of exergy analysis emerges precisely where energy changes
              quality: in combustion, heat transfer, chemical conversion, separation processes, and
              multi-carrier systems. That is where first-law analysis goes blind, and where exergy can
              transform decisions.
            </p>

            <SectionHeading>Why We're Open-Sourcing This</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              We built Exergy Lab to accelerate the energy transition by helping founders, investors,
              scientists, engineers, and project developers answer a question that no platform
              adequately answers today: Is this energy technology ready for the real world?
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Answering that question honestly requires exergy-aware analysis. But you cannot evaluate
              a technology for exergetic efficiency if the people evaluating it do not understand what
              exergy is, why it matters, and where it applies. That knowledge gap is real. It spans
              engineering teams, investment committees, policy offices, and startup boardrooms.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The Exergy Imperative is our attempt to close that gap — for everyone, not just our
              users.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              We believe the energy transition will move faster if the entire community of people
              working on it — not just thermodynamicists and academic researchers, but the engineers,
              investors, and policymakers making real decisions about real technologies — has access
              to clear, rigorous, honest thinking about energy quality. So we are releasing this guide
              as open-source, free to use, share, adapt, and build upon.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This is the first of what we intend to be many contributions back to the community that
              has generated the science we build on. The exergy literature spans decades of rigorous
              work by researchers like Szargut, Bejan, Tsatsaronis, Valero, Dincer, Kotas, and many
              others. We owe an enormous intellectual debt to that tradition. The least we can do is
              help translate it into a form that changes how practitioners think.
            </p>

            <SectionHeading>Reading the Full Guide</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The Exergy Imperative covers:
            </p>

            <ul className="space-y-4 pl-1">
              {[
                {
                  label: "Foundations",
                  body: "What exergy is, its components (physical, chemical, radiative, kinetic, potential), the Gouy-Stodola theorem, and why exergetic efficiency is more meaningful than first-law efficiency for thermal systems.",
                },
                {
                  label: "Where exergy transforms understanding",
                  body: "Detailed analyses of industrial heat, CHP, hydrogen, desalination, carbon capture, steel, cement, and aluminum — and honest acknowledgment of where exergy adds no value.",
                },
                {
                  label: "Practical application",
                  body: "A step-by-step guide to conducting an exergy analysis, common pitfalls, and lifecycle exergy (Cumulative Exergy Demand).",
                },
                {
                  label: "Strategic implications",
                  body: "How the energy transition should be designed around quality matching, where hydrogen makes thermodynamic sense, and the hidden opportunity in industrial process integration.",
                },
                {
                  label: "Honest limitations",
                  body: "What exergy cannot do, and how it can be misused.",
                },
                {
                  label: "A practical agenda",
                  body: "Specific guidance for engineers, investors, policymakers, and educators.",
                },
              ].map((item) => (
                <li key={item.label} className="flex gap-4">
                  <span className="mt-[10px] shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)]" />
                  <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
                    <span className="text-[var(--text-primary)] font-semibold">{item.label}</span>
                    {" — "}
                    {item.body}
                  </p>
                </li>
              ))}
            </ul>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              It includes worked numerical examples, reference tables of standard chemical exergies,
              and benchmarks for common energy systems — from combined-cycle gas turbines (exergetic
              efficiency ~55%) to gas boilers for space heating (exergetic efficiency ~6%) to
              lithium-ion batteries (exergetic efficiency ~92%, essentially identical to round-trip
              efficiency because electricity is pure exergy).
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              We have tried to write it as a guide we wish had existed when we started building this
              platform: technically rigorous, honest about limitations, and grounded in the real
              decisions that engineers and investors face.
            </p>

            <SectionHeading>An Invitation</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              We are building Exergy Lab to be the go-to platform for validating and de-risking energy
              innovations — free for anyone working to advance clean energy. Exergy-aware analysis is
              central to how we evaluate technologies, and we believe making that thinking public makes
              the whole field sharper.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              If you find The Exergy Imperative useful, share it. If you find errors or have
              improvements, open an issue or submit a pull request. If you are working on an energy
              technology and want to understand how exergy analysis applies to what you are building,
              we would love to talk.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The energy transition needs every possible tool for identifying where thermodynamic
              quality is being wasted — and where, with better design and better decision-making, it
              does not have to be.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              That is what exergy is for and that is what we built Exergy Lab to do.
            </p>

            {/* Footer */}
            <div className="mt-14 pt-8 border-t border-[var(--border)] space-y-3">
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                The Exergy Imperative is licensed under Creative Commons Attribution 4.0 International
                (CC BY 4.0). You are free to share and adapt the material for any purpose, provided
                you give appropriate credit.
              </p>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                Exergy Lab is a platform for discovering and validating energy innovations —
                purpose-built for the energy and deep-tech industries. It is free for anyone working
                to advance clean energy deployment and reduce greenhouse gas emissions.
              </p>
            </div>

            <div className="mt-10">
              <Link
                href="/blog"
                className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent-blue)] transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3L5 7l4 4" />
                </svg>
                Back to blog
              </Link>
            </div>
          </article>

          {/* Sticky sidebar */}
          <aside className="w-72 shrink-0 sticky top-24 space-y-4 hidden lg:block">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-dim)] mb-5">
              Key Numbers
            </p>

            {[
              {
                value: "600 EJ",
                label: "Global primary energy produced per year — tracked as if every joule were equal",
              },
              {
                value: "5–8%",
                label: "Exergetic efficiency of a gas boiler rated at 95% by conventional metrics",
              },
              {
                value: "50–80%",
                label: "Potential reduction in quality waste for industrial low-temperature heat",
              },
              {
                value: "26% vs 75%",
                label:
                  "End-to-end exergetic efficiency: hydrogen fuel cell vehicle vs. battery electric vehicle",
              },
            ].map((stat) => (
              <div
                key={stat.value}
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4"
              >
                <p className="text-[24px] font-bold tracking-tight text-[var(--accent-blue)] leading-none mb-2">
                  {stat.value}
                </p>
                <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">{stat.label}</p>
              </div>
            ))}

            <div className="rounded-xl border border-[var(--accent-blue)]/20 bg-[var(--accent-blue)]/5 p-4 mt-6">
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed mb-3">
                Read the full open-source technical guide with worked examples, formulas, and
                benchmarks.
              </p>
              <a
                href="https://github.com/cdimurro/the-exergy-imperative"
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent-blue)] hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Read The Exergy Imperative
                <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 3l4 4-4 4" />
                </svg>
              </a>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[22px] font-bold tracking-tight text-[var(--text-primary)] pt-6 pb-1">
      {children}
    </h2>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/8 px-6 py-5 my-2">
      <p className="text-[18px] text-[var(--text-primary)] leading-relaxed font-semibold">
        {children}
      </p>
    </div>
  );
}
