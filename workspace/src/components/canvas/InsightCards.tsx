// @ts-nocheck
"use client";

/**
 * InsightCards — renders structured insights as clean cards.
 */

import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, HelpCircle, ShieldAlert, ArrowRight } from "lucide-react";

interface InsightCardData {
  insight_id: string;
  rank: number;
  title: string;
  insight_type: string;
  severity: string;
  confidence: number;
  why_it_matters: string;
  evidence_refs: string[];
  modules_impacted: string[];
  what_would_change_this: string;
  source_type: string;
  policy_ref?: string;
}

const TYPE_CONFIG: Record<string, { label: string; icon: typeof AlertTriangle; color: string }> = {
  blocker:     { label: "Blocker",            icon: ShieldAlert,   color: "text-destructive" },
  risk:        { label: "Risk",               icon: AlertTriangle, color: "text-[var(--accent-amber)]" },
  uncertainty: { label: "Open Question",      icon: HelpCircle,    color: "text-blue-400" },
  advantage:   { label: "Strength",           icon: CheckCircle2,  color: "text-[var(--accent-green)]" },
  next_step:   { label: "Recommended Action", icon: ArrowRight,    color: "text-primary" },
};

export function InsightCards({ insights }: { insights: InsightCardData[] }) {
  if (!insights || insights.length === 0) return null;

  return (
    <div className="divide-y divide-border">
      {insights.map((insight) => {
        const cfg = TYPE_CONFIG[insight.insight_type] || TYPE_CONFIG.uncertainty;
        const Icon = cfg.icon;
        return (
          <div key={insight.insight_id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start gap-2.5 mb-1">
              <Icon className={cn("size-4 mt-0.5 shrink-0", cfg.color)} />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <p className="text-sm font-medium text-foreground leading-snug">
                    {insight.title}
                  </p>
                  <span className="shrink-0 text-[12px] text-muted-foreground/60 uppercase tracking-wider">
                    {cfg.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                  {insight.why_it_matters}
                </p>
                {insight.what_would_change_this && (
                  <p className="text-[12px] text-muted-foreground/60 mt-1.5 flex items-center gap-1">
                    <ArrowRight className="size-3 shrink-0" />
                    {insight.what_would_change_this}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
