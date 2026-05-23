"""Runtime configuration for the agent product surface."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class AgentSettings:
    """Configuration needed to create the production agent."""

    model: str = "deepseek-v4-flash"
    base_url: str = "https://api.deepseek.com"
    api_key_env: str = "DEEPSEEK_API_KEY"
    temperature: float = 0.0

    @property
    def api_key(self) -> str | None:
        return os.environ.get(self.api_key_env)


def load_agent_settings() -> AgentSettings:
    """Load agent settings from environment variables."""

    return AgentSettings(
        model=os.environ.get("EXERGY_AGENT_MODEL", "deepseek-v4-flash"),
        base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        api_key_env=os.environ.get("EXERGY_AGENT_API_KEY_ENV", "DEEPSEEK_API_KEY"),
        temperature=float(os.environ.get("EXERGY_AGENT_TEMPERATURE", "0")),
    )
