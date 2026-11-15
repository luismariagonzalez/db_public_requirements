import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdAHtml } from '../scripts/md_a_html.mjs';

test('títulos, listas, negrita, código y enlaces', () => {
  const h = mdAHtml('# T\n\n- **a** y `b`\n- [x](https://e.com/p)\n\n1. uno\n2. dos\n\ntexto *fin*');
  assert.match(h, /<h1>T<\/h1>/);
  assert.match(h, /<ul>\n<li><strong>a<\/strong> y <code>b<\/code><\/li>\n<li><a href="https:\/\/e.com\/p" rel="noopener">x<\/a><\/li>\n<\/ul>/);
  assert.match(h, /<ol>\n<li>uno<\/li>\n<li>dos<\/li>\n<\/ol>/);
  assert.match(h, /<p>texto <em>fin<\/em><\/p>/);
});

test('escapa HTML y no admite enlaces peligrosos', () => {
  const h = mdAHtml('<script>alert(1)</script> [x](javascript:alert(1)) "q"');
  assert.doesNotMatch(h, /<script/);
  assert.doesNotMatch(h, /href="javascript/);
  assert.match(h, /&lt;script&gt;/);
});
