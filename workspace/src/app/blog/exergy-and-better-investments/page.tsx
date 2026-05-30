import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Can Measuring Exergy Help Us Make Better Investments? — Exergy Lab",
  description:
    "Exergy analysis reveals thermodynamic risks that financial models cannot see. Here is how it changes energy technology investment decisions.",
};

export default function ExergyInvestmentsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">

      <div className="relative w-full" style={{ height: "55vh", minHeight: 360 }}>
        <Image
          src="/images/feature-ev.jpg"
          alt="Electric vehicle charging — where energy investment meets thermodynamic reality"
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
                Investment
              </span>
              <span className="text-xs text-[var(--text-muted)]">March 2026</span>
              <span className="text-[var(--text-dim)] text-xs">&middot;</span>
              <span className="text-xs text-[var(--text-muted)]">The Exergy Lab Team</span>
            </div>
            <h1 className="text-[48px] font-bold tracking-tight leading-[1.1] mb-3 text-white">
              Can Measuring Exergy Help Us Make Better Investments?
            </h1>
            <p className="text-[20px] text-white/70 font-medium max-w-2xl">
              The thermodynamic dimension that most energy investors have never heard of &mdash; and why it matters for returns.
            </p>
          </div>
        </div>
      </div>

      <main className="max-w-[1400px] mx-auto px-12 py-14">

        <div className="flex items-center gap-2 mb-10 text-xs text-[var(--text-muted)]">
          <Link href="/blog" className="hover:text-[var(--accent-blue)] transition-colors">Blog</Link>
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l4 4-4 4" /></svg>
          <span>Can Measuring Exergy Help Us Make Better Investments?</span>
        </div>

        <div className="flex gap-16 items-start">
          <article className="flex-1 min-w-0 space-y-7">

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Energy technology investment today relies heavily on financial models &mdash; IRR, NPV, LCOE, payback period. These are essential tools, but they share a blind spot: they cannot see thermodynamic quality. A technology that looks financially attractive but is built on a fundamental quality mismatch is a hidden risk that no spreadsheet will surface. Exergy analysis is the tool that makes that risk visible.
            </p>

            <SectionHeading>The Hidden Risk in Energy Investments</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              Consider a startup building a green hydrogen heating system for commercial buildings. Their pitch: zero-emission space heating powered by renewable hydrogen. Their financial model shows competitive cost per BTU versus natural gas in markets with high carbon prices. Conventional energy analysis shows the system is &ldquo;efficient&rdquo; &mdash; the hydrogen boiler achieves 90% first-law efficiency.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              An exergy-aware investor would see something very different. The pathway &mdash; renewable electricity to electrolysis to hydrogen compression to combustion to low-temperature heat &mdash; achieves an end-to-end exergetic efficiency of roughly 18%. For every unit of renewable electricity consumed, only 18% of the thermodynamic quality is preserved in the final heating service. A heat pump doing the same job preserves 35-50%.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This means the hydrogen heating system requires 2-3x more renewable electricity than the heat pump alternative for the same service. As renewable electricity capacity becomes the binding constraint on decarbonization, technologies that waste it will face increasing economic pressure. The exergy analysis does not say the investment will fail today. It says the investment is structurally exposed to a risk that the financial model cannot see.
            </p>

            <SectionHeading>What Exergy Reveals About Market Winners</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              History suggests that technologies with superior exergetic efficiency tend to win markets over time, even when they start at a cost disadvantage. Heat pumps are displacing gas boilers across Europe and Asia. Battery electric vehicles are displacing hydrogen fuel cell vehicles in the passenger car market. LED lighting displaced incandescent bulbs. In each case, the technology with better quality matching &mdash; lower exergy destruction per unit of useful service &mdash; ultimately won.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This is not a coincidence. Technologies with lower exergy destruction require less primary energy input per unit of service output. Over time, this translates to lower operating costs, lower resource requirements, and lower exposure to energy price volatility. The thermodynamic advantage compounds into an economic advantage.
            </p>

            <SectionHeading>Three Questions Every Energy Investor Should Ask</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              You do not need to be a thermodynamicist to use exergy thinking in investment decisions. Three questions capture most of the value:
            </p>

            <div className="space-y-6 my-4">
              {[
                { n: "1", q: "What is the exergetic efficiency of this technology's primary conversion step?", detail: "If it is below 30% for a thermal system, there is likely a fundamental quality mismatch. If a competing technology achieves 50%+ for the same service, the investment is structurally exposed." },
                { n: "2", q: "Is the quality of the energy source matched to the quality of the end-use task?", detail: "Using high-temperature combustion for low-temperature heating is a red flag. Using electricity for mechanical work is a green flag. The larger the quality gap between source and task, the greater the thermodynamic waste." },
                { n: "3", q: "How many conversion steps are in the energy chain from source to service?", detail: "Each conversion step destroys exergy. Hydrogen for vehicles has 5-6 steps. Battery electric has 2-3. Fewer steps generally means less quality destruction, lower losses, and better economics over time." },
              ].map(item => (
                <div key={item.n} className="flex gap-6 items-start">
                  <div className="shrink-0 w-10 h-10 rounded-xl bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/20 flex items-center justify-center">
                    <span className="text-[16px] font-bold text-[var(--accent-blue)]">{item.n}</span>
                  </div>
                  <div>
                    <p className="text-[17px] text-[var(--text-primary)] font-semibold mb-2">{item.q}</p>
                    <p className="text-[16px] text-[var(--text-muted)] leading-[1.75]">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            <SectionHeading>Exergy as a Due Diligence Layer</SectionHeading>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              We are not arguing that exergy should replace financial analysis. We are arguing it should be added as a due diligence layer &mdash; one that catches risks invisible to conventional metrics.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              This is exactly how Exergy Lab uses it. When you evaluate a technology on the platform, exergy-aware analysis is woven into the physics and performance modules alongside economics, safety, regulatory, manufacturing, and seven other dimensions. It does not produce a single &ldquo;exergy score.&rdquo; It surfaces quality mismatches that would otherwise hide behind misleading efficiency numbers &mdash; so you can decide whether to proceed, pivot, or pass with full thermodynamic clarity.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              In an industry where the average energy startup takes 8-12 years to reach commercial scale, identifying thermodynamic dead ends early is not academic. It is the difference between investing in a technology that compounds advantages over time and one that is structurally uncompetitive from day one.
            </p>

            <p className="text-[17px] text-[var(--text-secondary)] leading-[1.8]">
              The answer to the question in the title is yes. Measuring exergy can help us make better investments. Not because exergy is the only thing that matters, but because it is the one thing that matters most and is measured least.
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
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-dim)] mb-5">Investment Lens</p>
            {[
              { value: "18%", label: "Exergetic efficiency of green hydrogen heating — a hidden risk conventional models miss" },
              { value: "2-3x", label: "More renewable electricity required by hydrogen heating vs heat pumps for the same service" },
              { value: "8-12 yrs", label: "Average time for energy startups to reach commercial scale — thermodynamic dead ends are expensive" },
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
