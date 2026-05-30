import { startAgentRun } from "@/lib/agent-runner";
import { getStorage } from "@/lib/storage";
import type { AgentRun } from "@/lib/storage/types";

const active = new Set<string>();
const pending: Array<{ projectId: string; runId: string }> = [];
const terminal = new Set<AgentRun["status"]>(["completed", "failed", "cancelled"]);
const runnable = new Set<AgentRun["status"]>(["queued"]);

function key(projectId: string, runId: string): string {
  return `${projectId}:${runId}`;
}

function maxConcurrentRuns(): number {
  const raw = Number(process.env.AGENT_RUN_WORKER_CONCURRENCY || 2);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
}

function drain(): void {
  while (active.size < maxConcurrentRuns() && pending.length > 0) {
    const next = pending.shift();
    if (!next) return;
    const runKey = key(next.projectId, next.runId);
    if (active.has(runKey)) continue;
    active.add(runKey);
    void startAgentRun(next.projectId, next.runId)
      .catch(() => {
        // startAgentRun persists failure state; this guard prevents unhandled
        // worker rejections from taking down the request process.
      })
      .finally(() => {
        active.delete(runKey);
        drain();
      });
  }
}

export function enqueueAgentRun(projectId: string, runId: string): void {
  const runKey = key(projectId, runId);
  if (active.has(runKey)) return;
  if (pending.some((item) => key(item.projectId, item.runId) === runKey)) return;
  pending.push({ projectId, runId });
  setTimeout(drain, 0);
}

export async function resumeRunnableAgentRuns(projectId: string): Promise<void> {
  const storage = getStorage();
  const runs = await storage.listAgentRuns(projectId);
  for (const run of runs) {
    if (terminal.has(run.status) || !runnable.has(run.status)) continue;
    enqueueAgentRun(projectId, run.id);
  }
}

export function activeAgentRunIds(projectId: string): string[] {
  const prefix = `${projectId}:`;
  return Array.from(active)
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length));
}
