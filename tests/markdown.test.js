import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../lib/markdown.js';

test('escapes raw HTML so script injection is neutralized', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> & <script>alert(2)</script>');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&amp;'));
});

test('renders bold, italic and inline code', () => {
  const html = renderMarkdown('**bold** and *italic* and `code`');
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('<em>italic</em>'));
  assert.ok(html.includes('<code>code</code>'));
});

test('renders headings', () => {
  const html = renderMarkdown('## Title');
  assert.ok(html.includes('<h2>Title</h2>'));
});

test('renders unordered and ordered lists', () => {
  const html = renderMarkdown('- a\n- b\n\n1. x\n2. y');
  assert.ok(html.includes('<ul><li>a</li><li>b</li></ul>'));
  assert.ok(html.includes('<ol><li>x</li><li>y</li></ol>'));
});

test('renders fenced code blocks without applying inline formatting', () => {
  const html = renderMarkdown('```\nconst a = "**not bold**";\n```');
  assert.ok(html.includes('<pre><code>'));
  assert.ok(html.includes('**not bold**'));
  assert.ok(!html.includes('<strong>'));
});

test('renders only http/https links, rejects javascript: URLs', () => {
  const ok = renderMarkdown('[site](https://example.com)');
  assert.ok(ok.includes('<a href="https://example.com"'));
  assert.ok(ok.includes('target="_blank"'));
  const bad = renderMarkdown('[evil](javascript:alert(1))');
  assert.ok(!bad.includes('<a '));
  assert.ok(bad.includes('evil'));
});

test('renders paragraphs and line breaks', () => {
  const html = renderMarkdown('line one\nline two\n\nnew para');
  assert.ok(html.includes('line one<br>line two'));
  assert.ok(html.includes('<p>new para</p>'));
});

test('returns empty string for non-string input', () => {
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown(undefined), '');
});
