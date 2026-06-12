import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateDom } from '../lib/history.js';

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
