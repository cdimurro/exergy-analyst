# Product Goal

Exergy Analyst is a client-facing AI analyst for messy energy, industrial, and
deep-tech uploads.

The core promise:

> Upload whatever files the client actually has. Receive a clear technical memo
> that identifies useful signals, rejects unsupported claims, and explains the
> next action that would improve the decision.

This is not a metadata inventory product. File inventories, parser selection,
claim ledgers, and run logs exist to support a better client answer. They should
remain visible to developers and available as an appendix, but the primary user
experience is a useful memo.

## Product Interface

The main product interface is an agent:

- framework: Deep Agents on LangGraph
- model target: `deepseek-v4-flash`
- model access: DeepSeek OpenAI-compatible API
- behavior: plan, inspect uploaded files, choose parsers/tools, run calculations,
  write the memo, and preserve an auditable trail of evidence and limitations

The local CLI is the deterministic test harness for that product interface. It
lets us prove analyzers, parsers, and report quality before giving control to the
agent.

## Quality Bar

A successful response must:

- answer the client question directly
- cite computed values from uploaded files
- separate screening-grade findings from investment-grade or engineering-grade
  conclusions
- state what the data cannot prove
- recommend the next measurement, file, or calculation that would most improve
  the decision

An unsuccessful response:

- only lists file metadata
- makes causal claims not supported by uploaded data
- hides parse failures
- gives generic advice that would apply without the upload
- recommends spending engineering effort before checking cheaper missing context
