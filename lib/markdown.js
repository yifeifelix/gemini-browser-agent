// Minimal escape-first Markdown renderer for assistant answers.
// Security model: ALL input is HTML-escaped before any markdown
// transform runs, so the only tags in the output are the ones this
// module emits itself. Links are restricted to http/https.
// No chrome.* APIs — unit-testable in Node.

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline transforms applied to already-escaped text.
function renderInline(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// Renders a block of consecutive non-empty lines (no fences inside).
function renderBlock(lines) {
  const first = lines[0];

  const heading = first.match(/^(#{1,4})\s+(.*)$/);
  if (heading && lines.length === 1) {
    const level = heading[1].length;
    return `<h${level}>${renderInline(heading[2])}</h${level}>`;
  }

  if (lines.every((l) => /^[-*]\s+/.test(l))) {
    const items = lines.map((l) => `<li>${renderInline(l.replace(/^[-*]\s+/, ''))}</li>`).join('');
    return `<ul>${items}</ul>`;
  }

  if (lines.every((l) => /^\d+[.)]\s+/.test(l))) {
    const items = lines.map((l) => `<li>${renderInline(l.replace(/^\d+[.)]\s+/, ''))}</li>`).join('');
    return `<ol>${items}</ol>`;
  }

  return `<p>${lines.map(renderInline).join('<br>')}</p>`;
}

export function renderMarkdown(markdown) {
  if (typeof markdown !== 'string') return '';

  const escaped = escapeHtml(markdown.replace(/\r\n/g, '\n'));
  const lines = escaped.split('\n');
  const out = [];
  let block = [];
  let codeBlock = null; // accumulating fenced code lines, or null

  const flushBlock = () => {
    if (block.length) {
      out.push(renderBlock(block));
      block = [];
    }
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (codeBlock === null) {
        flushBlock();
        codeBlock = [];
      } else {
        out.push(`<pre><code>${codeBlock.join('\n')}</code></pre>`);
        codeBlock = null;
      }
      continue;
    }
    if (codeBlock !== null) {
      codeBlock.push(line);
      continue;
    }
    if (line.trim() === '') {
      flushBlock();
      continue;
    }
    // Headings always form their own block
    if (/^#{1,4}\s+/.test(line)) {
      flushBlock();
      out.push(renderBlock([line]));
      continue;
    }
    block.push(line);
  }

  if (codeBlock !== null) {
    out.push(`<pre><code>${codeBlock.join('\n')}</code></pre>`);
  }
  flushBlock();

  return out.join('');
}
