/**
 * Storage types for the Innovation Workspace.
 *
 * These types define the workspace data model. The StorageAdapter
 * interface abstracts persistence so dev (local file) and prod
 * (Vercel Postgres + Blob) share the same contract.
 *
 * Key principle: Project is a container that scopes existing
 * jobs/briefs/threads/notebook by project_id. It does not
 * replace the existing persistence spine.
 */

// ── Enums ──────────────────────────────────────────────────────────

export type ActionType =
  | "simulation_run"
  | "physics_simulation"
  | "document_analysis"
  | "module_evaluation"
  | "literature_search"
  | "evidence_evaluation"
  | "evidence_interview"
  | "deep_analysis"
  | "economics_analysis"
  | "scientific_review"
  | "custom_chart"
  | "exploratory_analysis"
  | "environmental_site_analysis"
  | "update_project"
  | "comprehensive_analysis"
  | "agent_workspace"
  | "deep_agent"
  | "generate_pdf"
  | "deep_research"
  | "deep_diligence";

export type ActionStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type ArtifactType =
  | "simulation"
  | "research"
  | "evaluation"
  | "comparison"
  | "document_extraction"
  | "deep_analysis"
  | "scientific_review"
  | "report"
  | "workspace_run"
  | "deep_agent"
  | "deep_research"
  | "diligence_deep";

export type ArtifactSource =
  | "preview_engine"       // Tier 0 client-side TS simulation
  | "canonical_engine"     // Python evaluation engine
  | "physics_engine"       // Python physics solver (any domain)
  | "ai_synthesis"         // LLM-generated (non-deterministic)
  | "user_input";          // Direct user entry

export type DocumentStatus = "uploaded" | "extracting" | "extracted" | "failed";

export type ActionTrigger = "user" | "plan_step" | "branch";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentEventType =
  | "run.started"
  | "progress"
  | "assistant.delta"
  | "assistant.message"
  | "plan.created"
  | "plan.updated"
  | "plan.awaiting_approval"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "file.created"
  | "artifact.created"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";

export type AgentRunMode = "implement" | "plan";
export type AgentThinkingLevel = "instant" | "expert";

export interface AgentPlanStep {
  step: number;
  title: string;
  description: string;
  action_type: ActionType | "synthesis" | "planning_detail";
  config: Record<string, unknown>;
  display_only?: boolean;
  status?: "pending" | "running" | "done" | "failed";
}

export interface AgentRunFile {
  filename: string;
  mime_type: string;
  artifact_id?: string;
  run_id: string;
  url: string;
  path?: string;
  size_bytes?: number;
}

export interface AgentRun {
  id: string;
  project_id: string;
  user_message: string;
  attachment_document_ids: string[];
  mode: AgentRunMode;
  thinking_level: AgentThinkingLevel;
  status: AgentRunStatus;
  plan?: AgentPlanStep[];
  parent_run_id?: string;
  action_ids?: string[];
  artifact_ids?: string[];
  files?: AgentRunFile[];
  final_answer?: string;
  error?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface AgentEvent {
  id: string;
  project_id: string;
  run_id: string;
  sequence: number;
  type: AgentEventType;
  message?: string;
  data?: Record<string, unknown>;
  created_at: string;
}

// ── Project ────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string;
  goal: string;
  domain: string;  // "battery" | "pv" | "inverter" | "general" | any registered domain
  created_at: string;   // ISO 8601
  updated_at: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  domain: string;
  artifact_count: number;
  document_count: number;
  created_at: string;
  updated_at: string;
}

// ── Artifact ───────────────────────────────────────────────────────
// Immutable work product. Never edited — branching creates new artifacts.

export interface ArtifactProvenance {
  source: ArtifactSource;
  deterministic: boolean;
  engine_version?: string;
  model?: string;
  grounding_refs?: string[];
  lane?: "official" | "exploratory";  // Lane 1 (governed) vs Lane 2 (agent-generated)
}

export interface Artifact {
  id: string;
  schema_version: number;        // Starts at 1, incremented on breaking changes
  type: ArtifactType;
  title: string;
  summary: string;
  content: Record<string, unknown>;  // Type-specific payload
  source: ArtifactSource;
  raw: Record<string, unknown>;      // Full engine/AI output preserved for audit
  metadata: Record<string, unknown>; // Extensible without schema changes
  parent_id?: string;                // Branched from this artifact
  action_id: string;                 // Action that produced this
  provenance: ArtifactProvenance;
  created_at: string;
  pinned: boolean;
  // Lineage tracking (optional — populated for research/diligence/deep_analysis)
  source_brief_id?: string;          // Prior brief this was derived from
  derived_from_action?: string;      // Action type that derived this artifact
  lineage_note?: string;             // Human-readable lineage summary
}

export interface ArtifactSummary {
  id: string;
  type: ArtifactType;
  title: string;
  summary: string;
  source: ArtifactSource;
  parent_id?: string;
  created_at: string;
  pinned: boolean;
}

// ── Action ─────────────────────────────────────────────────────────
// Wraps existing Job with workspace metadata.

export interface Action {
  id: string;
  project_id: string;
  type: ActionType;
  status: ActionStatus;
  trigger: ActionTrigger;
  parent_artifact_id?: string;       // If branching from existing artifact
  input: Record<string, unknown>;    // Action-specific config
  artifact_id?: string;              // Result artifact when completed
  job_id?: string;                   // Maps to existing Job.id
  error?: string;
  created_at: string;
  completed_at?: string;
}

// ── Document ───────────────────────────────────────────────────────

export interface ProjectDocument {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: DocumentStatus;
  extraction_result?: Record<string, unknown>;
  uploaded_at: string;
}

// ── Storage Adapter Interface ──────────────────────────────────────

export interface StorageAdapter {
  // Projects
  createProject(project: Omit<Project, "id" | "created_at" | "updated_at">): Promise<Project>;
  getProject(id: string): Promise<Project | null>;
  listProjects(): Promise<ProjectSummary[]>;
  updateProject(id: string, patch: Partial<Pick<Project, "name" | "description" | "goal" | "domain">>): Promise<void>;

  // Artifacts
  createArtifact(projectId: string, artifact: Omit<Artifact, "id" | "created_at">): Promise<Artifact>;
  getArtifact(projectId: string, artifactId: string): Promise<Artifact | null>;
  listArtifacts(projectId: string): Promise<ArtifactSummary[]>;

  // Documents
  uploadDocument(projectId: string, filename: string, data: Buffer, mimeType: string): Promise<ProjectDocument>;
  listDocuments(projectId: string): Promise<ProjectDocument[]>;

  // Actions
  createAction(projectId: string, action: Omit<Action, "id" | "created_at">): Promise<Action>;
  getAction(projectId: string, actionId: string): Promise<Action | null>;
  listActions(projectId: string): Promise<Action[]>;
  updateAction(projectId: string, actionId: string, patch: Partial<Pick<Action, "status" | "artifact_id" | "error" | "completed_at">>): Promise<void>;

  // Agent runs
  createAgentRun(projectId: string, run: Omit<AgentRun, "id" | "project_id" | "status" | "created_at" | "updated_at"> & { status?: AgentRunStatus }): Promise<AgentRun>;
  getAgentRun(projectId: string, runId: string): Promise<AgentRun | null>;
  listAgentRuns(projectId: string): Promise<AgentRun[]>;
  updateAgentRun(projectId: string, runId: string, patch: Partial<Pick<AgentRun, "status" | "plan" | "final_answer" | "error" | "completed_at" | "action_ids" | "artifact_ids" | "files" | "updated_at">>): Promise<void>;
  appendAgentEvent(projectId: string, runId: string, event: Omit<AgentEvent, "id" | "project_id" | "run_id" | "sequence" | "created_at">): Promise<AgentEvent>;
  listAgentEvents(projectId: string, runId: string): Promise<AgentEvent[]>;
}
