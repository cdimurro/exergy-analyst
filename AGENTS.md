# AGENTS.md

This repo is being built around one product goal:

> Exergy Analyst turns messy physical, energy, operational, and techno-economic
> data into clear, exergy-aware decision briefs.

## Product Rules

- Favor real-world workflows over abstract framework language.
- Keep the first product focused on data upload, cleaning, analysis, and brief
  generation.
- The primary starting domains are industrial waste heat and district heating.
- Every high-stakes output must say what the data can support and what it
  cannot prove.
- Do not bring over broad legacy Breakthrough Engine modules unless they serve
  the new product directly.

## Engineering Rules

- Keep the core package small and testable.
- Prefer pure, deterministic functions for ingestion, calculations, scoring,
  and report generation.
- Add tests for every public workflow before expanding the agent surface.
- Use clear names that business users and engineers can understand.
- Avoid hidden confidence upgrades: missing temperature, boundary, or reference
  fields must lower confidence or trigger a next-measurement recommendation.

