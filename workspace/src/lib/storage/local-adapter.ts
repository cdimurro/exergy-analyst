/**
 * Local file-based storage adapter for development.
 *
 * Stores projects as JSON files under runtime/projects/.
 * Wraps existing backend.ts functions for jobs/briefs/threads
 * by scoping them with project_id.
 *
 * NOT suitable for Vercel production (read-only filesystem).
 * Production uses vercel-adapter.ts (Batch 2).
 */

import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { RUNTIME_DIR } from "../backend";
import { buildDocumentEvidenceDigest } from "../document-evidence";
import type {
  StorageAdapter,
  Project,
  ProjectSummary,
  Artifact,
  ArtifactSummary,
  Action,
  ProjectDocument,
  AgentRun,
  AgentEvent,
} from "./types";

const PROJECTS_DIR = join(RUNTIME_DIR, "projects");

function projectDir(id: string): string {
  return join(PROJECTS_DIR, `proj_${id}`);
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const data = await readFile(path, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

async function touchProject(projectId: string): Promise<void> {
  const projectPath = join(projectDir(projectId), "project.json");
  const project = await readJson<Project>(projectPath);
  if (project) {
    await writeJson(projectPath, { ...project, updated_at: now() });
  }
}

async function findStoredDocumentPath(dir: string, doc: ProjectDocument): Promise<string | null> {
  try {
    const files = await readdir(dir);
    return files.find((file) => file.startsWith(`${doc.id}_`)) || null;
  } catch {
    return null;
  }
}

// ── Local Storage Adapter ──────────────────────────────────────────

export class LocalStorageAdapter implements StorageAdapter {
  // ── Projects ───────────────────────────────────────────────────

  async createProject(
    input: Omit<Project, "id" | "created_at" | "updated_at">,
  ): Promise<Project> {
    const id = generateId();
    const project: Project = {
      ...input,
      id,
      created_at: now(),
      updated_at: now(),
    };

    const dir = projectDir(id);
    await ensureDir(dir);
    await ensureDir(join(dir, "artifacts"));
    await ensureDir(join(dir, "actions"));
    await ensureDir(join(dir, "documents"));
    await ensureDir(join(dir, "runs"));

    await writeJson(join(dir, "project.json"), project);
    return project;
  }

  async getProject(id: string): Promise<Project | null> {
    return readJson<Project>(join(projectDir(id), "project.json"));
  }

  async listProjects(): Promise<ProjectSummary[]> {
    await ensureDir(PROJECTS_DIR);
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    const summaries: ProjectSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("proj_")) continue;
      const id = entry.name.replace("proj_", "");
      const project = await this.getProject(id);
      if (!project) continue;

      const artifacts = await this.listArtifacts(id);
      const documents = await this.listDocuments(id);

      summaries.push({
        id: project.id,
        name: project.name,
        domain: project.domain,
        artifact_count: artifacts.length,
        document_count: documents.length,
        created_at: project.created_at,
        updated_at: project.updated_at,
      });
    }

    return summaries.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }

  async updateProject(
    id: string,
    patch: Partial<Pick<Project, "name" | "description" | "goal">>,
  ): Promise<void> {
    const project = await this.getProject(id);
    if (!project) throw new Error(`Project ${id} not found`);
    const updated = { ...project, ...patch, updated_at: now() };
    await writeJson(join(projectDir(id), "project.json"), updated);
  }

  // ── Artifacts ──────────────────────────────────────────────────

  async createArtifact(
    projectId: string,
    input: Omit<Artifact, "id" | "created_at">,
  ): Promise<Artifact> {
    const id = `art_${generateId()}`;
    const artifact: Artifact = { ...input, id, created_at: now() };

    const dir = join(projectDir(projectId), "artifacts");
    await ensureDir(dir);
    await writeJson(join(dir, `${id}.json`), artifact);

    await touchProject(projectId);

    return artifact;
  }

  async getArtifact(projectId: string, artifactId: string): Promise<Artifact | null> {
    return readJson<Artifact>(
      join(projectDir(projectId), "artifacts", `${artifactId}.json`),
    );
  }

  async listArtifacts(projectId: string): Promise<ArtifactSummary[]> {
    const dir = join(projectDir(projectId), "artifacts");
    await ensureDir(dir);
    const files = await readdir(dir);
    const summaries: ArtifactSummary[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const artifact = await readJson<Artifact>(join(dir, file));
      if (!artifact) continue;
      summaries.push({
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        summary: artifact.summary,
        source: artifact.source,
        parent_id: artifact.parent_id,
        created_at: artifact.created_at,
        pinned: artifact.pinned,
      });
    }

    return summaries.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }

  // ── Documents ──────────────────────────────────────────────────

  async uploadDocument(
    projectId: string,
    filename: string,
    data: Buffer,
    mimeType: string,
  ): Promise<ProjectDocument> {
    const id = `doc_${generateId()}`;
    const dir = join(projectDir(projectId), "documents");
    await ensureDir(dir);

    // Save file
    await writeFile(join(dir, `${id}_${filename}`), data);

    // Save metadata
    const doc: ProjectDocument = {
      id,
      filename,
      mime_type: mimeType,
      size_bytes: data.length,
      status: "uploaded",
      extraction_result: (() => {
        const digest = buildDocumentEvidenceDigest(filename, data, mimeType);
        return digest ? { document_evidence: digest } : undefined;
      })(),
      uploaded_at: now(),
    };
    await writeJson(join(dir, `${id}.json`), doc);

    return doc;
  }

  async listDocuments(projectId: string): Promise<ProjectDocument[]> {
    const dir = join(projectDir(projectId), "documents");
    await ensureDir(dir);
    const files = await readdir(dir);
    const docs: ProjectDocument[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const doc = await readJson<ProjectDocument>(join(dir, file));
      if (!doc) continue;
      if (!doc.id || !doc.filename || !doc.mime_type || typeof doc.uploaded_at !== "string") continue;
      if (!doc.extraction_result?.document_evidence) {
        const storedName = await findStoredDocumentPath(dir, doc);
        if (storedName) {
          try {
            const data = await readFile(join(dir, storedName));
            const digest = buildDocumentEvidenceDigest(doc.filename, data, doc.mime_type);
            if (digest) {
              doc.extraction_result = {
                ...(doc.extraction_result || {}),
                document_evidence: digest,
              };
              await writeJson(join(dir, file), doc);
            }
          } catch {
            // Best-effort enrichment only; listing documents should not fail
            // because a raw local upload is missing or unreadable.
          }
        }
      }
      docs.push(doc);
    }

    return docs.sort(
      (a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime(),
    );
  }

  // ── Actions ────────────────────────────────────────────────────

  async createAction(
    projectId: string,
    input: Omit<Action, "id" | "created_at">,
  ): Promise<Action> {
    const id = `act_${generateId()}`;
    const action: Action = { ...input, id, created_at: now() };

    const dir = join(projectDir(projectId), "actions");
    await ensureDir(dir);
    await writeJson(join(dir, `${id}.json`), action);

    return action;
  }

  async getAction(projectId: string, actionId: string): Promise<Action | null> {
    return readJson<Action>(
      join(projectDir(projectId), "actions", `${actionId}.json`),
    );
  }

  async listActions(projectId: string): Promise<Action[]> {
    const dir = join(projectDir(projectId), "actions");
    await ensureDir(dir);
    const files = await readdir(dir);
    const actions: Action[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const action = await readJson<Action>(join(dir, file));
      if (action) actions.push(action);
    }

    return actions.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }

  async updateAction(
    projectId: string,
    actionId: string,
    patch: Partial<Pick<Action, "status" | "artifact_id" | "error" | "completed_at">>,
  ): Promise<void> {
    const action = await this.getAction(projectId, actionId);
    if (!action) throw new Error(`Action ${actionId} not found in project ${projectId}`);
    const updated = { ...action, ...patch };
    await writeJson(
      join(projectDir(projectId), "actions", `${actionId}.json`),
      updated,
    );
    await touchProject(projectId);
  }

  // ── Agent Runs ─────────────────────────────────────────────────

  async createAgentRun(
    projectId: string,
    input: Omit<AgentRun, "id" | "project_id" | "status" | "created_at" | "updated_at"> & { status?: AgentRun["status"] },
  ): Promise<AgentRun> {
    const id = `run_${generateId()}`;
    const timestamp = now();
    const run: AgentRun = {
      ...input,
      id,
      project_id: projectId,
      status: input.status || "queued",
      created_at: timestamp,
      updated_at: timestamp,
    };

    const dir = join(projectDir(projectId), "runs");
    await ensureDir(dir);
    await writeJson(join(dir, `${id}.json`), run);
    await writeJson(join(dir, `${id}.events.json`), []);
    await touchProject(projectId);
    return run;
  }

  async getAgentRun(projectId: string, runId: string): Promise<AgentRun | null> {
    return readJson<AgentRun>(join(projectDir(projectId), "runs", `${runId}.json`));
  }

  async listAgentRuns(projectId: string): Promise<AgentRun[]> {
    const dir = join(projectDir(projectId), "runs");
    await ensureDir(dir);
    const files = await readdir(dir);
    const runs: AgentRun[] = [];

    for (const file of files) {
      if (!file.endsWith(".json") || file.endsWith(".events.json")) continue;
      const run = await readJson<AgentRun>(join(dir, file));
      if (run) runs.push(run);
    }

    return runs.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }

  async updateAgentRun(
    projectId: string,
    runId: string,
    patch: Partial<Pick<AgentRun, "status" | "plan" | "final_answer" | "error" | "completed_at" | "action_ids" | "artifact_ids" | "files" | "updated_at">>,
  ): Promise<void> {
    const run = await this.getAgentRun(projectId, runId);
    if (!run) throw new Error(`Run ${runId} not found in project ${projectId}`);
    const updated: AgentRun = { ...run, ...patch, updated_at: patch.updated_at || now() };
    await writeJson(join(projectDir(projectId), "runs", `${runId}.json`), updated);
    await touchProject(projectId);
  }

  async appendAgentEvent(
    projectId: string,
    runId: string,
    input: Omit<AgentEvent, "id" | "project_id" | "run_id" | "sequence" | "created_at">,
  ): Promise<AgentEvent> {
    const dir = join(projectDir(projectId), "runs");
    await ensureDir(dir);
    const path = join(dir, `${runId}.events.json`);
    const existing = await readJson<AgentEvent[]>(path) || [];
    const event: AgentEvent = {
      ...input,
      id: `evt_${generateId()}`,
      project_id: projectId,
      run_id: runId,
      sequence: existing.length + 1,
      created_at: now(),
    };
    await writeJson(path, [...existing, event]);
    await touchProject(projectId);
    return event;
  }

  async listAgentEvents(projectId: string, runId: string): Promise<AgentEvent[]> {
    const path = join(projectDir(projectId), "runs", `${runId}.events.json`);
    const events = await readJson<AgentEvent[]>(path);
    return (events || []).sort((a, b) => a.sequence - b.sequence);
  }
}
