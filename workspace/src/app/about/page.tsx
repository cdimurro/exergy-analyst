"use client";

const natureExploreUrl =
  process.env.NEXT_PUBLIC_NATURE_ENGINE_EXPLORE_URL || "/nature/explorer";

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
            Energy work is becoming too complex for clean slides and isolated spreadsheets. We built Exergy Lab
            as a powerful agentic workspace for making messy evidence legible, useful, and alive.
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
                The most important energy questions rarely arrive as complete datasets. They arrive as a mix of
                PDFs, vendor claims, sensor exports, rough assumptions, lab notes, and half-formed models. The work
                is not just analysis. It is translation.
              </p>
              <p className="text-[17px] text-[#8a9aae] leading-[1.8]">
                We wanted a place where people could bring that mess and begin moving toward clarity. A powerful
                technical agent that can read, extract, organize, model, explain, and generate useful artifacts while
                still showing what the evidence can and cannot support.
              </p>
            </div>
            <div className="lg:w-1/2 space-y-6">
              {[
                { stat: "Files", label: "read for signals, claims, assumptions, and gaps" },
                { stat: "Models", label: "built around visible assumptions and useful boundaries" },
                { stat: "Briefs", label: "generated to help teams understand what to do next" },
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
                title: "Evidence first",
                body: "The agent starts with what is actually in front of it: uploaded documents, structured data, stated assumptions, and user intent. It can pull structure out of rough material while preserving the difference between measured facts, inferred values, useful estimates, and claims that still need support.",
              },
              {
                title: "Physical context matters",
                body: "Energy is not just a market category. It is heat, work, mass, pressure, time, place, degradation, uncertainty, and constraint. Exergy Lab was built to keep that physical reality close to the agent's reasoning.",
              },
              {
                title: "Uncertainty should be visible",
                body: "A powerful agent should not make every answer sound finished. It should make the boundary of each answer easier to see. A useful brief should say what the evidence supports and what still needs measurement, review, or judgment.",
              },
              {
                title: "Built for serious curiosity",
                body: "The people working on energy systems need better ways to explore, question, compare, model, brief, and explain. Exergy Lab is for founders, engineers, researchers, investors, operators, and project teams who want the next conversation to be sharper than the last one.",
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
              { title: "Evidence intake", desc: "Turn uploaded files, scattered notes, and rough data into a clearer picture of what is known, assumed, and missing." },
              { title: "Technical exploration", desc: "Use the agent to ask better engineering questions, sketch useful calculations, and find the physical constraints that shape a problem." },
              { title: "Project framing", desc: "Move from vague technology claims to a more useful map of assumptions, comparisons, open questions, and next steps." },
              { title: "Research support", desc: "Bring papers, datasheets, and public context into the same workspace so the technical story is easier to follow." },
              { title: "Decision briefs", desc: "Generate concise summaries, visuals, and supporting artifacts that help teams understand the direction of travel." },
              { title: "Risk discovery", desc: "Surface the gaps, conflicts, unknowns, and weak assumptions that should be understood before a claim becomes a plan." },
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
            We did not build another generic chat window and give it an energy logo. We built a workspace around
            a powerful technical agent for energy evidence, uncertainty, models, generated artifacts, and the
            questions that move projects forward.
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
                  { row: "Starting point", us: "Messy evidence plus agentic workflow", them1: "Prompt text", them2: "Scoped engagement" },
                  { row: "Energy context", us: "Built in", them1: "General", them2: "Expert-dependent" },
                  { row: "Model boundary", us: "Visible", them1: "Often implicit", them2: "Documented later" },
                  { row: "Output shape", us: "Briefs, charts, models, and artifacts", them1: "Conversation", them2: "Report" },
                  { row: "Best use", us: "Deep technical exploration", them1: "General reasoning", them2: "Formal diligence" },
                  { row: "Uncertainty", us: "Part of the answer", them1: "Easy to smooth over", them2: "Varies by team" },
                  { row: "Momentum", us: "Immediate next artifacts", them1: "Fast draft", them2: "Deep but slower" },
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
            Exergy Lab Nature explores the same idea in living systems: bringing fragmented evidence,
            place-based context, generated briefs, and clearer questions into restoration work.
          </p>
          <a href={natureExploreUrl} className="inline-flex items-center gap-2 text-[16px] font-medium text-[#00bf63] hover:text-[#6ad0bc] transition-colors">
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
              Helping energy ideas become easier to understand
            </span>
          </h2>
          <p className="text-[17px] text-[#7a8a9e] mb-10 leading-relaxed">
            The future will be built from imperfect evidence, unfinished models, and people willing to ask better
            questions. Exergy Lab exists to make that work faster, deeper, and easier to explain.
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
