"use client";

import {
  Brain,
  Check,
  ChevronDown,
  ListChecks,
  PlayCircle,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type AgentMode = "implement" | "plan";
export type ThinkingMode = "instant" | "expert";

export const AGENT_MODE_STORAGE_KEY = "exergy_agent_mode";
export const AGENT_MODE_DEFAULT_VERSION_KEY = "exergy_agent_mode_default_version";
export const THINKING_MODE_STORAGE_KEY = "exergy_thinking_mode";
export const THINKING_MODE_DEFAULT_VERSION_KEY = "exergy_thinking_mode_default_version";
export const AGENT_MODE_DEFAULT_VERSION = "implement_default_2026_05_24";
export const THINKING_MODE_DEFAULT_VERSION = "expert_default_2026_05_24";

export function cleanAgentMode(value: unknown): AgentMode {
  return value === "plan" ? "plan" : "implement";
}

export function cleanThinkingMode(value: unknown, fallback: ThinkingMode = "expert"): ThinkingMode {
  if (value === "instant" || value === "expert") return value;
  return fallback;
}

type SelectorOption<T extends string> = {
  value: T;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

interface ThemedSelectorProps<T extends string> {
  value: T;
  options: SelectorOption<T>[];
  onChange: (value: T) => void;
  title: string;
  disabled?: boolean;
  compact?: boolean;
}

function ThemedSelector<T extends string>({
  value,
  options,
  onChange,
  title,
  disabled = false,
  compact = false,
}: ThemedSelectorProps<T>) {
  const selected = options.find((option) => option.value === value) || options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          title={title}
          className={cn(
            "group inline-flex h-10 items-center gap-1.5 rounded-lg bg-transparent px-1.5 text-[13px] font-medium text-white/76 outline-none transition-colors hover:text-white focus-visible:text-white disabled:cursor-not-allowed disabled:opacity-40",
            compact ? "w-[190px]" : "w-[190px]",
          )}
        >
          <span className="whitespace-nowrap">{selected.label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-white/48 transition-colors group-hover:text-white/76" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={7}
        className="z-[80] min-w-[190px] rounded-xl border border-[#2a3358] bg-[#151d35] p-1.5 text-white shadow-[0_18px_50px_rgba(0,0,0,0.38)]"
      >
        {options.map((option) => {
          const OptionIcon = option.icon;
          const active = option.value === value;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onChange(option.value)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-white/82 outline-none transition-colors focus:bg-[#26304b] focus:text-white",
                active && "bg-[#26304b] text-white",
              )}
            >
              <OptionIcon className={cn("size-4 shrink-0", active ? "text-[#9fb8e8]" : "text-white/55")} />
              <span className="flex-1 truncate font-medium">{option.label}</span>
              {active && <Check className="size-4 shrink-0 text-[#4db8a4]" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface AgentInputControlsProps {
  agentMode: AgentMode;
  onAgentModeChange: (mode: AgentMode) => void;
  thinkingMode: ThinkingMode;
  onThinkingModeChange: (mode: ThinkingMode) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}

export function AgentInputControls({
  agentMode,
  onAgentModeChange,
  thinkingMode,
  onThinkingModeChange,
  disabled = false,
  compact = false,
  className,
}: AgentInputControlsProps) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <ThemedSelector
        value={agentMode}
        onChange={onAgentModeChange}
        disabled={disabled}
        compact={compact}
        title={agentMode === "implement" ? "Run suitable tools automatically" : "Draft plans and wait for approval"}
        options={[
          { value: "implement", label: "Mode: Implement", icon: PlayCircle },
          { value: "plan", label: "Mode: Plan", icon: ListChecks },
        ]}
      />
      <ThemedSelector
        value={thinkingMode}
        onChange={onThinkingModeChange}
        disabled={disabled}
        compact={compact}
        title={thinkingMode === "instant" ? "Instant answers right away" : "Expert thinks longer for better answers"}
        options={[
          { value: "expert", label: "Thinking Level: Expert", icon: Brain },
          { value: "instant", label: "Thinking Level: Instant", icon: Zap },
        ]}
      />
    </div>
  );
}
