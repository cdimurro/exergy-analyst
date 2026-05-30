export interface AgentTraceEvent {
  stage: string;
  decision: string;
  reason?: string;
  action?: string | null;
  type?: string | null;
  attachments?: string[];
  timestamp: string;
}

export function traceEvent(input: Omit<AgentTraceEvent, "timestamp">): AgentTraceEvent {
  return {
    ...input,
    timestamp: new Date().toISOString(),
  };
}

export function appendAgentTrace<T extends Record<string, unknown>>(
  response: T,
  event: Omit<AgentTraceEvent, "timestamp">,
): T {
  const existing = Array.isArray(response.agent_trace)
    ? response.agent_trace.filter((item): item is AgentTraceEvent =>
      !!item && typeof item === "object" && !Array.isArray(item) && typeof (item as AgentTraceEvent).stage === "string")
    : [];
  return {
    ...response,
    agent_trace: [...existing, traceEvent(event)].slice(-12),
  };
}
