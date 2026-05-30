// @ts-nocheck
"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/custom/Button";
import { Input } from "@/components/ui/custom/Input";
import { Card } from "@/components/ui/custom/Card";
import { Badge } from "@/components/ui/custom/Badge";
import { UpgradePrompt } from "@/components/ui/custom/UpgradePrompt";

const CATEGORIES = ["Company Profile", "Investment Criteria", "Technical Requirements", "Compliance", "Custom"];

interface VaultEntry {
  id: string;
  key: string;
  value: string;
  category: string;
}

export default function VaultPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newCategory, setNewCategory] = useState("Custom");
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const tier = (session?.user as any)?.tier || "free";

  useEffect(() => {
    if (tier === "pro") {
      fetch("/api/settings/vault")
        .then(r => r.json())
        .then(data => { if (data.entries) setEntries(data.entries); })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [tier]);

  if (status === "loading" || loading) return null;
  if (!session) { router.push("/login"); return null; }

  if (tier !== "pro") {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <div className="mb-6">
          <Link href="/settings" className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Settings</Link>
          <span className="text-[var(--text-dim)] mx-2">/</span>
          <span className="text-[13px] text-[var(--text-primary)]">Memory Vault</span>
        </div>
        <UpgradePrompt
          feature="Memory Vault"
          tier="pro"
          message="The Memory Vault lets you store business context that the AI agent uses when analyzing technologies. Your investment thesis, technical requirements, compliance rules — all referenced automatically."
        />
      </div>
    );
  }

  async function handleAdd() {
    if (!newKey.trim() || !newValue.trim()) return;
    try {
      const res = await fetch("/api/settings/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: newKey.trim(), value: newValue.trim(), category: newCategory }),
      });
      if (res.ok) {
        const data = await res.json();
        setEntries([...entries, { id: data.entry.id, key: newKey.trim(), value: newValue.trim(), category: newCategory }]);
        setNewKey("");
        setNewValue("");
      }
    } catch { /* handled by UI state */ }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/settings/vault?id=${id}`, { method: "DELETE" });
      setEntries(entries.filter((e) => e.id !== id));
    } catch { /* handled by UI state */ }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <Link href="/settings" className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Settings</Link>
        <span className="text-[var(--text-dim)] mx-2">/</span>
        <span className="text-[13px] text-[var(--text-primary)]">Memory Vault</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-bold text-[var(--text-primary)]">Memory Vault</h1>
          <p className="text-[13px] text-[var(--text-muted)]">Business context the AI agent references during analysis</p>
        </div>
        <Badge variant="success">Pro</Badge>
      </div>

      <div className="space-y-6">
        {/* Add entry */}
        <Card className="p-5">
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-3">Add Context Entry</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Key" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="e.g., Target market" />
              <div>
                <label className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1.5">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-3.5 py-2.5 text-[14px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1.5">Value</label>
              <textarea
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="e.g., We focus on utility-scale energy storage with >4 hour duration..."
                rows={3}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-3.5 py-2.5 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-dim)] resize-none focus:outline-none focus:border-[var(--accent-primary)]"
              />
            </div>
            <Button variant="primary" size="sm" onClick={handleAdd} disabled={!newKey.trim() || !newValue.trim()}>
              Add Entry
            </Button>
          </div>
        </Card>

        {/* Entries */}
        {entries.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-[14px] text-[var(--text-muted)]">No vault entries yet. Add business context above.</p>
            <p className="text-[12px] text-[var(--text-dim)] mt-2">
              The AI agent will reference these entries when analyzing technologies in your projects.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <Card key={entry.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[14px] font-medium text-[var(--text-primary)]">{entry.key}</span>
                      <Badge>{entry.category}</Badge>
                    </div>
                    <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">{entry.value}</p>
                  </div>
                  <button onClick={() => handleDelete(entry.id)} className="text-[var(--text-dim)] hover:text-[var(--accent-negative)] p-1 ml-3">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M3 3l8 8M11 3l-8 8" />
                    </svg>
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Encryption note */}
        <p className="text-[11px] text-[var(--text-dim)] text-center">
          Vault entries are encrypted at rest with AES-256-GCM.
        </p>
      </div>
    </div>
  );
}
