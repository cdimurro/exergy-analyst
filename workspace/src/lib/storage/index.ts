/**
 * Storage adapter factory.
 *
 * Returns the appropriate adapter based on environment:
 * - Local (dev): file-based JSON in runtime/projects/
 * - Vercel (prod): Vercel Postgres + Blob (Batch 2)
 *
 * All business logic imports from this module, never from
 * a specific adapter directly.
 */

import type { StorageAdapter } from "./types";
import { LocalStorageAdapter } from "./local-adapter";

let _instance: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!_instance) {
    // Batch 1: always local. Batch 2 adds Vercel adapter.
    // Future: check process.env.VERCEL === "1" to switch.
    _instance = new LocalStorageAdapter();
  }
  return _instance;
}

// Re-export types for convenience
export type {
  StorageAdapter,
  Project,
  ProjectSummary,
  Artifact,
  ArtifactSummary,
  Action,
  ProjectDocument,
  ArtifactType,
  ArtifactSource,
  ActionType,
  ActionStatus,
  ActionTrigger,
  DocumentStatus,
  ArtifactProvenance,
  AgentRun,
  AgentEvent,
  AgentRunStatus,
  AgentEventType,
  AgentRunMode,
  AgentThinkingLevel,
  AgentPlanStep,
  AgentRunFile,
} from "./types";
