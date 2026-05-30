// @ts-nocheck
"use client";

/* eslint-disable @next/next/no-img-element */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProjectCreator } from "@/components/ProjectCreator";

/* Warm up Gemma 4 API on page load so first user request is fast */
function useApiWarmup() {
  useEffect(() => {
    fetch("/api/warmup").catch(() => {});
  }, []);
}

/* ── Example Prompt ──────────────────────────────── */

function ExamplePrompt({ text, prompt, domain, name }: {
  text: string; prompt: string; domain: string; name: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: prompt, goal: "", domain }),
      });
      const project = await res.json();
      router.push(`/projects/${project.id}?q=${encodeURIComponent(prompt)}`);
    } catch {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="text-left w-full px-5 py-4 rounded-xl border border-[var(--border-mid)] bg-[var(--bg-card)] text-[15px] text-[#d0dae8] leading-relaxed transition-all hover:border-[#4a6a7a] hover:text-[#e0e8f0] hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
    >
      {loading ? (
        <span className="flex items-center gap-2 text-[#6a7a8e]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="animate-spin shrink-0">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2"/>
            <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Creating project...
        </span>
      ) : (
        <span>&ldquo;{text}&rdquo;</span>
      )}
    </button>
  );
}

/* ── Page ─────────────────────────────────────────── */

export default function HomePage() {
  useApiWarmup();
  return (
    <div className="bg-[#080c16]">

      {/* ═══════════════════════════════════════════════
          HERO
          ═══════════════════════════════════════════════ */}
      <section className="relative min-h-[92vh] flex flex-col items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <video autoPlay muted loop playsInline className="w-full h-full object-cover"
            style={{ opacity: 0.45, filter: "saturate(1.2) brightness(1.2)" }}>
            <source src="/videos/hero-bg.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-b from-[#080c16]/95 via-[#080c16]/50 to-[#080c16]" />
        </div>
        <div className="absolute top-[-15%] left-1/2 -translate-x-1/2 w-[1000px] h-[500px] opacity-[0.15]"
          style={{ background: "radial-gradient(ellipse at center, #3a8a7a 0%, #2a5a6a 35%, transparent 70%)", filter: "blur(60px)" }} />

        <div className="relative w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-16 pt-12 sm:pt-20 pb-12">
          <h1 className="text-[36px] sm:text-[46px] lg:text-[54px] font-bold tracking-[-0.03em] leading-[1.08] text-center mb-5 mt-4">
            <span className="text-[#e8ecf4] whitespace-nowrap">The world&#39;s first</span>
            <br />
            <span className="bg-gradient-to-r from-[#4db8a4] via-[#5ba8c8] to-[#5b8dd9] bg-clip-text text-transparent">
              energy foundation system.
            </span>
          </h1>
          <p className="text-[18px] sm:text-[20px] text-[#d0d8e4] mx-auto leading-relaxed text-center mb-10 whitespace-nowrap">
            A new engine for accelerating energy innovation and scientific discovery.
          </p>

          <ProjectCreator variant="hero" />

          <div className="mt-10 space-y-2.5 max-w-3xl mx-auto">
            <ExamplePrompt
              text="Can you evaluate this new NMC 811 battery cathode claiming 245 Wh/kg and 1200 cycles? Is that physically possible and commercially competitive?"
              name="NMC 811 Cathode Evaluation" domain="battery_ecm"
              prompt="Evaluate the deployment readiness of a new NMC 811 lithium-ion battery cathode material with the following claimed specifications: energy density of 245 Wh/kg, specific capacity of 200 mAh/g, cycle life of 1200 cycles to 80% retention at 1C/1C 25°C, charging rate capability up to 3C, operating temperature range -20°C to 55°C, and cathode loading of 25 mg/cm². The material uses a single-crystal morphology with aluminum and titanium co-doping for structural stability. Assess whether these claims are physically plausible, how they compare to published benchmarks for NMC 811, what the key failure modes and degradation risks are, and whether this is competitive enough for commercial EV or grid storage applications."
            />
            <ExamplePrompt
              text="Simulate the energy production ofa 580W TOPCon solar module located at 24.1456 N, 54.5139 E. What is the expected lifetime after thermal derating, soiling, and UV degradation?"
              name="TOPCon Desert Performance" domain="pv_iv"
              prompt="Simulate the performance of a 580W TOPCon bifacial solar PV module deployed in a utility-scale desert installation located at 24.1456 N, 54.5139 E (ambient temperatures reaching 50°C, irradiance up to 1100 W/m², high UV index, and sand/dust soiling). The module specifications are: Pmax 580W at STC, Voc 51.8V, Isc 14.08A, efficiency 22.5%, temperature coefficient of Pmax -0.30%/°C, 144 half-cut cells, N-type TOPCon technology with bifaciality factor 0.80. I need to understand: The actual power output at 50°C cell temperature vs STC rating, the annual energy yield accounting for thermal derating and soiling losses, how bifacial gain performs with high-albedo desert sand, what the expected degradation rate under extreme UV and thermal cycling is, and whether this module is the right choice compared to HJT or PERC alternatives for this environment."
            />
            <ExamplePrompt
              text="Evaluate a 250 MWt pressurized water SMR. Compute neutron multiplication, core thermal limits, safety margins, and whether the physics actually support commercial deployment of this reactor."
              name="250 MWt PWR SMR Physics" domain="nuclear_fission"
              prompt="I'm evaluating a small modular reactor concept based on an integral pressurized water reactor design. Here are the core specifications: 250 MWt thermal power, 4.95% enriched UO2 fuel, standard 17x17 fuel assembly geometry (fuel pellet OD 8.19mm, cladding OD 9.52mm, pin pitch 12.6mm), 2-meter active core height, system pressure 12.76 MPa, coolant inlet temperature 258°C, and total coolant flow rate of 587 kg/s. I need you to: Compute the neutron multiplication factor (k-effective) and tell me whether this core can sustain a fission chain reaction with adequate reactivity margin for control and burnup. Calculate the peak fuel centerline temperature and verify it stays well below the UO2 melting point of 2840°C. Determine the minimum departure from nucleate boiling ratio (DNBR) and confirm adequate thermal margin exists above the safety limit of 1.3. Compute the Doppler and moderator temperature coefficients of reactivity and confirm both are negative, which is essential for inherent safety. Calculate the decay heat at 1 hour and 24 hours after shutdown to assess passive cooling requirements. Estimate the net electrical output and thermal efficiency of the balance-of-plant steam cycle. Then assess: is this design physically viable for deployment? What are the key thermal-hydraulic margins, and where are the physics-based risks? Compare the results to published NuScale and AP1000 parameters where relevant."
            />
            <p className="text-[15px] text-[#6a7a8e] italic text-left mt-1.5">Click on an example to get started.</p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          NUMBERS + MISSION — merged into one section
          ═══════════════════════════════════════════════ */}
      <section className="relative border-y border-[#141c2c] bg-[#0a0f1a]/90">
        <div className="max-w-7xl mx-auto py-12 px-6 sm:px-10 lg:px-16">
          <p className="text-[22px] sm:text-[22px] text-[#b0bcc8] leading-relaxed text-center max-w-4xl mx-auto">
            Exergy Lab was designed to help energy companies solve the{" "}
            <span className="bg-gradient-to-r from-[#4db8a4] to-[#4db8a4] bg-clip-text text-transparent font-semibold">"valley of death"</span>{" "}
            <br></br>by evaluating whether energy technologies are ready for commercial success or not.
          </p>
          <div className="flex flex-wrap justify-center pt-10 gap-10 sm:gap-16 mb-10">
            {[
              { v: "100+", l: "Energy Domains" }, { v: "400+", l: "Reference Cases" },
              { v: "23", l: "Physics Solvers" }, { v: "10", l: "Eval Modules" },
            ].map(s => (
              <div key={s.l} className="text-center px-5 py-3">
                <div className="text-[36px] sm:text-[44px] font-bold tracking-tight bg-gradient-to-b from-[#e0e6f0] to-[#6a7a8e] bg-clip-text text-transparent leading-none">{s.v}</div>
                <div className="text-[12px] text-[#4a5a6e] font-semibold tracking-[0.2em] uppercase mt-2">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          WHAT IT IS — domain tags cloud
          ═══════════════════════════════════════════════ */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] opacity-[0.06]"
          style={{ background: "radial-gradient(circle at center, #5b8dd9 0%, transparent 70%)", filter: "blur(80px)" }} />
        <div className="relative w-full px-6 sm:px-10 lg:px-16 max-w-7xl mx-auto">
          <h2 className="text-[30px] sm:text-[38px] font-bold text-[#d0d8e4] tracking-tight text-center mb-14 whitespace-nowrap">
            A universal tool for analyzing{" "}
            <span className="bg-gradient-to-r from-[#4db8a4] to-[#5b8dd9] bg-clip-text text-transparent">any energy technology</span>
          </h2>
          <div className="flex flex-wrap gap-2 justify-center">
            {[
              "Lithium-Ion Batteries", "Solar PV", "Nuclear Fission", "Wind Turbines", "Fuel Cells",
              "Heat Pumps", "Electrolyzers", "Carbon Capture", "Geothermal", "Hydrogen Storage",
              "Grid-Scale Storage", "Inverters", "Supercapacitors", "Thermoelectrics", "Biofuels",
              "Concentrated Solar", "Ocean Energy", "Fusion", "Solid-State Batteries", "Redox Flow Batteries",
              "Perovskite PV", "Wave Energy", "Biomass", "Thermal Storage", "Absorption Chillers",
              "Advanced Conductors", "Enhanced Geothermal", "Advanced Membranes", "Advanced Nuclear Fuel",
              "Agrivoltaics", "Aluminum Smelting", "Ammonia Systems", "Aviation Propulsion", "Battery Recycling",
              "Biogas", "Building Envelope", "Carbon Utilization", "Catalyst Materials", "Cement Decarbonization",
              "Chemical Process", "Circuit Breakers", "Cogeneration CHP", "Compressed Air Storage",
              "Critical Minerals", "Data Center Energy", "Desalination", "Direct Lithium Extraction",
              "District Energy", "Electric Arc Furnace", "Electric Motors", "Electric Vehicles",
              "Electrochemical Sensors", "Energy Management", "Enzyme Biocatalysis", "FT Synthesis",
              "Flywheel Storage", "Food Processing Energy", "Fusion Materials", "Gravity Storage",
              "Grid Distribution", "Grid-Enhancing Tech", "Grid-Scale Inverters", "Grid Transmission",
              "PEM Electrolysis", "Heat Recovery ORC", "Hydrogen Fueling", "Hydrogen Transport",
              "Industrial Heat", "LED Lighting", "Liquid Air Storage", "Long Duration Storage",
              "Maritime Propulsion", "Methane Abatement", "Microgrids", "Mining Electrification",
              "Nuclear Waste Management", "Offshore Wind", "Piezoelectric Harvesting", "Plastic Recycling",
              "Power Quality", "Power Transformers", "Quantum Computing Energy", "Radioisotope Power",
              "Rail Electrification", "Rare Earth Processing", "Refrigeration", "Semiconductor Manufacturing",
              "Small Wind", "Smart Glass", "Small Modular Reactors", "Space-Based Solar",
              "Steel Decarbonization", "Superconductors", "Sustainable Agriculture", "Sustainable Materials",
              "Syngas Production", "Textile Recycling", "Thermoelectric Generators", "Thorium Cycle",
              "Variable Frequency Drives", "Vertical Farming", "Waste-to-Energy", "Water Treatment",
              "Carbon Negative", "Carbon Fiber Composites",
            ].map((t, i) => {
              const highlighted = [0, 2, 7, 11, 18, 26, 38, 50, 63, 74, 91, 101].includes(i);
              return (
                <span key={t} className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
                  highlighted
                    ? "border-[#2a4a6a] bg-[#0d1a28]/80 text-[#5ba8c8]"
                    : "border-[#1a2538] bg-[#0d1220]/60 text-[#5a6a7e] hover:border-[#2a3a5e] hover:text-[#7a8a9e]"
                }`}>
                  {t}
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          HOW IT WORKS — vertical timeline
          ═══════════════════════════════════════════════ */}
      <section className="relative border-y border-[#141c2c] bg-[#0a0e18] py-24 overflow-hidden">
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] opacity-[0.04]"
          style={{ background: "radial-gradient(circle at center, #4db8a4 0%, transparent 70%)", filter: "blur(80px)" }} />
        <div className="relative w-full px-6 sm:px-10 lg:px-16">
          <div className="text-center mb-20">
            <h2 className="text-[28px] sm:text-[34px] font-bold text-[#d0d8e4] tracking-tight">
              Three steps to deployment-grade insights
            </h2>
          </div>

          <div className="max-w-5xl mx-auto relative">
            {/* Vertical line */}
            <div className="hidden md:block absolute left-8 top-0 bottom-0 w-px bg-gradient-to-b from-[#4db8a4]/40 via-[#5ba8c8]/20 to-[#5b8dd9]/40" />

            <div className="space-y-16">
              {[
                { n: "1", title: "Describe what you're working on", body: "Upload a PDF, paste a research question, or just describe the application in plain language. The platform will automatically extract every detail and begin working on helping you find the best solution, or validating the technical feasibility by evaluating 10 high-value modules related to commercial viability." },
                { n: "2", title: "Run physics-backed simulations", body: "We analyze technologies using real physics solvers — thermodynamics, electrochemistry, power systems, structural mechanics. The platform identifies what's working, what's at risk, where the gaps are, what the published literature says about similar approaches, and works to find the best possible solution by running iteration loops until certain criteria are achieved." },
                { n: "3", title: "Receive actionable insights", body: "Within minutes, you get the complete picture. Detailed results, interactive charts, downloadable reports. You can ask the agent to build custom visualizations or modify parameters in real time. Everything is backed by physics and compared against published literature with real citations." },
              ].map(step => (
                <div key={step.n} className="flex gap-8 md:gap-12 items-start">
                  <div className="relative shrink-0">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#0d1a28] to-[#080c16] border border-[#2a4a5e] flex items-center justify-center z-10 relative">
                      <span className="text-[24px] font-bold bg-gradient-to-b from-[#4db8a4] to-[#5b8dd9] bg-clip-text text-transparent">{step.n}</span>
                    </div>
                  </div>
                  <div className="pt-2">
                    <h3 className="text-[22px] font-semibold text-[#d0d8e4] mb-3">{step.title}</h3>
                    <p className="text-[17px] text-[#7a8a9e] leading-[1.8]">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          WHAT YOU GET — contained alternating rows
          ═══════════════════════════════════════════════ */}
      <section className="relative py-24 overflow-hidden">
        <div className="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
          <div className="space-y-20">
            {/* Feature 1 — image left, text right */}
            <div className="flex flex-col lg:flex-row gap-12 items-center">
              <div className="lg:w-1/2">
                <div className="rounded-2xl overflow-hidden border border-[#1a2a3e]">
                  <img src="/images/feature-engineer.jpg" alt="" className="w-full h-80 object-cover" style={{ filter: "brightness(0.85)" }} />
                </div>
              </div>
              <div className="lg:w-1/2">
                <div className="w-100 h-0.5 bg-gradient-to-r from-[#4db8a4] to-transparent mb-6" />
                <h3 className="text-[24px] font-semibold text-[#d0d8e4] mb-5">Complete technology assessment</h3>
                <p className="text-[17px] text-[#8a9aae] leading-[1.8]">
                  A comprehensive report covering every dimension that matters — physics, performance, economics,
                  safety, regulatory, manufacturing, environment, scalability, integration, and strategic positioning.
                  Each dimension is assessed independently, so you see exactly where your technology is strong
                  and where it needs work. All results are downloadable as a custom PDF report at any time.
                </p>
              </div>
            </div>

            {/* Feature 2 — text left, image right */}
            <div className="flex flex-col lg:flex-row-reverse gap-12 items-center">
              <div className="lg:w-1/2">
                <div className="rounded-2xl overflow-hidden border border-[#1a2a3e]">
                  <img src="/images/feature-grid.jpg" alt="" className="w-full h-80 object-cover" style={{ filter: "brightness(0.85)" }} />
                </div>
              </div>
              <div className="lg:w-1/2">
                <div className="w-100 h-0.5 bg-gradient-to-r from-[#5ba8c8] to-transparent mb-6" />
                <h3 className="text-[24px] font-semibold text-[#d0d8e4] mb-5">Results grounded by real physics</h3>
                <p className="text-[17px] text-[#8a9aae] leading-[1.8]">
                  When the platform tells you a number, it comes from a real computational simulation — CoolProp for
                  refrigerant cycles, Cantera for electrochemistry, analytical loss models for power systems.
                  Results are calibrated, cross-checked and verified so you know exactly how much you can trust
                  each output. The engine wasn't built to be 100% accurate — it was built to make it impossible to hide uncertainty.
                </p>
              </div>
            </div>

            {/* Feature 3 — image left, text right */}
            <div className="flex flex-col lg:flex-row gap-12 items-center">
              <div className="lg:w-1/2">
                <div className="rounded-2xl overflow-hidden border border-[#1a2a3e]">
                  <img src="/images/feature-farm.jpg" alt="" className="w-full h-80 object-cover" style={{ filter: "brightness(0.85)" }} />
                </div>
              </div>
              <div className="lg:w-1/2">
                <div className="w-100 h-0.5 bg-gradient-to-r from-[#5b8dd9] to-transparent mb-6" />
                <h3 className="text-[24px] font-semibold text-[#d0d8e4] mb-5">A universal and capable tool</h3>
                <p className="text-[17px] text-[#8a9aae] leading-[1.8]">
                  No matter what technology you're working on, our job is to give you the tools you need to accelerate
                  innovation and discovery. Custom simulations, interactive dashboards, scientific database searches,
                  materials analysis — the platform is designed to be extremely capable and flexible, so you have
                  everything you need in one place.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          WHY TRUST IT — big quote + supporting points
          ═══════════════════════════════════════════════ */}
      <section className="relative border-y border-[#141c2c] bg-[#0a0e18] py-24 overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#2a4a6a]/50 to-transparent" />
        <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#2a4a6a]/50 to-transparent" />
        <div className="relative w-full px-6 sm:px-10 lg:px-16 max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row gap-16 items-start">
            {/* Left — bold statement */}
            <div className="lg:w-1/2 lg:sticky lg:top-32">
              <h2 className="text-[28px] sm:text-[36px] font-bold leading-[1.2] tracking-tight mb-6">
                <span className="text-[#FFFFFF] italic">"You can't trust ChatGPT to tell you if a nuclear reactor is safe."</span>
                <br />
              </h2>
              <p className="text-[17px] text-[#7a8a9e] leading-[1.8]">
                The entire Exergy Lab architecture was designed to separate non-deterministic outputs from LLM's, and deterministic outputs from physics solvers.
                That separation at the foundation of every result that the platform prouduces, and it's why you can trust the outputs from Exergy Lab.
              </p>
            </div>

            {/* Right — supporting points */}
            <div className="lg:w-1/2 space-y-8">
              <div className="border-l-2 border-[#4db8a4]/40 pl-8 py-2">
                <h3 className="text-[20px] font-semibold text-[#d0d8e4] mb-3">Real physics solvers</h3>
                <p className="text-[16px] text-[#7a8a9e] leading-[1.75]">
                  Every result runs through real computational engines — CoolProp for refrigerant cycles, Cantera for
                  electrochemistry, pvlib for photovoltaics, analytical loss models for power systems. Numbers come from
                  physics, not language model weights.
                </p>
              </div>
              <div className="border-l-2 border-[#5ba8c8]/40 pl-8 py-2">
                <h3 className="text-[20px] font-semibold text-[#d0d8e4] mb-3">Impossible to hide uncertainty</h3>
                <p className="text-[16px] text-[#7a8a9e] leading-[1.75]">
                  The engine wasn't built to be 100% accurate all the time — it was built to make it impossible to hide
                  uncertainty. Every output comes with calibrated confidence levels so you know exactly how much you can
                  trust each result.
                </p>
              </div>
              <div className="border-l-2 border-[#5b8dd9]/40 pl-8 py-2">
                <h3 className="text-[20px] font-semibold text-[#d0d8e4] mb-3">Honest about what it doesn't know</h3>
                <p className="text-[16px] text-[#7a8a9e] leading-[1.75]">
                  If the platform doesn't have enough data to produce a credible result, it says so — and tells you exactly
                  what additional information would improve the results. The system can never invent results or present
                  uncertain findings as definitive.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          WHO IT'S FOR
          ═══════════════════════════════════════════════ */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[800px] h-[400px] opacity-[0.05]"
          style={{ background: "radial-gradient(ellipse at center, #4db8a4 0%, transparent 70%)", filter: "blur(80px)" }} />
        <div className="relative w-full px-6 sm:px-10 lg:px-16">
          <div className="text-center mb-16">
            <h2 className="text-[28px] sm:text-[34px] font-bold text-[#d0d8e4] tracking-tight">
              Built for the people making energy decisions
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-7xl mx-auto">
            {[
              { role: "Founders", desc: "Prove your technology works before raising your next round. Gather evidence that de-risks your pitch and accelerates your timeline.", icon: "M13 10V3L4 14h7v7l9-11h-7z", color: "#4db8a4" },
              { role: "Investors", desc: "Conduct Due-diligence on novel energy technologies in hours, not weeks. Gain clarify before committing capital.", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z", color: "#5ba8c8" },
              { role: "Engineers", desc: "Find solutions faster with automated research and physics-based simulations. Understand the real-world performance before building.", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z", color: "#5b8dd9" },
            ].map(item => (
              <div key={item.role} className="group relative rounded-2xl border border-[#1a2a3e] bg-gradient-to-b from-[#0d1424] to-[#080c16] p-8 text-center transition-all hover:border-[#2a4a6a] hover:shadow-lg hover:shadow-[#5b8dd9]/5">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-px bg-gradient-to-r from-transparent" style={{ backgroundImage: `linear-gradient(to right, transparent, ${item.color}40, transparent)` }} />
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#1a2a4a] to-[#0d1424] border border-[#2a3a5e] flex items-center justify-center mx-auto mb-6 group-hover:border-[#3a5a7a] transition-colors">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={item.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={item.icon}/></svg>
                </div>
                <h3 className="text-[22px] font-semibold text-[#d0d8e4] mb-4">{item.role}</h3>
                <p className="text-[16px] text-[#7a8a9e] leading-[1.75]">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          PRICING
          ═══════════════════════════════════════════════ */}
      <section className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-16 py-20" id="pricing">
        <h2 className="text-[28px] sm:text-[34px] font-bold text-[#d0d8e4] text-center mb-12 tracking-tight">
          Start for free. Upgrade for more value.
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <PriceCard title="Free" price="$0" period=""
            features={["3 projects", "5 messages / day", "Basic extraction", "Community support"]}
            cta="Get Started" href="/signup" />
          <PriceCard title="Plus" price="$19" period="/mo"
            features={["50 projects", "Unlimited messages", "Full extraction + simulation", "Decision briefs + PDF export", "Priority processing"]}
            cta="Get Started" href="/signup" />
          <PriceCard title="Pro" price="$99" period="/mo"
            features={["Unlimited projects", "Memory vault", "API access", "Advanced reasoning", "Priority support", "Custom domains"]}
            cta="Get Started" href="/signup" />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          FINAL CTA
          ═══════════════════════════════════════════════ */}
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.45]">
          <video autoPlay muted loop playsInline className="w-full h-full object-cover object-bottom" style={{ filter: "saturate(1.3)" }}>
            <source src="/videos/cta-bg.mp4" type="video/mp4" />
          </video>
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-[#080c16] via-transparent to-[#080c16]" />
        <div className="relative max-w-7xl mx-auto px-6 sm:px-10 lg:px-16 text-center">
          <h2 className="text-[32px] sm:text-[42px] font-bold tracking-tight leading-tight mb-5">
            <span className="bg-gradient-to-r from-[#4db8a4] via-[#5ba8c8] to-[#5b8dd9] bg-clip-text text-transparent">
              Start innovating today
            </span>
          </h2>
          <p className="text-[18px] text-white mb-10">Create a project and see what you can discover.</p>
          <button className="group relative px-12 py-4 rounded-xl text-[17px] font-semibold text-white overflow-hidden transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-[#3a7a6a]/20"
            onClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); setTimeout(() => document.querySelector("textarea")?.focus(), 500); }}>
            <div className="absolute inset-0 bg-gradient-to-r from-[#4a7a6a] to-[#3a6a8a]" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#5a8a7a] to-[#4a7a9a] opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="relative">Create New Project</span>
          </button>
        </div>
      </section>
    </div>
  );
}

/* ── Price Card ───────────────────────────────────── */

function PriceCard({ title, price, period, features, cta, href }: {
  title: string; price: string; period: string; features: string[];
  cta: string; href: string;
}) {
  return (
    <div className="group relative">
      <div className="relative rounded-2xl border border-[#1a2538] bg-[#0d1220]/80 backdrop-blur-sm p-8 flex flex-col h-full transition-all group-hover:border-[#2a4a5a]">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <h3 className="text-[20px] font-semibold text-[#d0d8e4]">{title}</h3>
          </div>
          <div className="mt-3">
            <span className="text-[42px] font-bold text-[#e0e6f0]">{price}</span>
            {period && <span className="text-[16px] text-[#4a5a6e]">{period}</span>}
          </div>
        </div>
        <ul className="space-y-3 mb-8 flex-1">
          {features.map((f) => (
            <li key={f} className="flex items-center gap-3 text-[16px] text-[#8a9aae]">
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="#4db8a4" strokeWidth="1.5" strokeLinecap="round" className="shrink-0"><path d="M3 7l3 3 5-5"/></svg>
              {f}
            </li>
          ))}
        </ul>
        <Link href={href}>
          <button className="w-full py-3 rounded-xl text-[15px] font-semibold transition-all text-[#7a8a9e] bg-[#111828] border border-[#1a2538] hover:border-[#2a4a5a] hover:text-[#a0aab8]">
            {cta}
          </button>
        </Link>
      </div>
    </div>
  );
}
