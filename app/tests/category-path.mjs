import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile(new URL('../lib/category-path.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { categoryPath } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`
);
const categories = [
  { id: 'clothing', name: 'Clothing', parent_id: null },
  { id: 'shirts', name: 'Shirts', parent_id: 'clothing' },
  { id: 'pants', name: 'Pants', parent_id: 'clothing' },
  { id: 'shirt-formal', name: 'Formal', parent_id: 'shirts' },
  { id: 'pants-formal', name: 'Formal', parent_id: 'pants' },
];
assert.equal(categoryPath('shirt-formal', categories), 'Clothing → Shirts → Formal');
assert.equal(categoryPath('pants-formal', categories), 'Clothing → Pants → Formal');
assert.equal(categoryPath('missing', categories), '');
assert.equal(categoryPath('orphan', [{ id: 'orphan', name: 'Socks', parent_id: 'missing' }]), 'Socks');
assert.equal(categoryPath('loop', [{ id: 'loop', name: 'Loop', parent_id: 'loop' }]), 'Loop');
assert.equal(categoryPath('shirt-formal', [...categories].reverse()), 'Clothing → Shirts → Formal');
console.log(
  'Passed: duplicate leaf names, full ancestry, missing categories, cycles and unordered references.',
);
