"use client";

export default function FeaturesPage() {
  return (
    <div className="bg-[#080c16]">

      {/* ── Hero ── */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] opacity-[0.05]"
          style={{ background: "radial-gradient(circle at center, #4db8a4 0%, transparent 70%)", filter: "blur(80px)" }} />
        <div className="relative max-w-5xl mx-auto px-6 sm:px-10 lg:px-16 text-center">
          <h1 className="text-[36px] sm:text-[46px] font-bold tracking-tight text-[#d0d8e4] mb-6">
            Platform{" "}
            <span className="bg-gradient-to-r from-[#4db8a4] to-[#5b8dd9] bg-clip-text text-transparent">features</span>
          </h1>
          <p className="text-[18px] sm:text-[20px] text-[#8a9aae] leading-[1.8] max-w-3xl mx-auto">
            Exergy Lab combines physics simulation, AI-powered research and strict governance frameworks into a
            single platform built specifically for evaluating any energy technology.
          </p>
        </div>
      </section>

      {/* ── Core Capabilities ── */}
      <section className="relative border-y border-[#141c2c] bg-[#0a0e18] py-24">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#2a4a6a]/50 to-transparent" />
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
          <h2 className="text-[28px] sm:text-[34px] font-bold text-[#d0d8e4] tracking-tight text-center mb-16">
            Core capabilities
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {[
              {
                title: "Physics-backed simulations",
                desc: "Every analysis runs through real computational engines — not large language model approximations. CoolProp for refrigerant cycles, Cantera for electrochemistry, pvlib for photovoltaics, analytical models for power electronics.",
                example: "Example: Simulate a 580W TOPCon solar module at 50°C and get real I-V curves, thermal derating, and annual yield.",
                color: "#4db8a4",
              },
              {
                title: "10-module governance framework",
                desc: "Every technology is evaluated across 10 independent dimensions, each with 6 must-pass gates. Physics, performance, economics, safety, regulatory, manufacturing, environmental, scalability, system integration, and strategic value.",
                example: "Example: A battery cathode that scores well on energy density but fails the manufacturability gates gets flagged and surfaced right away.",
                color: "#5ba8c8",
              },
              {
                title: "Multi-domain coverage",
                desc: "Over 100 built-in energy domains from lithium-ion batteries to nuclear reactors, from heat pumps to carbon capture systems. Each domain has its own physics models, reference cases, and specific evaluation criteria.",
                example: "Example: Evaluate a small modular reactor with neutron multiplication, DNBR calculations, and decay heat analysis and conduct a deployment assessment.",
                color: "#5b8dd9",
              },
              {
                title: "AI-powered research",
                desc: "An extremely capable and powerful agent enhanced with dozens of tools and sophisticated harnesses, serves as the main interface between the user and the platform's engine. The agent's job is produce exactly what you need to solve the problem you are working on.",
                example: "Example: Ask the agent to compare NMC 811 vs LFP cathodes for grid storage by running simulations to stress each cathode and then generate a detailed report with the findings.",
                color: "#4db8a4",
              },
            ].map(item => (
              <div key={item.title} className="rounded-2xl border border-[#1a2a3e] bg-gradient-to-b from-[#0d1424] to-[#080c16] p-10 transition-all hover:border-[#2a4a6a]">
                <div className="w-75 h-0.5 mb-8" style={{ background: `linear-gradient(to right, ${item.color}, transparent)` }} />
                <h3 className="text-[22px] font-semibold text-[#d0d8e4] mb-4">{item.title}</h3>
                <p className="text-[16px] text-[#8a9aae] leading-[1.75] mb-5">{item.desc}</p>
                <p className="text-[15px] text-[#5a7a6e] italic leading-relaxed">{item.example}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Detailed Features — tabbed deep dives ── */}
      <section className="py-24">
        <div className="max-w-5xl mx-auto px-6 sm:px-10 lg:px-16">
          <h2 className="text-[28px] sm:text-[34px] font-bold text-[#d0d8e4] tracking-tight text-center mb-16">
            Everything you need all in one place
          </h2>

          <div className="space-y-10">
            {[
              {
                title: "Decision briefs & PDF reports",
                desc: "Every evaluation produces a structured Decision Brief — a human-readable document with score summaries, economic comparisons, risk caveats, and recommended next actions. Download as PDF or review interactively in the platform.",
                points: ["Score breakdown across all 10 modules", "Economic analysis with LCOE/LCOS/TCO", "Risk identification and mitigation paths", "Comparison against published benchmarks"],
                color: "#4db8a4",
              },
              {
                title: "Interactive simulation & visualization",
                desc: "Run simulations and see results in real time. The platform generates interactive charts, parameter sweeps, and sensitivity analyses that you can manipulate directly. Ask the agent to modify parameters and see how results change instantly.",
                points: ["I-V curves, thermal profiles, degradation models", "Custom chart builder via natural language", "Parameter sensitivity tornado plots", "Side-by-side technology comparison"],
                color: "#5ba8c8",
              },
              {
                title: "Research & due diligence workflows",
                desc: "Three connected workflows share the same evaluation backbone. Validate a technology against physics benchmarks. Research the scientific literature with engine-grounded prompts. Run due diligence with structured assessment frameworks.",
                points: ["Validate — physics-backed benchmark evaluation", "Research — literature search with real citations", "Due Diligence — structured investment assessment", "All results unified in a single workspace"],
                color: "#5b8dd9",
              },
            ].map(item => (
              <div key={item.title} className="rounded-2xl border border-[#1a2a3e] bg-gradient-to-b from-[#0d1424] to-[#080c16] overflow-hidden transition-all hover:border-[#2a4a6a]">
                <div className="p-8 sm:p-10">
                  <div className="flex flex-col lg:flex-row gap-10">
                    <div className="lg:w-1/2">
                      <h3 className="text-[22px] font-semibold text-[#d0d8e4] mb-4">{item.title}</h3>
                      <p className="text-[16px] text-[#8a9aae] leading-[1.8]">{item.desc}</p>
                    </div>
                    <div className="lg:w-1/2 flex items-center">
                      <ul className="space-y-4 w-full">
                        {item.points.map(f => (
                          <li key={f} className="flex items-start gap-3 text-[15px] text-[#7a8a9e]">
                            <div className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full" style={{ background: item.color }} />
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Additional Features Grid ── */}
      <section className="relative border-y border-[#141c2c] bg-[#0a0e18] py-24">
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
          <h2 className="text-[28px] sm:text-[34px] font-bold text-[#d0d8e4] tracking-tight text-center mb-16">
            And much more
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { title: "400+ reference cases", desc: "Every domain ships with calibrated reference cases from published literature and commercial datasheets." },
              { title: "23 physics solvers", desc: "Domain-specific computational engines covering thermodynamics, electrochemistry, nuclear physics, power systems, and more." },
              { title: "Advanced reasoning", desc: "An AI reasoning engine specifically tuned for scientific analysis, grounded in the platform's physics backbone." },
              { title: "PDF extraction", desc: "Upload research papers, datasheets, or spec sheets. The platform automatically extracts parameters and begins evaluation." },
              { title: "Memory vault", desc: "Every evaluation, every result, and every failure mode is stored. The platform learns from every use to improve future evaluations." },
              { title: "API access", desc: "Programmatic access to run evaluations, retrieve results, and integrate Exergy Lab into your existing workflows." },
              { title: "Exergy-aware analysis", desc: "Evaluations account for thermodynamic quality — not just energy quantity. This is critical for honest efficiency comparisons." },
              { title: "Regulatory pathway maps", desc: "Standards matrices, certification pathways, and permitting timelines for each technology domain." },
              { title: "Manufacturing readiness", desc: "BOM analysis, process routes, yield models, and supply concentration risk assessment for every evaluated technology." },
            ].map(item => (
              <div key={item.title} className="p-6 rounded-xl border border-[#1a2538] bg-[#0d1220]/60 transition-all hover:border-[#2a3a5e]">
                <h3 className="text-[17px] font-semibold text-[#d0d8e4] mb-2">{item.title}</h3>
                <p className="text-[15px] text-[#6a7a8e] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]"
          style={{ background: "radial-gradient(ellipse at center, #5b8dd9 0%, transparent 70%)", filter: "blur(100px)" }} />
        <div className="relative max-w-3xl mx-auto px-6 sm:px-10 lg:px-16 text-center">
          <h2 className="text-[28px] sm:text-[36px] font-bold tracking-tight leading-tight mb-5">
            <span className="bg-gradient-to-r from-[#4db8a4] via-[#5ba8c8] to-[#5b8dd9] bg-clip-text text-transparent">
              See it in action
            </span>
          </h2>
          <p className="text-[17px] text-[#7a8a9e] mb-10 leading-relaxed">
            Create a project and run your first evaluation in minutes. No setup required.
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
