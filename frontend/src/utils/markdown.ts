// =============================================================================
// Shared markdown rendering and report parsing utilities
// =============================================================================

export type MarkdownTheme = 'light' | 'dark';

interface ThemeClasses {
  heading: string;
  text: string;
  textMuted: string;
  bold: string;
  italic: string;
  code: string;
  codeBg: string;
  tableBorder: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  tableRowEven: string;
  tableRowOdd: string;
  tableRowHover: string;
  tableCellText: string;
  blockquoteBorder: string;
  blockquoteText: string;
  hr: string;
  listItem: string;
}

const themes: Record<MarkdownTheme, ThemeClasses> = {
  dark: {
    heading: 'text-gray-100',
    text: 'text-gray-300',
    textMuted: 'text-gray-400',
    bold: 'text-gray-100 font-semibold',
    italic: 'text-gray-300',
    code: 'bg-gray-800 px-1.5 py-0.5 rounded text-sm text-emerald-400 font-mono',
    codeBg: 'bg-gray-800 rounded p-3 my-3 overflow-x-auto text-sm text-gray-300 font-mono border border-gray-700',
    tableBorder: 'border-gray-700',
    tableHeaderBg: 'bg-gray-800',
    tableHeaderText: 'text-gray-200 font-semibold',
    tableRowEven: 'bg-gray-900',
    tableRowOdd: 'bg-gray-900/50',
    tableRowHover: 'hover:bg-gray-800/70',
    tableCellText: 'text-gray-300',
    blockquoteBorder: 'border-gray-600',
    blockquoteText: 'text-gray-400',
    hr: 'border-gray-700',
    listItem: 'text-gray-300',
  },
  light: {
    heading: 'text-gray-900',
    text: 'text-gray-700',
    textMuted: 'text-gray-500',
    bold: 'text-gray-900 font-semibold',
    italic: 'text-gray-700',
    code: 'bg-gray-100 px-1.5 py-0.5 rounded text-sm text-indigo-700 font-mono',
    codeBg: 'bg-gray-50 rounded p-3 my-3 overflow-x-auto text-sm text-gray-800 font-mono border border-gray-200',
    tableBorder: 'border-gray-200',
    tableHeaderBg: 'bg-gray-50',
    tableHeaderText: 'text-gray-700 font-semibold',
    tableRowEven: 'bg-white',
    tableRowOdd: 'bg-gray-50/50',
    tableRowHover: 'hover:bg-gray-100/70',
    tableCellText: 'text-gray-700',
    blockquoteBorder: 'border-gray-300',
    blockquoteText: 'text-gray-500',
    hr: 'border-gray-200',
    listItem: 'text-gray-700',
  },
};

/**
 * Render a markdown string to HTML with Tailwind classes.
 * Supports headers, bold, italic, tables, code blocks, lists, blockquotes, and horizontal rules.
 */
export function renderMarkdown(text: string, theme: MarkdownTheme = 'dark'): string {
  if (!text) return '';

  const t = themes[theme];

  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks - extract before other transforms
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="${t.codeBg}">${code.replace(/\n$/, '')}</pre>`);
    return `\x00CB${idx}\x00`;
  });
  html = html.replace(/```([\s\S]*?)```/g, (_match, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="${t.codeBg}">${code.replace(/^\n/, '').replace(/\n$/, '')}</pre>`);
    return `\x00CB${idx}\x00`;
  });

  // Tables
  html = html.replace(
    /((?:^|\n)\|[^\n]+\|\n\|[\s:|-]+\|\n(?:\|[^\n]+\|\n?)*)/g,
    (tableBlock) => {
      const lines = tableBlock.trim().split('\n').filter(l => l.trim());
      if (lines.length < 2) return tableBlock;
      const parseRow = (line: string): string[] =>
        line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const headers = parseRow(lines[0]);
      const dataRows = lines.slice(2).map(parseRow);
      let table = `<div class="overflow-x-auto my-3"><table class="w-full text-sm border-collapse border ${t.tableBorder} rounded">`;
      table += `<thead><tr class="${t.tableHeaderBg}">`;
      for (const h of headers) {
        table += `<th class="px-3 py-2 text-left ${t.tableHeaderText} border ${t.tableBorder}">${h}</th>`;
      }
      table += '</tr></thead><tbody>';
      dataRows.forEach((row, rowIdx) => {
        const bgClass = rowIdx % 2 === 0 ? t.tableRowEven : t.tableRowOdd;
        table += `<tr class="${bgClass} ${t.tableRowHover} transition-colors">`;
        for (let i = 0; i < headers.length; i++) {
          table += `<td class="px-3 py-2 ${t.tableCellText} border ${t.tableBorder}">${row[i] ?? ''}</td>`;
        }
        table += '</tr>';
      });
      table += '</tbody></table></div>';
      return table;
    }
  );

  // Blockquotes
  html = html.replace(
    /((?:^|\n)&gt; [^\n]+(?:\n&gt; [^\n]+)*)/g,
    (block) => {
      const inner = block.replace(/(?:^|\n)&gt; /g, '\n').trim();
      return `<blockquote class="border-l-4 ${t.blockquoteBorder} pl-4 my-3 ${t.blockquoteText} italic">${inner}</blockquote>`;
    }
  );

  // Headers
  html = html.replace(/^#### (.+)$/gm, `<h4 class="text-base font-semibold ${t.heading} mt-3 mb-1.5">$1</h4>`);
  html = html.replace(/^### (.+)$/gm, `<h3 class="text-lg font-semibold ${t.heading} mt-4 mb-2">$1</h3>`);
  html = html.replace(/^## (.+)$/gm, `<h2 class="text-xl font-bold ${t.heading} mt-5 mb-2">$1</h2>`);
  html = html.replace(/^# (.+)$/gm, `<h1 class="text-2xl font-bold ${t.heading} mt-6 mb-3">$1</h1>`);

  // Horizontal rules
  html = html.replace(/^(\*{3,}|-{3,}|_{3,})$/gm, `<hr class="${t.hr} my-4" />`);

  // Bold+Italic combined
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, `<strong class="${t.bold}"><em>$1</em></strong>`);
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, `<strong class="${t.bold}">$1</strong>`);
  // Italic
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, `<em class="${t.italic}">$1</em>`);

  // Inline code
  html = html.replace(/`([^`]+)`/g, `<code class="${t.code}">$1</code>`);

  // Numbered lists
  html = html.replace(
    /((?:^\d+\. .+$\n?)+)/gm,
    (block) => {
      const items = block.trim().split('\n').map(line => {
        const m = line.match(/^\d+\.\s+(.+)$/);
        return m ? `<li class="ml-4 list-decimal ${t.listItem}">${m[1]}</li>` : '';
      }).join('\n');
      return `<ol class="my-2 space-y-1 pl-2">${items}</ol>`;
    }
  );

  // Unordered lists (use [-] only to avoid matching **bold** mid-line)
  html = html.replace(
    /((?:^[ \t]*[-] .+$\n?)+)/gm,
    (block) => {
      const items = block.trim().split('\n').map(line => {
        const m = line.match(/^([ \t]*)[-]\s+(.+)$/);
        if (!m) return '';
        const indent = m[1].length;
        const mlClass = indent >= 4 ? 'ml-8' : indent >= 2 ? 'ml-6' : 'ml-4';
        return `<li class="${mlClass} list-disc ${t.listItem}">${m[2]}</li>`;
      }).join('\n');
      return `<ul class="my-2 space-y-1">${items}</ul>`;
    }
  );

  // Paragraphs
  const sections = html.split(/\n\n+/);
  html = sections
    .map(section => {
      const trimmed = section.trim();
      if (!trimmed) return '';
      if (/^(<h[1-4]|<ul|<ol|<pre|<table|<div|<blockquote|<hr|\x00CB)/.test(trimmed)) {
        return trimmed;
      }
      return `<p class="${t.text} my-2">${trimmed.replace(/\n/g, '<br />')}</p>`;
    })
    .join('\n');

  // Restore code blocks
  html = html.replace(/\x00CB(\d+)\x00/g, (_m, idx) => codeBlocks[parseInt(idx, 10)] ?? '');

  // Clean up empty paragraphs
  html = html.replace(/<p[^>]*>\s*<\/p>/g, '');

  // Sanitize: strip dangerous tags and attributes to prevent XSS
  html = sanitizeHtml(html);

  return html;
}

/**
 * Lightweight HTML sanitizer that strips dangerous tags and attributes.
 * Not a full sanitizer — intended as a defense-in-depth layer after
 * markdown rendering (which already escapes raw HTML entities).
 */
function sanitizeHtml(html: string): string {
  // Remove dangerous tags and their content
  html = html.replace(/<\s*\/?\s*(script|iframe|object|embed|form|input|textarea|select|button|link|meta|style|base)(\s[^>]*)?\s*\/?>/gi, '');
  // Remove content between script/style/iframe tags
  html = html.replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  // Remove event handler attributes (on*)
  html = html.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Remove javascript: and data: in href/src attributes
  html = html.replace(/(href|src|action)\s*=\s*(?:"[^"]*(?:javascript|data)\s*:[^"]*"|'[^']*(?:javascript|data)\s*:[^']*')/gi, '');
  return html;
}

/**
 * Parse a report field that may be stored in multiple formats:
 * - Raw markdown string: "## Market Report\n..."
 * - JSON string wrapping any of the below
 * - Object with `text` key: { text: "## Market Report\n..." }
 * - Investment debate: { bull_case, bear_case, judge_decision, ... }
 * - Risk debate: { aggressive_view, conservative_view, neutral_view, judge_decision, ... }
 * - Alternate naming: { bull_report, bear_report, judge_decision, ... }
 * - Alternate naming: { aggressive_report, conservative_report, neutral_report, judge_decision, ... }
 *
 * Returns a renderable markdown string.
 */
export function parseReport(value: unknown): string {
  if (!value) return '';

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) {
        return parseReport(parsed);
      }
      return String(parsed);
    } catch {
      return value;
    }
  }

  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;

    // Common wrapper: { text: "..." }
    if (typeof obj.text === 'string') return obj.text;

    // Investment debate structure
    if (obj.bull_case || obj.bear_case || obj.judge_decision) {
      const parts: string[] = [];
      if (obj.bull_case) parts.push(`## Bull Case\n\n${obj.bull_case}`);
      if (obj.bear_case) parts.push(`## Bear Case\n\n${obj.bear_case}`);
      if (obj.debate_history) parts.push(`## Debate History\n\n${obj.debate_history}`);
      if (obj.judge_decision) parts.push(`## Judge Decision\n\n${obj.judge_decision}`);
      return parts.join('\n\n---\n\n');
    }

    // Risk debate structure
    if (obj.aggressive_view || obj.conservative_view || obj.neutral_view) {
      const parts: string[] = [];
      if (obj.aggressive_view) parts.push(`## Aggressive View\n\n${obj.aggressive_view}`);
      if (obj.conservative_view) parts.push(`## Conservative View\n\n${obj.conservative_view}`);
      if (obj.neutral_view) parts.push(`## Neutral View\n\n${obj.neutral_view}`);
      if (obj.debate_history) parts.push(`## Debate History\n\n${obj.debate_history}`);
      if (obj.judge_decision) parts.push(`## Judge Decision\n\n${obj.judge_decision}`);
      return parts.join('\n\n---\n\n');
    }

    // Alternate pipeline naming: bull_report / bear_report
    if (obj.bull_report || obj.bear_report) {
      const parts: string[] = [];
      if (obj.bull_report) parts.push(`## Bull Report\n\n${obj.bull_report}`);
      if (obj.bear_report) parts.push(`## Bear Report\n\n${obj.bear_report}`);
      if (obj.judge_decision) parts.push(`## Judge Decision\n\n${obj.judge_decision}`);
      return parts.join('\n\n---\n\n');
    }

    // Alternate pipeline naming: aggressive_report / conservative_report / neutral_report
    if (obj.aggressive_report || obj.conservative_report || obj.neutral_report) {
      const parts: string[] = [];
      if (obj.aggressive_report) parts.push(`## Aggressive Report\n\n${obj.aggressive_report}`);
      if (obj.conservative_report) parts.push(`## Conservative Report\n\n${obj.conservative_report}`);
      if (obj.neutral_report) parts.push(`## Neutral Report\n\n${obj.neutral_report}`);
      if (obj.judge_decision) parts.push(`## Judge Decision\n\n${obj.judge_decision}`);
      return parts.join('\n\n---\n\n');
    }

    // Fallback: stringify
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}
