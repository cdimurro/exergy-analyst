"use client";

export default function AboutPage() {
  return (
    <div className="bg-[#080c16]">

      {/* ── Hero ── */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] opacity-[0.06]"
          style={{ background: "radial-gradient(circle at center, #5b8dd9 0%, transparent 70%)", filter: "blur(80px)" }} />
        <div className="relative max-w-5xl mx-auto px-6 sm:px-10 lg:px-16 text-center">
          <h1 className="text-[36px] sm:text-[46px] font-bold tracking-tight text-[#d0d8e4] mb-6">
            Why we built{" "}
            <span className="bg-gradient-to-r from-[#4db8a4] to-[#5b8dd9] bg-clip-text text-transparent">Exergy Lab</span>
          </h1>
          <p className="text-[18px] sm:text-[20px] text-[#8a9aae] leading-[1.8] max-w-3xl mx-auto">
            The energy industry has a credibility problem. Promising technologies die in the "valley of death"
            because there is no universal tool for evaluating whether they actually work. We built Exergy Lab
            to change that.
          </p>
        </div>
      </section>

      {/* ── The Problem ── */}
      <section className="relative border-y border-[#141c2c] bg-[#0a0e18] py-24">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#2a4a6a]/50 to-transparent" />
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
          <div className="flex flex-col lg:flex-row gap-16 items-start">
            <div className="lg:w-1/2">
              <h2 className="text-[28px] sm:text-[34px] font-bold text-[#d0d8e4] tracking-tight mb-6">
                The problem we're solving
              </h2>
              <p className="text-[17px] text-[#8a9aae] leading-[1.8] mb-6">
                Every year, billions of dollars are invested in energy technologies that never reach commercial
                deployment. Not because the science is wrong, but because no one could prove the science was right
                quickly enough to secure funding, pass regulatory review, or convince engineering teams to build it.
              </p>
              <p className="text-[17px] text-[#8a9aae] leading-[1.8]">
                The tools that exist today are either too generic (ChatGPT doesn't know electrochemistry), too
                narrow (single-domain simulation software), or too expensive (consulting firms charging six figures
                for a feasibility study). There was no platform purpose-built for energy technology evaluation.
              </p>
            </div>
            <div className="lg:w-1/2 space-y-6">
              {[
                { stat: "90%", label: "of energy startups fail before reaching commercial deployment" },
                { stat: "18 months", label: "average time for a traditional feasibility study" },
                { stat: "$250K+", label: "typical cost of third-party technical due diligence" },
              ].map(item => (
                <div key={item.stat} className="border-l-2 border-[#4db8a4]/40 pl-8 py-2">
                  <div className="text-[28px] font-bold bg-gradient-to-r from-[#4db8a4] to-[#5b8dd9] bg-clip-text text-transparent mb-1">
                    {item.stat}
                  </div>
                  <p className="text-[16px] text-[#7a8a9e]">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Our Approach ── */}
      <section className="py-24">
        <div className="max-w-5xl mx-auto px-6 sm:px-10 lg:px-16">
          <h2 className="text-[28px] sm:text-[34px] font-bold text-[#d0d8e4] tracking-tight text-center mb-16">
            Our approach
          </h2>
          <div className="space-y-16">
            {[
              {
                title: "Physics first, AI second",
                body: "Every result in Exergy Lab comes from a real physics solver — CoolProp, Cantera, pvlib, analytical loss models. We use AI for extraction, search, and synthesis, but never for the numbers that matter. The architecture was designed from the ground up to separate deterministic simulation from non-deterministic language models.",
              },
              {
                title: "10 dimensions, not just one",
                body: "Most tools evaluate a technology on one or two dimensions. Exergy Lab evaluates across ten: physics, performance, economics, safety, regulatory, manufacturing, environmental, scalability, system integration, and strategic value. A battery cathode that passes on physics but fails on manufacturing isn't ready for deployment — and you should know that before you invest.",
              },
              {
                title: "Honest about uncertainty",
                body: "The platform was not built to be 100% accurate all the time. It was built to make it impossible to hide uncertainty. Every output includes calibrated confidence levels. If the platform doesn't have enough data to produce a credible result, it says so — and tells you exactly what information would improve it.",
              },
              {
                title: "Free for the people who need it most",
                body: "Exergy Lab is free for anyone working to advance clean energy deployment and reduce greenhouse gas emissions. Founders, investors, scientists, researchers, engineers, and project developers — the people making the decisions that determine whether a technology lives or dies.",
              },
            ].map((item, i) => (
              <div key={item.title} className="flex gap-8 items-start">
                <div className="shrink-0 relative">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#0d1a28] to-[#080c16] border border-[#2a4a5e] flex items-center justify-center">
                    <span className="text-[24px] font-bold bg-gradient-to-b from-[#4db8a4] to-[#5b8dd9] bg-clip-text text-transparent">
                      {i + 1}
                    </span>
                  </div>
                </div>
                <div>
                  <h3 className="text-[22px] font-semibold text-[#d0d8e4] mb-3">{item.title}</h3>
                  <p className="text-[17px] text-[#7a8a9e] leading-[1.8]">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What it can be used for ── */}
      <section className="relative border-y border-[#141c2c] bg-[#0a0e18] py-24">
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
          <h2 className="text-[28px] sm:text-[34px] font-bold text-[#d0d8e4] tracking-tight text-center mb-16">
            What Exergy Lab can be used for
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { title: "Technology validation", desc: "Evaluate whether a new battery chemistry, solar cell design, or reactor concept is physically plausible and commercially competitive before committing resources." },
              { title: "Investment due diligence", desc: "Run physics-backed technical assessments on energy startups in hours instead of months. Understand the real risks, not just the pitch deck claims." },
              { title: "Competitive analysis", desc: "Compare your technology against published benchmarks and commercial incumbents across every dimension that determines market success." },
              { title: "Research acceleration", desc: "Search scientific databases, extract parameters from papers, and simulate performance — all from a single platform grounded in real physics." },
              { title: "Deployment readiness", desc: "Assess whether a technology is ready to move from lab to pilot to commercial scale, with honest gate evaluations across 10 modules." },
              { title: "Risk identification", desc: "Surface failure modes, degradation risks, regulatory gaps, and supply chain vulnerabilities before they become expensive surprises." },
            ].map(item => (
              <div key={item.title} className="rounded-2xl border border-[#1a2a3e] bg-gradient-to-b from-[#0d1424] to-[#080c16] p-8 transition-all hover:border-[#2a4a6a]">
                <h3 className="text-[20px] font-semibold text-[#d0d8e4] mb-4">{item.title}</h3>
                <p className="text-[16px] text-[#7a8a9e] leading-[1.75]">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How we're different ── */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
          <h2 className="text-[28px] sm:text-[34px] font-bold text-[#d0d8e4] tracking-tight text-center mb-6">
            How Exergy Lab is different
          </h2>
          <p className="text-[17px] text-[#7a8a9e] text-center max-w-3xl mx-auto mb-16">
            We didn't build another AI chatbot and bolt energy onto it. We built an energy-native platform
            from the ground up.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#1a2a3e]">
                  <th className="py-4 pr-6 text-[15px] font-semibold text-[#7a8a9e] w-1/4"></th>
                  <th className="py-4 px-6 text-[15px] font-semibold text-[#4db8a4]">Exergy Lab</th>
                  <th className="py-4 px-6 text-[15px] font-semibold text-[#7a8a9e]">ChatGPT / Claude</th>
                  <th className="py-4 px-6 text-[15px] font-semibold text-[#7a8a9e]">Consulting Firms</th>
                </tr>
              </thead>
              <tbody className="text-[15px]">
                {[
                  { row: "Physics simulation", us: "Real solvers", them1: "LLM guesses", them2: "Manual modeling" },
                  { row: "Evaluation dimensions", us: "10 modules", them1: "Unstructured", them2: "2-3 typically" },
                  { row: "Time to results", us: "Minutes", them1: "Minutes", them2: "Months" },
                  { row: "Cost", us: "Free / $19-99/mo", them1: "$20/mo", them2: "$100K-500K" },
                  { row: "Energy-specific", us: "Purpose-built", them1: "Generic", them2: "Varies" },
                  { row: "Reproducible", us: "Deterministic", them1: "Non-deterministic", them2: "Report-based" },
                  { row: "Uncertainty handling", us: "Calibrated levels", them1: "Hidden", them2: "Subjective" },
                ].map(item => (
                  <tr key={item.row} className="border-b border-[#141c2c]">
                    <td className="py-4 pr-6 text-[#8a9aae] font-medium">{item.row}</td>
                    <td className="py-4 px-6 text-[#d0d8e4]">{item.us}</td>
                    <td className="py-4 px-6 text-[#5a6a7e]">{item.them1}</td>
                    <td className="py-4 px-6 text-[#5a6a7e]">{item.them2}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Exergy Lab Nature ── */}
      <section className="py-24 border-t border-[#141c2c]">
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-16 text-center">
          <h2 className="text-[28px] sm:text-[34px] font-bold text-[#ffffff] tracking-tight mb-6">
            Beyond energy —{" "}
            <span className="text-[#00bf63]">restoring nature</span>
          </h2>
          <p className="text-[17px] text-[#8a9aae] leading-[1.8] mb-8 max-w-2xl mx-auto">
            Exergy Lab Nature applies the same benchmark-grade evaluation methodology to
            ecosystem restoration — proving that nature restoration actually works, with
            evidence that funders, governments, and insurers can rely on.
          </p>
          <a href="/nature" className="inline-flex items-center gap-2 text-[16px] font-medium text-[#00bf63] hover:text-[#6ad0bc] transition-colors">
            Explore Exergy Lab Nature
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3l4 4-4 4" />
            </svg>
          </a>
        </div>
      </section>

      {/* ── Mission CTA ── */}
      <section className="relative py-20 overflow-hidden border-t border-[#141c2c]">
        <div className="absolute inset-0 opacity-[0.06]"
          style={{ background: "radial-gradient(ellipse at center, #4db8a4 0%, transparent 70%)", filter: "blur(100px)" }} />
        <div className="relative max-w-3xl mx-auto px-6 sm:px-10 lg:px-16 text-center">
          <h2 className="text-[28px] sm:text-[36px] font-bold tracking-tight leading-tight mb-5">
            <span className="bg-gradient-to-r from-[#4db8a4] via-[#5ba8c8] to-[#5b8dd9] bg-clip-text text-transparent">
              Accelerating the energy transition
            </span>
          </h2>
          <p className="text-[17px] text-[#7a8a9e] mb-10 leading-relaxed">
            Every evaluation we run, every candidate we reject, and every failure mode we surface makes the next
            evaluation better. We're building a compounding knowledge system that gets smarter with every use —
            so the entire energy industry moves faster.
          </p>
          <a href="/">
            <button className="group relative px-12 py-4 rounded-xl text-[17px] font-semibold text-white overflow-hidden transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-[#3a7a6a]/20">
              <div className="absolute inset-0 bg-gradient-to-r from-[#4a7a6a] to-[#3a6a8a]" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#5a8a7a] to-[#4a7a9a] opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="relative">Get Started</span>
            </button>
          </a>
        </div>
      </section>
    </div>
  );
}
