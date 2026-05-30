"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ProjectSummary, ArtifactSummary, ProjectDocument, Action, AgentRun } from "@/lib/storage/types";

interface ProjectDetail {
  id: string;
  name: string;
  description: string;
  goal: string;
  domain: string;
  created_at: string;
  updated_at: string;
  artifacts: ArtifactSummary[];
  documents: ProjectDocument[];
  actions: Action[];
  runs: AgentRun[];
}

/**
 * Smart polling: starts fast (2s), backs off to 10s when idle,
 * pauses when tab is hidden, resumes on focus.
 */
function useSmartInterval(callback: () => void, baseMs: number, maxMs: number) {
  const intervalRef = useRef(baseMs);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRef = useRef(true);

  const schedule = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (visibleRef.current) callback();
      schedule();
    }, intervalRef.current);
  }, [callback]);

  // Reset to fast polling (something changed)
  const resetInterval = useCallback(() => {
    intervalRef.current = baseMs;
  }, [baseMs]);

  // Back off (nothing changed)
  const backoff = useCallback(() => {
    intervalRef.current = Math.min(intervalRef.current * 1.5, maxMs);
  }, [maxMs]);

  useEffect(() => {
    schedule();

    const onVisibility = () => {
      visibleRef.current = document.visibilityState === "visible";
      if (visibleRef.current) {
        intervalRef.current = baseMs; // resume fast on focus
        callback(); // immediate refresh
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [schedule, callback, baseMs]);

  return { resetInterval, backoff };
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const prevCountRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
        setError(null);
        return data.length;
      }
      setError(`Failed to load projects (${res.status})`);
      return -1;
    } catch (e) {
      setError("Network error — check your connection");
      return -1;
    } finally {
      setLoading(false);
    }
  }, []);

  const { resetInterval, backoff } = useSmartInterval(async () => {
    const count = await refresh();
    if (count === prevCountRef.current) {
      backoff(); // nothing changed, slow down
    } else {
      prevCountRef.current = count;
      resetInterval(); // new data, poll fast
    }
  }, 3000, 15000);

  useEffect(() => { refresh(); }, [refresh]);

  const createProject = useCallback(
    async (data: { name: string; description: string; goal: string; domain: string }) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create project");
      const project = await res.json();
      resetInterval();
      await refresh();
      return project;
    },
    [refresh, resetInterval],
  );

  return { projects, loading, error, refresh, createProject };
}

export function useProjectDetail(projectId: string) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const prevUpdatedRef = useRef("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data);
        setError(null);
        return data.updated_at || "";
      }
      setError(`Failed to load project (${res.status})`);
      return "";
    } catch (e) {
      setError("Network error — check your connection");
      return "";
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const { resetInterval, backoff } = useSmartInterval(async () => {
    const updated = await refresh();
    if (updated === prevUpdatedRef.current) {
      backoff(); // no change, slow down
    } else {
      prevUpdatedRef.current = updated;
      resetInterval(); // something changed, poll fast
    }
  }, 2000, 10000);

  useEffect(() => { refresh(); }, [refresh]);

  const uploadDocument = useCallback(
    async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error("Upload failed");
      resetInterval();
      await refresh();
      return res.json();
    },
    [projectId, refresh, resetInterval],
  );

  const runAction = useCallback(
    async (type: string, input: Record<string, unknown>, parentArtifactId?: string) => {
      const backgroundTypes = new Set([
        "agent_workspace",
        "deep_analysis",
        "scientific_review",
        "deep_research",
        "deep_diligence",
      ]);
      const runInBackground = backgroundTypes.has(type) || input.background === true || input.long_running === true;
      const res = await fetch(`/api/projects/${projectId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          input,
          parent_artifact_id: parentArtifactId,
          trigger: parentArtifactId ? "branch" : "user",
          async: runInBackground,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.detail || err.error || "Tool run did not finish");
      }
      if (res.status === 202) {
        const started = await res.json();
        const actionId = started?.job?.id || started?.action?.id;
        if (!actionId) throw new Error("Action job did not return an id");
        resetInterval();
        const startedAt = Date.now();
        const timeoutMs = type === "agent_workspace" ? 20 * 60_000 : 15 * 60_000;
        let delayMs = 1500;
        while (Date.now() - startedAt < timeoutMs) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
          const statusRes = await fetch(`/api/projects/${projectId}/actions?action_id=${encodeURIComponent(actionId)}`, {
            cache: "no-store",
          });
          if (!statusRes.ok) {
            delayMs = Math.min(Math.round(delayMs * 1.25), 8000);
            continue;
          }
          const status = await statusRes.json();
          const action = status?.action;
          if (action?.status === "completed") {
            resetInterval();
            await refresh();
            return {
              action,
              artifact: status.artifact,
              result_summary: status.result_summary,
              job: { id: actionId, status: "completed" },
            };
          }
          if (action?.status === "failed" || action?.status === "cancelled") {
            throw new Error(action.error || `Action ${action.status}`);
          }
          delayMs = Math.min(Math.round(delayMs * 1.25), 8000);
        }
        throw new Error("Action is still running. Refresh the project in a moment to recover the result.");
      }
      resetInterval();
      await refresh();
      return res.json();
    },
    [projectId, refresh, resetInterval],
  );

  const runSimulation = useCallback(
    (params: Record<string, unknown>, parentArtifactId?: string) =>
      runAction("simulation_run", params, parentArtifactId),
    [runAction],
  );

  const analyzeDocument = useCallback(
    (documentId: string, productType?: string) =>
      runAction("document_analysis", {
        document_id: documentId,
        // Pass through whatever the caller specified (or "" if absent);
        // the API resolves dispatch from this + project.domain via
        // resolveDatasheetDispatch (CC-BE-SCHEMA-0010).
        product_type: productType ?? "",
      }),
    [runAction],
  );

  const runEvaluation = useCallback(
    (seed?: number, mockSidecar?: boolean) =>
      // CC-BE-CLEAN-0005: mock_sidecar defaults to false. The API route's
      // resolveMockSidecar() (CC-BE-GOV-0109) is fail-closed against
      // silent mock runs, but the hook previously shipped true by
      // default and bypassed that default, silently opting every
      // UI-triggered battery evaluation into mock/demo validation.
      // Explicit opt-in via the mockSidecar argument from the caller.
      runAction("module_evaluation", { seed: seed ?? 42, mock_sidecar: mockSidecar ?? false }),
    [runAction],
  );

  const runResearch = useCallback(
    (query: string) =>
      runAction("literature_search", { query }),
    [runAction],
  );

  return {
    project, loading, error, refresh, uploadDocument,
    runSimulation, analyzeDocument, runEvaluation, runResearch, runAction,
  };
}
