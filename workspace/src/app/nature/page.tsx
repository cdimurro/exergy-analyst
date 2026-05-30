import Link from "next/link";

const DOMAINS = [
  { name: "Reforestation & Native Habitat", status: "Active", icon: "🌲" },
  { name: "Mangrove & Wetland", status: "Coming Soon", icon: "🌿" },
  { name: "Coral Reef", status: "Coming Soon", icon: "🪸" },
  { name: "Watershed & Freshwater", status: "Coming Soon", icon: "💧" },
  { name: "Biodiversity Corridor", status: "Coming Soon", icon: "🦋" },
  { name: "Grassland & Savanna", status: "Coming Soon", icon: "🌾" },
];

const CAPABILITIES = [
  {
    title: "40-Year Satellite History",
    desc: "Landsat (1984-present) and Sentinel-2 (2017-present) archives assembled automatically for any site on Earth.",
  },
  {
    title: "Biodiversity Intelligence",
    desc: "2.4 billion species occurrence records from GBIF cross-referenced with habitat suitability models.",
  },
  {
    title: "Carbon Verification",
    desc: "Independent verification of sequestration claims against physical limits, with hard-fail gates for impossible values.",
  },
  {
    title: "10-Module Governance",
    desc: "Every site assessed across ecological integrity, biodiversity, carbon, hydrology, regulatory compliance, feasibility, risk, scalability, integration, and additionality.",
  },
  {
    title: "Evidence-Bounded Diligence",
    desc: "Produces assessment packets with evidence receipts, provenance chains, and confidence levels that stay bounded by the available proof.",
  },
  {
    title: "Compounding Knowledge",
    desc: "Every assessment teaches the system. After thousands of sites: calibrated understanding of what restoration actually delivers.",
  },
];

export default function NaturePage() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a2e1a] via-[#0d1f2d] to-[#0a1628]" />
        <div className="relative max-w-5xl mx-auto px-6 py-24 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[12px] font-medium mb-6">
            Exergy Lab Nature
          </div>
          <h1 className="text-[42px] sm:text-[56px] font-bold text-white leading-[1.1] mb-6">
            The trust layer for the<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">
              global restoration economy
            </span>
          </h1>
          <p className="text-[18px] text-[#8fa4b8] max-w-2xl mx-auto leading-relaxed mb-10">
            Proving that nature restoration actually works — with benchmark-grade evidence
            that funders, governments, insurers, and credit buyers can rely on.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/"
              className="px-6 py-3 rounded-xl bg-emerald-500 text-white font-semibold text-[15px] hover:bg-emerald-400 transition-colors">
              Explore Exergy Lab
            </Link>
            <a href="mailto:chris@exergy-lab.com"
              className="px-6 py-3 rounded-xl border border-[#2a4a3a] text-emerald-300 font-semibold text-[15px] hover:bg-emerald-500/10 transition-colors">
              Request Early Access
            </a>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="max-w-4xl mx-auto px-6 py-20">
        <h2 className="text-[28px] font-bold text-[var(--text-primary)] text-center mb-4">
          The restoration economy has a credibility crisis
        </h2>
        <p className="text-[16px] text-[var(--text-secondary)] text-center max-w-2xl mx-auto leading-relaxed mb-12">
          Carbon credits are being discredited. Biodiversity offsets are called greenwashing.
          Government restoration commitments lack verification. The fundamental problem:
          no one can prove that restoration works, with evidence that survives scrutiny.
        </p>
        <div className="grid sm:grid-cols-3 gap-6">
          {[
            { q: "Is this site worth restoring?", a: "Baseline condition, suitability, connectivity analysis" },
            { q: "Are these claims real?", a: "Independent verification with hard-fail gates" },
            { q: "Is the project on track?", a: "Trajectory monitoring, deviation detection, early warning" },
          ].map((item, i) => (
            <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <p className="text-[14px] font-semibold text-emerald-400 mb-2">{item.q}</p>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Capabilities */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-[28px] font-bold text-[var(--text-primary)] text-center mb-12">
          What it does
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {CAPABILITIES.map((cap, i) => (
            <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-2">{cap.title}</h3>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">{cap.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Domains */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-[28px] font-bold text-[var(--text-primary)] text-center mb-12">
          Restoration domains
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {DOMAINS.map((d, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <span className="text-[20px]">{d.icon}</span>
              <div>
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">{d.name}</p>
                <p className={`text-[11px] font-medium ${d.status === "Active" ? "text-emerald-400" : "text-[var(--text-dim)]"}`}>
                  {d.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h2 className="text-[24px] font-bold text-[var(--text-primary)] mb-4">
          Built by the team behind Exergy Lab
        </h2>
        <p className="text-[15px] text-[var(--text-muted)] mb-8 leading-relaxed">
          The same benchmark-grade evaluation methodology that validates energy technologies,
          applied to proving that ecological restoration delivers real outcomes.
        </p>
        <Link href="/"
          className="inline-block px-6 py-3 rounded-xl bg-emerald-500 text-white font-semibold text-[15px] hover:bg-emerald-400 transition-colors">
          Back to Exergy Lab
        </Link>
      </section>
    </div>
  );
}
