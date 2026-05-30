"""PDF extraction adapters for document-heavy agent workflows."""

from __future__ import annotations

import importlib.util
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_BREAKTHROUGH_ROOT = Path("/home/chris/breakthrough-engine")
DEFAULT_ENV_FILES = (
    Path(__file__).resolve().parents[2] / ".env",
    Path(__file__).resolve().parents[2] / ".env.local",
    Path(__file__).resolve().parents[2] / "workspace" / ".env.local",
    Path("/home/chris/breakthrough-engine/.env"),
    Path("/home/chris/breakthrough-engine/.env.local"),
    Path("/home/chris/breakthrough-engine/workspace/.env.local"),
)


@dataclass(frozen=True)
class PdfExtraction:
    """Text/Markdown extracted from a PDF plus parser provenance."""

    text: str
    parser: str
    status: str
    metadata: dict[str, Any]
    error: str = ""


def mineru_configured() -> bool:
    """Return true when a local MinerU 2.5 extractor is available."""

    return _local_mineru_command_source() is not None


def pdf_parser_status() -> str:
    """Human-readable parser availability line for PDF inventory."""

    gemini_ready = bool(os.getenv("GEMINI_API_KEY") or _env_file_value("GEMINI_API_KEY"))
    source = _local_mineru_command_source()
    if gemini_ready and source:
        return f"Gemini Flash PDF vision sidecars supported; local MinerU2.5 Pro available via {source}"
    if gemini_ready:
        return "Gemini Flash PDF vision sidecars supported; local PDF text fallback will be attempted when no sidecar exists"
    if source:
        return f"local MinerU2.5 Pro PDF extraction available via {source}"
    return (
        "local MinerU2.5 Pro is not installed or configured; "
        "local PDF text fallback will be attempted"
    )


def extract_pdf_document(path: Path) -> PdfExtraction:
    """Extract Markdown/text from a PDF.

    The preferred path is local MinerU 2.5 Pro because it returns
    reading-order Markdown for complex layouts without relying on a hosted
    API. If MinerU is unavailable or fails, use local text extraction as a
    best-effort fallback. MinerU results are cached beside the PDF.
    """

    cached = _read_cached_extraction(path)
    if cached is not None:
        return cached

    local_first = _env_bool("EXERGY_PDF_FAST_TEXT_FIRST", True)
    try:
        local_min_chars = int(_env_file_value("EXERGY_PDF_FAST_TEXT_MIN_CHARS") or "800")
    except ValueError:
        local_min_chars = 800
    local_fallback: PdfExtraction | None = None
    if local_first:
        local_fallback = _extract_with_local_pdf_stack(path)
        if len(local_fallback.text.strip()) >= local_min_chars:
            return PdfExtraction(
                text=local_fallback.text,
                parser=local_fallback.parser,
                status="extracted",
                metadata={**local_fallback.metadata, "fast_text_first": True},
            )

    mineru_error = ""
    if mineru_configured() and not _env_bool("EXERGY_DISABLE_MINERU", False):
        try:
            result = _extract_with_mineru(path)
            _write_cached_extraction(path, result)
            return result
        except Exception as exc:  # pragma: no cover - local model failures are environment-specific.
            mineru_error = str(exc)

    fallback = local_fallback or _extract_with_local_pdf_stack(path)
    if fallback.text:
        metadata = dict(fallback.metadata)
        if mineru_error:
            metadata["mineru_error"] = mineru_error
        return PdfExtraction(
            text=fallback.text,
            parser=fallback.parser,
            status="extracted",
            metadata=metadata,
        )

    if mineru_configured():
        return PdfExtraction(
            text="",
            parser="local MinerU2.5 Pro",
            status="failed",
            metadata={"source": str(path)},
            error=mineru_error or "MinerU extraction did not return usable text.",
        )
    return PdfExtraction(
        text="",
        parser="unconfigured",
        status="unconfigured",
        metadata={"source": str(path)},
        error="Install local MinerU 2.5 Pro or set EXERGY_MINERU_COMMAND to enable complex-PDF extraction.",
    )


def _local_mineru_command_source() -> str | None:
    if _env_file_value("EXERGY_MINERU_COMMAND") or _env_file_value("MINERU_COMMAND"):
        return "configured command"
    if _env_file_value("BT_MINERU_OCR_COMMAND") or _env_file_value("MINERU_OCR_COMMAND"):
        return "Breakthrough command"
    breakthrough_python = _breakthrough_mineru_python()
    if breakthrough_python:
        return str(breakthrough_python)
    if shutil.which("mineru"):
        return shutil.which("mineru")
    if importlib.util.find_spec("mineru"):
        return "python -m mineru.cli.client"
    return None


def _breakthrough_root() -> Path:
    configured = _env_file_value("EXERGY_BREAKTHROUGH_ENGINE_ROOT") or _env_file_value("BREAKTHROUGH_ENGINE_ROOT")
    return Path(configured).expanduser() if configured else DEFAULT_BREAKTHROUGH_ROOT


def _breakthrough_mineru_python() -> Path | None:
    configured = _env_file_value("EXERGY_MINERU_PYTHON")
    if configured:
        candidate = Path(configured).expanduser()
        return candidate if candidate.exists() else None

    root = _breakthrough_root()
    entry = root / "breakthrough_engine" / "rlm" / "_mineru_pro_entry.py"
    if not entry.exists():
        return None
    for relative in (
        Path(".venv/bin/python"),
        Path(".venv-mineru/bin/python"),
        Path(".venv-vllm/bin/python"),
    ):
        candidate = root / relative
        if candidate.exists():
            return candidate
    return None


def _env_file_value(key: str) -> str:
    extra = tuple(Path(item) for item in os.getenv("EXERGY_EXTRA_ENV_FILES", "").split(":") if item.strip())
    for path in (*DEFAULT_ENV_FILES, *extra):
        value = _read_env_file_value(path, key)
        if value:
            return value
    return ""


def _read_env_file_value(path: Path, key: str) -> str:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    for line in lines:
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#") or "=" not in trimmed:
            continue
        raw_key, raw_value = trimmed.split("=", 1)
        env_key = raw_key.removeprefix("export ").strip()
        if env_key != key:
            continue
        value = raw_value.strip()
        if " #" in value:
            value = value.split(" #", 1)[0].strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        return value
    return ""


def _cache_json_path(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".mineru.json")


def _cache_md_path(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".mineru.md")


def _gemini_cache_json_path(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".gemini.json")


def _gemini_cache_md_path(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".gemini.md")


def _read_cached_extraction(path: Path) -> PdfExtraction | None:
    for json_path, default_parser in (
        (_gemini_cache_json_path(path), "Gemini Flash vision"),
        (_cache_json_path(path), "MinerU2.5 Pro"),
    ):
        cached = _read_json_cache(json_path, default_parser)
        if cached is not None:
            return cached

    for md_path, default_parser in (
        (_gemini_cache_md_path(path), "Gemini Flash vision"),
        (_cache_md_path(path), "MinerU2.5 Pro"),
    ):
        cached = _read_markdown_cache(md_path, default_parser)
        if cached is not None:
            return cached
    return None


def _read_json_cache(json_path: Path, default_parser: str) -> PdfExtraction | None:
    if json_path.exists():
        try:
            payload = json.loads(json_path.read_text(encoding="utf-8"))
            text = _first_text(payload.get("markdown"), payload.get("text"))
            if text:
                return PdfExtraction(
                    text=text,
                    parser=str(payload.get("parser") or default_parser),
                    status=str(payload.get("status") or "cached"),
                    metadata=dict(payload.get("metadata") or {}),
                    error=str(payload.get("error") or ""),
                )
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
    return None


def _read_markdown_cache(md_path: Path, default_parser: str) -> PdfExtraction | None:
    if md_path.exists():
        try:
            text = md_path.read_text(encoding="utf-8")
        except OSError:
            text = ""
        if text.strip():
            return PdfExtraction(
                text=text,
                parser=default_parser,
                status="cached",
                metadata={"cache_path": str(md_path)},
            )
    return None


def _write_cached_extraction(path: Path, extraction: PdfExtraction) -> None:
    if not extraction.text:
        return
    payload = {
        "parser": extraction.parser,
        "status": extraction.status,
        "markdown": extraction.text,
        "metadata": extraction.metadata,
        "error": extraction.error,
    }
    try:
        _cache_json_path(path).write_text(json.dumps(payload, indent=2), encoding="utf-8")
        _cache_md_path(path).write_text(extraction.text, encoding="utf-8")
    except OSError:
        return


def _extract_with_mineru(path: Path) -> PdfExtraction:
    with tempfile.TemporaryDirectory(prefix="exergy_mineru_") as tmp:
        output_dir = Path(tmp)
        command, command_source, cwd, env_updates = _local_mineru_command(path, output_dir)
        timeout_seconds = float(
            _env_file_value("EXERGY_MINERU_TIMEOUT_SECONDS")
            or _env_file_value("MINERU_TIMEOUT_SECONDS")
            or _env_file_value("BT_MINERU_TIMEOUT_S")
            or "900"
        )
        env = {**os.environ, **env_updates}
        completed = subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            env=env,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "").strip()
            raise RuntimeError(
                f"local MinerU extraction failed with exit code {completed.returncode}: {detail[-1000:]}"
            )

        markdown_path = _find_mineru_markdown(output_dir, path.stem)
        markdown = ""
        metadata: dict[str, Any] = {
            "source": str(path),
            "command_source": command_source,
            "backend": _mineru_backend(),
            "language": _mineru_language(),
        }
        if markdown_path:
            markdown = markdown_path.read_text(encoding="utf-8", errors="replace")
            metadata["markdown_entry"] = str(markdown_path.relative_to(output_dir))
        elif completed.stdout.strip():
            markdown = completed.stdout
            metadata["markdown_entry"] = "stdout"

        if not markdown.strip():
            raise RuntimeError("local MinerU completed but did not produce usable Markdown/text")

        return PdfExtraction(
            text=markdown,
            parser="local MinerU2.5 Pro",
            status="extracted",
            metadata=metadata,
        )


def _local_mineru_command(path: Path, output_dir: Path) -> tuple[list[str], str, Path | None, dict[str, str]]:
    configured = (
        _env_file_value("EXERGY_MINERU_COMMAND")
        or _env_file_value("MINERU_COMMAND")
        or _env_file_value("BT_MINERU_OCR_COMMAND")
        or _env_file_value("MINERU_OCR_COMMAND")
    )
    if configured:
        return _format_configured_command(configured, path, output_dir), "configured command", None, {}

    breakthrough_python = _breakthrough_mineru_python()
    if breakthrough_python:
        root = _breakthrough_root()
        env_updates = {"PYTHONPATH": f"{root}:{os.environ.get('PYTHONPATH', '')}".rstrip(":")}
        return (
            [
                str(breakthrough_python),
                "-m",
                "breakthrough_engine.rlm._mineru_pro_entry",
                "-p",
                str(path),
                "-o",
                str(output_dir),
                "-b",
                _mineru_backend(),
                "-l",
                _mineru_language(),
                "-t",
                str(_env_bool("MINERU_ENABLE_TABLE", True)),
                "-f",
                str(_env_bool("MINERU_ENABLE_FORMULA", False)),
            ],
            str(breakthrough_python),
            root,
            env_updates,
        )

    mineru_bin = shutil.which("mineru")
    if mineru_bin:
        return (
            _mineru_cli_args(mineru_bin, path, output_dir),
            mineru_bin,
            None,
            {},
        )

    if importlib.util.find_spec("mineru"):
        return (
            [sys.executable, "-m", "mineru.cli.client", *_mineru_cli_args("", path, output_dir)[1:]],
            "python -m mineru.cli.client",
            None,
            {},
        )

    raise RuntimeError("local MinerU 2.5 Pro is not installed or configured")


def _format_configured_command(template: str, path: Path, output_dir: Path) -> list[str]:
    rendered = template.format(
        input=str(path),
        path=str(path),
        output=str(output_dir),
        output_dir=str(output_dir),
        backend=_mineru_backend(),
        lang=_mineru_language(),
        language=_mineru_language(),
        table=str(_env_bool("MINERU_ENABLE_TABLE", True)),
        formula=str(_env_bool("MINERU_ENABLE_FORMULA", False)),
    )
    return shlex.split(rendered)


def _mineru_cli_args(executable: str, path: Path, output_dir: Path) -> list[str]:
    return [
        executable,
        "-p",
        str(path),
        "-o",
        str(output_dir),
        "-b",
        _mineru_backend(),
        "-l",
        _mineru_language(),
        "-t",
        str(_env_bool("MINERU_ENABLE_TABLE", True)),
        "-f",
        str(_env_bool("MINERU_ENABLE_FORMULA", False)),
    ]


def _mineru_backend() -> str:
    return (
        _env_file_value("EXERGY_MINERU_BACKEND")
        or _env_file_value("BT_MINERU_BACKEND")
        or _env_file_value("MINERU_BACKEND")
        or "vlm-auto-engine"
    )


def _mineru_language() -> str:
    return _env_file_value("MINERU_LANGUAGE") or _env_file_value("MINERU_LANG") or "en"


def _find_mineru_markdown(output_dir: Path, stem: str) -> Path | None:
    markdown_files = sorted(output_dir.rglob("*.md"), key=lambda item: (len(item.parts), str(item)))
    if not markdown_files:
        return None
    for candidate in markdown_files:
        if candidate.name == "full.md":
            return candidate
    for candidate in markdown_files:
        if candidate.stem == stem:
            return candidate
    return markdown_files[0]


def _extract_with_local_pdf_stack(path: Path) -> PdfExtraction:
    fitz_text = _extract_with_pymupdf(path)
    if fitz_text.strip():
        return PdfExtraction(
            text=fitz_text,
            parser="local PyMuPDF text extraction",
            status="extracted",
            metadata={"source": str(path)},
        )
    pypdf_text = _extract_with_pypdf2(path)
    if pypdf_text.strip():
        return PdfExtraction(
            text=pypdf_text,
            parser="local PyPDF2 text extraction",
            status="extracted",
            metadata={"source": str(path)},
        )
    return PdfExtraction(text="", parser="local PDF text extraction", status="failed", metadata={"source": str(path)})


def _extract_with_pymupdf(path: Path) -> str:
    try:
        import fitz  # type: ignore[import-not-found]
    except Exception:
        return ""
    try:
        with fitz.open(str(path)) as document:
            return "\n\n".join(page.get_text() or "" for page in document)
    except Exception:
        return ""


def _extract_with_pypdf2(path: Path) -> str:
    try:
        import PyPDF2  # type: ignore[import-not-found]
    except Exception:
        return ""
    try:
        reader = PyPDF2.PdfReader(str(path))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception:
        return ""


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        raw = _env_file_value(name)
    if raw == "":
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


def _first_text(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value
    return ""
