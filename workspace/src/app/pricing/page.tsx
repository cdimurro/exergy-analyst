// @ts-nocheck
"use client";

import Link from "next/link";

const PLANS = [
  {
    name: "Free", price: "$0", period: "",
    desc: "Try the platform. See how it works.",
    features: ["3 saved projects", "5 AI messages per day", "Basic extraction (10 parameters)", "Community support"],
    excluded: ["Decision briefs", "Full comprehensive extraction", "Memory vault", "API access"],
    cta: "Get Started", href: "/signup",
  },
  {
    name: "Plus", price: "$19", period: "/month",
    desc: "For professionals evaluating technologies.",
    highlight: true,
    features: ["50 saved projects", "Unlimited AI messages", "Full comprehensive extraction", "Decision briefs + PDF export", "10-module evaluation", "Priority processing"],
    excluded: ["Memory vault", "API access", "Team features"],
    cta: "Start Plus", href: "/signup",
  },
  {
    name: "Pro", price: "$99", period: "/month",
    desc: "For teams and organizations.",
    features: ["Unlimited projects", "Unlimited AI messages", "Full comprehensive extraction", "Decision briefs + PDF export", "10-module evaluation", "Memory vault", "API access", "Advanced reasoning", "Priority support"],
    excluded: [],
    cta: "Start Pro", href: "/signup",
  },
];

const FAQ = [
  { q: "Can I try the platform before signing up?", a: "Yes. Anyone can create a project and use the AI chat without an account. You will hit usage limits quickly, but you can see exactly how the platform works before signing up." },
  { q: "What happens to my data?", a: "Your uploaded documents and conversations are encrypted at rest and never shared with third parties. We uphold the highest levels of privacy and security." },
  { q: "Can I change plans later?", a: "Yes. You can upgrade or downgrade at any time. Changes take effect at the start of your next billing period." },
  { q: "What payment methods do you accept?", a: "We use Square for payment processing. You can pay with any major credit or debit card." },
  { q: "What is the Memory Vault?", a: "The Memory Vault (Pro only) lets you store business context that the AI agent uses when analyzing technologies. For example, your investment thesis, technical requirements, or compliance rules." },
];

export default function PricingPage() {
  return (
    <div className="bg-[#080c16] min-h-[calc(100vh-3.5rem)]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-[28px] sm:text-[32px] font-bold text-[#d0d8e4] mb-2 tracking-tight">Plans and Pricing</h1>
          <p className="text-[15px] text-[#6a7a8e]">Upgrade to unlock more value.</p>
        </div>

        {/* Plan cards — same style as homepage */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-20">
          {PLANS.map((plan) => (
            <div key={plan.name} className="group relative">
              {plan.highlight && <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-[#4db8a4]/25 to-[#5b8dd9]/10" />}
              <div className={`relative rounded-2xl border bg-[#0d1220]/80 p-6 flex flex-col h-full transition-all ${plan.highlight ? "border-[#2a5a6a]" : "border-[#1a2538]"} group-hover:border-[#2a4a5a]`}>
                <div className="mb-5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[17px] font-semibold text-[#d0d8e4]">{plan.name}</h3>
                    {plan.highlight && <span className="text-[9px] font-bold text-[#4db8a4] tracking-wider uppercase px-2 py-0.5 rounded-full bg-[#4db8a4]/10">Best Value</span>}
                  </div>
                  <p className="text-[12px] text-[#5a6a7e] mt-1">{plan.desc}</p>
                  <div className="mt-3">
                    <span className="text-[36px] font-bold text-[#e0e6f0]">{plan.price}</span>
                    {plan.period && <span className="text-[14px] text-[#4a5a6e]">{plan.period}</span>}
                  </div>
                </div>

                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-[13px] text-[#7a8a9e]">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#4db8a4" strokeWidth="1.5" strokeLinecap="round" className="shrink-0"><path d="M3 7l3 3 5-5"/></svg>
                      {f}
                    </li>
                  ))}
                  {plan.excluded.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-[13px] text-[#3a4a5a]">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#3a4a5a" strokeWidth="1.5" strokeLinecap="round" className="shrink-0"><path d="M4 4l6 6M10 4l-6 6"/></svg>
                      {f}
                    </li>
                  ))}
                </ul>

                <Link href={plan.href}>
                  <button className={`w-full py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                    plan.highlight
                      ? "text-white bg-gradient-to-r from-[#4a7a6a] to-[#3a6a8a] hover:from-[#5a8a7a] hover:to-[#4a7a9a] shadow-lg"
                      : "text-[#7a8a9e] bg-[#111828] border border-[#1a2538] hover:border-[#2a4a5a] hover:text-[#a0aab8]"
                  }`}>
                    {plan.cta}
                  </button>
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-[20px] font-bold text-[#d0d8e4] text-center mb-8 tracking-tight">Frequently Asked Questions</h2>
          <div className="space-y-3">
            {FAQ.map((item) => (
              <div key={item.q} className="rounded-xl border border-[#1a2538] bg-[#0d1220]/60 p-5">
                <h3 className="text-[14px] font-semibold text-[#d0d8e4] mb-2">{item.q}</h3>
                <p className="text-[13px] text-[#6a7a8e] leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
