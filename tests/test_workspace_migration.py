from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_workspace_product_shell_exists() -> None:
    workspace = ROOT / "workspace"

    assert (workspace / "package.json").exists()
    assert (workspace / "src/app/page.tsx").exists()
    assert (workspace / "src/components/ProjectCreator.tsx").exists()
    assert (workspace / "src/app/projects/[id]/page.tsx").exists()
    assert (workspace / "src/components/artifacts/InlineResultCard.tsx").exists()


def test_workspace_has_project_upload_and_chat_routes() -> None:
    api_root = ROOT / "workspace/src/app/api"

    assert (api_root / "analyze/route.ts").exists()
    assert (api_root / "projects/route.ts").exists()
    assert (api_root / "projects/[id]/documents/route.ts").exists()
    assert (api_root / "projects/[id]/chat/route.ts").exists()
    assert (api_root / "projects/[id]/actions/route.ts").exists()
    assert (api_root / "projects/[id]/artifacts/[artifactId]/route.ts").exists()
    assert (ROOT / "workspace/src/lib/exergy-agent.ts").exists()


def test_workspace_project_upload_paths_keep_json_source_files() -> None:
    exergy_agent = (ROOT / "workspace/src/lib/exergy-agent.ts").read_text(encoding="utf-8")

    assert 'typeof doc.id !== "string" || typeof doc.filename !== "string"' in exergy_agent
    assert "file.startsWith(`${id}_`)" in exergy_agent
    assert '&& !file.endsWith(".json")' not in exergy_agent


def test_workspace_chat_has_grounded_dialogue_path() -> None:
    grounded = ROOT / "workspace/src/lib/grounded-dialogue.ts"
    chat_route = (ROOT / "workspace/src/app/api/projects/[id]/chat/route.ts").read_text(encoding="utf-8")
    source = grounded.read_text(encoding="utf-8")

    assert grounded.exists()
    assert "buildGroundedWorkspaceResponse" in chat_route
    assert "answerSourceInspection" in source
    assert "answerWhatIf" in source
    assert "grounded_workspace" not in source.lower()


def test_workspace_chat_has_general_knowledge_dialogue_path() -> None:
    general = ROOT / "workspace/src/lib/general-dialogue.ts"
    chat_route = (ROOT / "workspace/src/app/api/projects/[id]/chat/route.ts").read_text(encoding="utf-8")
    source = general.read_text(encoding="utf-8")

    assert general.exists()
    assert "buildGeneralDialogueResponse" in chat_route
    assert "Do not demand uploaded source evidence for general background questions" in source
    assert "heat pumps move heat" in source.lower()


def test_workspace_chat_has_model_led_agent_tools() -> None:
    agent = ROOT / "workspace/src/lib/workspace-agent.ts"
    chat_route = (ROOT / "workspace/src/app/api/projects/[id]/chat/route.ts").read_text(encoding="utf-8")
    source = agent.read_text(encoding="utf-8")

    assert agent.exists()
    assert "buildWorkspaceAgentResponse" in chat_route
    assert "inspectSourceFile" in source
    assert "summarize_artifacts" in source
    assert "DeepSeek" in source


def test_workspace_chat_has_deepseek_model_router_before_fallback_router() -> None:
    model_router = ROOT / "workspace/src/lib/model-router.ts"
    chat_route = (ROOT / "workspace/src/app/api/projects/[id]/chat/route.ts").read_text(encoding="utf-8")
    source = model_router.read_text(encoding="utf-8")

    assert model_router.exists()
    assert "buildModelRoutedResponse" in chat_route
    assert chat_route.index("const modelRoutedResponse") < chat_route.index("const currentMarketPriceResponse")
    assert chat_route.index("const modelRoutedResponse") < chat_route.index("const groundedResponse")
    assert chat_route.index("const modelRoutedResponse") < chat_route.index("if (shouldRunCurrentUploadUniversalAnalysis")
    assert chat_route.index("const modelRoutedResponse") < chat_route.index("const generalDialogueResponse")
    assert "DeepSeek V4 Flash is trusted to decide the best next move" in source
    assert "This is a general-purpose agent" in source
    assert "Current attachments referenced by the user" in source
    assert "deepseek_v4_flash_tool_route" in source
    assert "Allowed actions" in source


def test_workspace_chat_has_deterministic_agent_orchestration() -> None:
    orchestrator = ROOT / "workspace/src/lib/agent-orchestrator.ts"
    chat_route = (ROOT / "workspace/src/app/api/projects/[id]/chat/route.ts").read_text(encoding="utf-8")
    source = orchestrator.read_text(encoding="utf-8")

    assert orchestrator.exists()
    assert "buildAgentOrchestratedResponse" in chat_route
    assert "buildAgentSafetyResponse" in chat_route
    assert "deterministic_physics_simulation_route" in source
    assert "deterministic_economics_analysis_route" in source
    assert "deterministic_deep_research_route" in source
    assert "uploaded_documents_first_grounded_evaluation" in source


def test_workspace_chat_repairs_blank_model_content_without_blocked_refusal() -> None:
    chat_route = (ROOT / "workspace/src/app/api/projects/[id]/chat/route.ts").read_text(encoding="utf-8")

    assert "defaultBlankActionContent" in chat_route
    assert "buildProviderFailureAdvisoryResponse" in chat_route
    assert "I cannot provide a reliable answer from the current response" not in chat_route
    assert "treating this as blocked" not in chat_route


def test_workspace_physics_fallback_uses_migrated_exergy_agent() -> None:
    actions_route = (ROOT / "workspace/src/app/api/projects/[id]/actions/route.ts").read_text(encoding="utf-8")

    assert "handlePhysicsSimulation(projectId, input, action.id, parentArtifactId)" in actions_route
    assert "return handleExergyAgentAnalysis(projectId, input, actionId, parentArtifactId)" in actions_route


def test_workspace_progress_text_cannot_overwrite_final_chat_answer() -> None:
    project_page = (ROOT / "workspace/src/app/projects/[id]/page.tsx").read_text(encoding="utf-8")

    assert "const updIfLoading" in project_page
    assert "m.id === mid && m.loading" in project_page
    assert "progressMessages" in project_page
    assert "window.setInterval" in project_page
    assert "10_000" in project_page
    assert "/ack" not in project_page
    assert "finalPlanFallbackContent" in project_page
    assert "stepSummaries: userVisibleStepSummaries" in project_page
    assert "Analysis complete. I summarized the available results in this conversation." not in project_page


def test_workspace_composer_stays_usable_during_generation() -> None:
    project_page = (ROOT / "workspace/src/app/projects/[id]/page.tsx").read_text(encoding="utf-8")

    assert "return \"expert\"" in project_page
    assert "return cleanThinkingMode(window.localStorage.getItem(THINKING_MODE_STORAGE_KEY))" in project_page
    assert "<LoadingIndicator loadingText={m.loadingText} />" in project_page
    assert "Keep typing while I work..." in project_page
    assert "setBusy(false);\n  }, []);\n\n  const removePendingFile" not in project_page
    assert 'disabled={busy} rows={2}' not in project_page


def test_agent_workspace_failure_report_does_not_leak_docker_commands() -> None:
    runner = (ROOT / "workspace/src/lib/agent-workspace-runner.ts").read_text(encoding="utf-8")
    action_route = (ROOT / "workspace/src/app/api/projects/[id]/actions/route.ts").read_text(encoding="utf-8")
    report_route = (ROOT / "workspace/src/app/api/projects/[id]/report/route.ts").read_text(encoding="utf-8")
    project_page = (ROOT / "workspace/src/app/projects/[id]/page.tsx").read_text(encoding="utf-8")

    assert "buildExecutionFallbackReport" in runner
    assert "ensurePdfTextSidecars(source)" in runner
    assert "callGeminiPdfVision" in runner
    assert "EXERGY_PDF_VISION_PROVIDER" in runner
    assert "extract_pdf_document" in runner
    assert ".gemini.md" in runner
    assert ".mineru.md" in runner
    assert "resolveEvidenceCollectionDocumentPath" in action_route
    assert ".gemini.md" in action_route
    assert "shouldUseWorkspaceForDocumentRequest" in action_route
    assert "workspaceMarkdownReport" in report_route
    assert "renderMarkdownReportPdf" in report_route
    assert "PDF report generated and downloaded." in project_page
    assert "Agent Workspace Run" not in runner
    assert "Execution Notes" not in runner
    assert "docker run" not in runner.lower()


def test_workspace_does_not_commit_local_secrets() -> None:
    tracked_env_files = subprocess.run(
        ["git", "ls-files", "workspace/.env.local", "workspace/.env", "workspace/.env.production"],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()

    assert tracked_env_files == ""
    example = (ROOT / "workspace/.env.local.example").read_text(encoding="utf-8")

    assert "DEEPSEEK_API_KEY=" in example
    assert "sk-" not in example
    assert "deepseek-v4-flash" in example
