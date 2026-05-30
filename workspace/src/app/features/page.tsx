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
            Agent{" "}
            <span className="bg-gradient-to-r from-[#4db8a4] to-[#5b8dd9] bg-clip-text text-transparent">capabilities</span>
          </h1>
          <p className="text-[18px] sm:text-[20px] text-[#8a9aae] leading-[1.8] max-w-3xl mx-auto">
            Exergy Lab can read, extract, analyze, plan, reason, build, and iterate across technical any form of technical information in
            one workspace enabling real-world results to be achieved sooner.
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
                title: "Powerful evidence intake",
                desc: "Upload complex technical material and ask the agent to find the useful structure inside it. Datasheets, PDFs, CSVs, notes, and project context can all become part of the same working brief.",
                example: "Example: Upload a spec sheet and a provide basic context. Ask the agent to extract the signals, claims, gaps, and recommend next steps.",
                color: "#4db8a4",
              },
              {
                title: "Model-aware execution",
                desc: "When the inputs support it, Exergy Lab can help perform calculations, state assumptions, build entire models, and turn raw parameters into a clearer analytical results.",
                example: "Example: Ask which operating assumptions matter most before building a financial, performance, or risk model. The agent will perform a sensitivity analysis and provide the answers.",
                color: "#5ba8c8",
              },
              {
                title: "Broad deep tech reach",
                desc: "The workspace is designed to provide value across technical domains of any kind: hardware, materials, processes, electronics, energy systems, infrastructure, software-defined systems, and emerging technologies.",
                example: "Example: Use the same agent to reason about a battery cell material, a semiconductor process, an aerospace structure, or a brand-new technical concept.",
                color: "#5b8dd9",
              },
              {
                title: "Agentic output generation",
                desc: "The agent is the interface for collecting context, asking follow-up questions, shaping analysis, and turning the work into artifacts a team can read, challenge, and improve.",
                example: "Example: Ask for a technical brief, a measurement plan, a model conversion, edit existing charts, or a provide comprehensive comparison to the current state-of-the-art.",
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
            A complete technical workspace
          </h2>

          <div className="space-y-10">
            {[
              {
                title: "Decision briefs and working reports",
                desc: "Turn scattered technical material into a readable brief with supporting artifacts, assumptions, limits, visuals, and recommended next questions.",
                points: ["Evidence summaries", "Assumption ledgers", "Support and limits language", "Generated artifacts"],
                color: "#4db8a4",
              },
              {
                title: "Charts, tables, and model surfaces",
                desc: "Use the workspace to turn extracted data, calculations, and model outputs into visuals that make a technical story easier to inspect.",
                points: ["Custom charts from available data", "Sensitivity views", "Parameter summaries", "Side-by-side comparisons"],
                color: "#5ba8c8",
              },
              {
                title: "Research and diligence support",
                desc: "Bring research, project evidence, and diligence questions into one thread so the reasoning stays connected to the source material and the next action.",
                points: ["Research framing", "Evidence checks", "Technical question lists", "Workspace memory"],
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
            Advanced tools and capabilities are built-in
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { title: "File understanding", desc: "Read across common technical files and turn scattered inputs into structured context the agent can use." },
              { title: "Parser-aware workflow", desc: "Explain when a file is readable, partially readable, or needs another extraction path before the analysis goes too far." },
              { title: "Technical reasoning", desc: "Reason from source evidence, calculations, project context, and physical constraints instead of a blank prompt." },
              { title: "PDF extraction", desc: "Upload papers, decks, reports, and spec sheets so the first pass starts from the material you already have." },
              { title: "Project workspace", desc: "Keep files, runs, notes, artifacts, generated outputs, and follow-up questions connected to the same project." },
              { title: "Exports", desc: "Create briefs, reports, and supporting artifacts that can travel outside the workspace." },
              { title: "First-principles lens", desc: "Bring physical and thermodynamic rigor into conversations where headline numbers or raw totals can be misleading." },
              { title: "Risk language", desc: "Surface uncertainty, missing inputs, unsupported claims, and weak assumptions in plain language." },
              { title: "Next-measurement plans", desc: "Turn uncertainty into a practical list of data, tests, or context that would make the work stronger." },
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
            Create a project and let the agent start turning complex technical evidence into a useful brief.
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
