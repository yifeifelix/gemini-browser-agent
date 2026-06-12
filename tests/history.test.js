import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateDom, buildApiContents, SNAPSHOT_OMITTED_NOTE } from '../lib/history.js';

test('truncateDom returns short strings unchanged', () => {
  const dom = 'PAGE_TITLE: "x"\nINTERACTIVE_ELEMENTS:\n- Button ID="1"';
  assert.equal(truncateDom(dom), dom);
});

test('truncateDom cuts long DOM under budget, keeps header, appends note', () => {
  const header = 'PAGE_TITLE: "x"\nPAGE_URL: "https://e.com"\n\nINTERACTIVE_ELEMENTS:';
  const lines = Array.from({ length: 500 }, (_, i) => `- Link ID="${i}" Text="item ${i}" href="/a/${i}"`);
  const dom = [header, ...lines].join('\n');
  const result = truncateDom(dom, 2000);
  assert.ok(result.length <= 2000);
  assert.ok(result.startsWith('PAGE_TITLE'));
  assert.ok(result.endsWith('truncated to save tokens)'));
});

test('truncateDom handles non-string input', () => {
  assert.equal(truncateDom(null), '');
  assert.equal(truncateDom(undefined), '');
});

test('buildApiContents keeps full text and image only on the last user item', () => {
  const history = [
    { role: 'user', summary: 'User Goal: "buy milk"', fullText: 'User Goal: "buy milk"\n\nDOM A', image: { mimeType: 'image/jpeg', data: 'AAA' } },
    { role: 'model', text: '{"action":"click"}' },
    { role: 'user', summary: 'Result of last action: Success.', fullText: 'Result of last action: Success.\n\nDOM B', image: { mimeType: 'image/jpeg', data: 'BBB' } }
  ];
  const contents = buildApiContents(history);

  assert.equal(contents.length, 3);
  // Older user message: collapsed to summary + note, no DOM text, no image part
  assert.equal(contents[0].role, 'user');
  assert.equal(contents[0].parts.length, 1);
  assert.ok(contents[0].parts[0].text.includes('User Goal: "buy milk"'));
  assert.ok(contents[0].parts[0].text.includes(SNAPSHOT_OMITTED_NOTE));
  assert.ok(!contents[0].parts[0].text.includes('DOM A'));
  // Model message: passthrough
  assert.deepEqual(contents[1], { role: 'model', parts: [{ text: '{"action":"click"}' }] });
  // Last user message: full DOM + image
  assert.equal(contents[2].parts[0].text, 'Result of last action: Success.\n\nDOM B');
  assert.deepEqual(contents[2].parts[1], { inlineData: { mimeType: 'image/jpeg', data: 'BBB' } });
});

test('buildApiContents omits image part when last user item has no image', () => {
  const history = [{ role: 'user', summary: 's', fullText: 'full', image: null }];
  const contents = buildApiContents(history);
  assert.equal(contents[0].parts.length, 1);
  assert.equal(contents[0].parts[0].text, 'full');
});

test('buildApiContents returns empty array for empty history', () => {
  assert.deepEqual(buildApiContents([]), []);
});
