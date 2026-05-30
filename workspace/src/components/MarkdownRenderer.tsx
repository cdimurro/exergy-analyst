// @ts-nocheck
"use client";

/**
 * MarkdownRenderer — lightweight markdown renderer for the Exergy Lab design system.
 *
 * Parses markdown to React elements without external dependencies.
 * Supports: headers, bold, italic, tables, bullet/numbered lists,
 * code blocks, inline code, links, blockquotes.
 */

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  if (!content) return null;

  const blocks = parseBlocks(normalizeMarkdownForDisplay(content));

  return (
    <div className={`markdown-body ${className}`}>
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  );
}

const SECTION_LABELS = [
  "Analysis Run",
  "Analysis Result",
  "Direct Answer",
  "Executive Summary",
  "Source-Backed SOEC Basis",
  "Extracted Operating Basis",
  "Physics Model Basis",
  "Pilot-Scale Simulation",
  "Low / Base / High Performance Cases",
  "Economics Model",
  "20-Year Sensitivity",
  "Sensitivity Analysis",
  "Main Sensitivity Drivers",
  "Scale Recommendation",
  "Plant Manager Version",
  "Investor / Engineering Version",
  "What The Current Data Supports",
  "What the package appears to cover",
  "Extracted numeric inputs",
  "Model structure to run",
  "Recommendation",
  "Inputs that usually control accuracy",
  "Downloads",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeMarkdownForDisplay(content: string): string {
  let text = String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();

  const newlineCount = (text.match(/\n/g) || []).length;
  const looksCollapsed = newlineCount < 12 && (/\s#{1,6}\s+\S/.test(text) || /\|\s+\|/.test(text));
  if (looksCollapsed) {
    text = text
      .replace(/\s+(#{1,6}\s+)/g, "\n\n$1")
      .replace(/\s+\|\s+\|(?=\s*[^|\n])/g, " |\n|");
  }

  const boldSectionCount = (text.match(/\*\*[^*\n]{4,90}\*\*/g) || []).length;
  if (newlineCount < 6 && boldSectionCount >= 2) {
    text = text.replace(/\s*\*\*([^*\n]{4,90}?):?\*\*\s*/g, (_match, label) => {
      const clean = String(label).replace(/^\d+[.)]\s*/, "").trim();
      if (!clean || /^(yes|no|base|high|low)$/i.test(clean)) return ` **${label}**`;
      return `\n\n## ${clean}\n`;
    });
  }

  for (const label of SECTION_LABELS) {
    const pattern = new RegExp(`(#{1,6}\\s+${escapeRegExp(label)})(\\s+)(?=\\S)`, "gi");
    text = text.replace(pattern, "$1\n");
  }

  return text
    .replace(/^#\s+Analysis\s+(?:Run|Result)\s*\n+/i, "")
    .replace(/^##\s+Direct Answer\b/im, "## Executive Summary")
    .replace(/\nDownloads\s*\n(?=-\s+\[)/i, "\n\n## Downloads\n")
    .replace(/\n{4,}/g, "\n\n")
    .trim();
}

// ── Block types ──────────────────────────────────────────────

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "blockquote"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "hr" }
  | { type: "empty" };

// ── Block parser ─────────────────────────────────────────────

function parseBlocks(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Code block (```)
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: "code", lang, text: codeLines.join("\n") });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("> ")) {
        quoteLines.push(lines[i].trimStart().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join("\n") });
      continue;
    }

    // Table (detect by | in first line and --- in second)
    if (line.includes("|") && i + 1 < lines.length && /^\|?[\s-:|]+\|/.test(lines[i + 1])) {
      const headerCells = line.split("|").map(c => c.trim()).filter(Boolean);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(lines[i].split("|").map(c => c.trim()).filter(Boolean));
        i++;
      }
      blocks.push({ type: "table", headers: headerCells, rows });
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Paragraph (collect consecutive non-special lines)
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].match(/^#{1,4}\s/) && !lines[i].trimStart().startsWith("```") && !lines[i].trimStart().startsWith("> ") && !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim()) && !(lines[i].includes("|") && i + 1 < lines.length && /^\|?[\s-:|]+\|/.test(lines[i + 1] || "")) && !/^\s*[-*+]\s/.test(lines[i]) && !/^\s*\d+[.)]\s/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", text: paraLines.join("\n") });
    }
  }

  return blocks;
}

// ── Inline formatting ────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  // Process inline formatting: **bold**, *italic*, `code`, [link](url), ~~strike~~
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[([^\]]+)\]\(([^)]+)\)|~~[^~]+~~|__[^_]+__|_[^_]+_)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={match.index} className="text-[var(--text-primary)] font-semibold">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("__") && token.endsWith("__")) {
      parts.push(<strong key={match.index} className="text-[var(--text-primary)] font-semibold">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      parts.push(<del key={match.index} className="text-[var(--text-dim)] line-through">{token.slice(2, -2)}</del>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(<code key={match.index} className="px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-[15px] font-mono">{token.slice(1, -1)}</code>);
    } else if (match[2] && match[3]) {
      // Link: [text](url)
      parts.push(<a key={match.index} href={match[3]} target="_blank" rel="noopener noreferrer" className="text-[var(--text-primary)] underline underline-offset-2 decoration-[var(--border)] hover:decoration-[var(--text-muted)] transition-colors">{match[2]}</a>);
    } else if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) {
      parts.push(<em key={match.index} className="italic text-[var(--text-muted)]">{token.slice(1, -1)}</em>);
    } else {
      parts.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

// ── Block renderer ───────────────────────────────────────────

export function isLongMarkdownTableCell(value: string): boolean {
  return String(value || "").replace(/\s+/g, " ").trim().length > 88;
}

function isNumericMarkdownTableCell(value: string): boolean {
  const clean = String(value || "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return false;
  return /^(?:USD\s*)?\$?-?[\d,.]+(?:\.\d+)?(?:\s*(?:M|B|k|%|MW|MWh|kWh|kg|t|yr|\/MWh|\/bbl|\/kg|\/yr|\/t|bbl|BPD))?$/i.test(clean);
}

function renderBlock(block: Block, key: number): React.ReactNode {
  switch (block.type) {
    case "heading": {
      const content = renderInline(block.text);
      // Unified type scale matches the canvas side — document-grade hierarchy,
      // hairline rules instead of heavy borders, consistent tracking.
      switch (block.level) {
        case 1: return <h1 key={key} className="text-[28px] font-semibold mt-6 mb-3 text-[var(--text-primary)] tracking-[-0.015em] leading-tight">{content}</h1>;
        case 2: return <h2 key={key} className="text-[20px] font-semibold mt-6 mb-2.5 text-[var(--text-primary)] tracking-[-0.01em] pt-4 border-t border-[var(--border)]/60">{content}</h2>;
        case 3: return <h3 key={key} className="text-[17px] font-semibold mt-4 mb-2 text-[var(--text-primary)] tracking-[-0.005em]">{content}</h3>;
        default: return <h4 key={key} className="text-[15px] font-semibold mt-3 mb-1.5 text-[var(--text-primary)]">{content}</h4>;
      }
    }

    case "paragraph":
      return <p key={key} className="text-[15px] leading-[1.7] text-[var(--text-secondary)] mb-3">{renderInline(block.text)}</p>;

    case "code":
      return (
        <pre key={key} className="my-3 rounded-md bg-[var(--bg-elevated)] border border-[var(--border)]/60 overflow-x-auto">
          <code className="block px-4 py-3 text-[15px] leading-[1.6] font-mono text-[var(--text-secondary)]">{block.text}</code>
        </pre>
      );

    case "blockquote":
      return (
        <blockquote key={key} className="my-3 pl-4 border-l-2 border-[var(--border)] py-1">
          <p className="text-[15px] leading-[1.7] text-[var(--text-muted)] italic">{renderInline(block.text)}</p>
        </blockquote>
      );

    case "ul":
      return (
        <ul key={key} className="my-3 space-y-1.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3 text-[15px] leading-[1.65] text-[var(--text-secondary)]">
              <span className="shrink-0 text-[var(--text-dim)] mt-[2px]">—</span>
              <span className="flex-1">{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );

    case "ol":
      return (
        <ol key={key} className="my-3 space-y-1.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3 text-[15px] leading-[1.65] text-[var(--text-secondary)]">
              <span className="shrink-0 text-[var(--text-dim)] font-medium tabular-nums mt-[1px] w-6 text-right">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1">{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );

    case "table":
      return (
        <div key={key} className="my-4 overflow-x-auto rounded-lg border border-[var(--border)]/55 bg-[var(--bg-secondary)]/25">
          <table className="w-full min-w-max text-[14px] border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)]/60 bg-[var(--bg-elevated)]/35">
                {block.headers.map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left text-[var(--text-dim)] font-semibold text-[11px] uppercase tracking-[0.08em] max-w-[280px] whitespace-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-[var(--border)]/35 last:border-b-0 odd:bg-[var(--bg-secondary)]/20">
                  {row.map((cell, ci) => {
                    const isLong = isLongMarkdownTableCell(cell);
                    const isNumeric = isNumericMarkdownTableCell(cell);
                    return (
                      <td
                        key={ci}
                        className={[
                          "px-3 py-2.5 align-top text-[var(--text-secondary)]",
                          isNumeric ? "text-right tabular-nums whitespace-nowrap" : "text-left",
                          isLong ? "max-w-[380px] min-w-[260px] whitespace-normal break-words text-[13px] leading-[1.45]" : "leading-[1.55]",
                        ].join(" ")}
                      >
                        {renderInline(cell)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "hr":
      return <hr key={key} className="my-6 border-t border-[var(--border)]/60" />;

    default:
      return null;
  }
}
