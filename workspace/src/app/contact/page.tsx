"use client";

import { useState } from "react";

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      setStatus("sent");
      setForm({ name: "", email: "", subject: "", message: "" });
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="bg-[#080c16]">
      <section className="relative py-24 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] opacity-[0.05]"
          style={{ background: "radial-gradient(ellipse at center, #4db8a4 0%, transparent 70%)", filter: "blur(80px)" }} />

        <div className="relative max-w-3xl mx-auto px-6 sm:px-10 lg:px-16">
          <div className="text-center mb-14">
            <h1 className="text-[36px] sm:text-[46px] font-bold tracking-tight text-[#d0d8e4] mb-6">
              Get in touch
            </h1>
            <p className="text-[18px] text-[#8a9aae] leading-[1.8]">
              Have a question, partnership inquiry, or feedback? We'd love to hear from you.
            </p>
          </div>

          {status === "sent" ? (
            <div className="rounded-2xl border border-[#2a4a5e] bg-[#0d1a28]/60 p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-[#4db8a4]/10 border border-[#4db8a4]/30 flex items-center justify-center mx-auto mb-6">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4db8a4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12l2 2 4-4"/>
                  <circle cx="12" cy="12" r="10"/>
                </svg>
              </div>
              <h2 className="text-[24px] font-semibold text-[#d0d8e4] mb-3">Message sent</h2>
              <p className="text-[17px] text-[#7a8a9e]">Thanks for reaching out. We'll get back to you soon.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-[14px] font-medium text-[#8a9aae] mb-2">Name</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl bg-[#0d1220] border border-[#1a2a3e] text-[16px] text-[#d0d8e4] placeholder-[#3a4a5e] focus:outline-none focus:border-[#2a4a6a] transition-colors"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-medium text-[#8a9aae] mb-2">Email</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl bg-[#0d1220] border border-[#1a2a3e] text-[16px] text-[#d0d8e4] placeholder-[#3a4a5e] focus:outline-none focus:border-[#2a4a6a] transition-colors"
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[14px] font-medium text-[#8a9aae] mb-2">Subject</label>
                <select
                  value={form.subject}
                  onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                  required
                  className="w-full px-4 py-3 rounded-xl bg-[#0d1220] border border-[#1a2a3e] text-[16px] text-[#d0d8e4] focus:outline-none focus:border-[#2a4a6a] transition-colors appearance-none"
                >
                  <option value="" disabled className="text-[#3a4a5e]">Select a topic</option>
                  <option value="general">General inquiry</option>
                  <option value="partnership">Partnership opportunity</option>
                  <option value="enterprise">Enterprise plan</option>
                  <option value="technical">Technical question</option>
                  <option value="feedback">Product feedback</option>
                  <option value="media">Media / press</option>
                </select>
              </div>

              <div>
                <label className="block text-[14px] font-medium text-[#8a9aae] mb-2">Message</label>
                <textarea
                  required
                  rows={6}
                  value={form.message}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-[#0d1220] border border-[#1a2a3e] text-[16px] text-[#d0d8e4] placeholder-[#3a4a5e] focus:outline-none focus:border-[#2a4a6a] transition-colors resize-none"
                  placeholder="Tell us how we can help..."
                />
              </div>

              <button
                type="submit"
                disabled={status === "sending"}
                className="group relative w-full py-4 rounded-xl text-[17px] font-semibold text-white overflow-hidden transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-[#4a7a6a] to-[#3a6a8a]" />
                <div className="absolute inset-0 bg-gradient-to-r from-[#5a8a7a] to-[#4a7a9a] opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="relative">
                  {status === "sending" ? "Sending..." : "Send Message"}
                </span>
              </button>

              {status === "error" && (
                <p className="text-[15px] text-[#c87a7a] text-center">Something went wrong. Please try again.</p>
              )}
            </form>
          )}

          <div className="mt-16 pt-12 border-t border-[#141c2c]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 text-center">
              <div>
                <h3 className="text-[17px] font-semibold text-[#d0d8e4] mb-2">Email</h3>
                <a href="mailto:support@exergylab.com" className="text-[16px] text-[#5ba8c8] hover:text-[#7ac0d8] transition-colors">
                  support@exergylab.com
                </a>
              </div>
              <div>
                <h3 className="text-[17px] font-semibold text-[#d0d8e4] mb-2">Response time</h3>
                <p className="text-[16px] text-[#7a8a9e]">Usually within 24 hours</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
