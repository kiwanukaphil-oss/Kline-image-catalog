/* oxlint-disable typescript/no-require-imports -- Standalone CommonJS harness loads the TypeScript compiler to test pure helpers. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('lib/bulk-preparation.ts','utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const sandbox = {exports:{},require:()=>({requestPos:()=>{throw Error('No network in count tests');}})};
vm.runInNewContext(compiled,sandbox);
const { proposedCounts } = sandbox.exports;
const detail = (size,source='intake_default',lines=[{quantity:1,variant_attributes:{}}]) => ({item:{attributes:{size},stock_distribution_source:source,variant_lines:lines}});
for(const size of ['40','W40','W32 L34','XXL','5XL','EU 42']) {
  const actual = proposedCounts(detail(size)); assert.equal(actual[0].size,size); assert.equal(actual[0].quantity,'1');
}
for(const size of ['2XXL','S-L','32, 34']) assert.equal(proposedCounts(detail(size))[0].size,'');
assert.equal(proposedCounts(detail('40','human_confirmed'))[0].size,'');
assert.equal(proposedCounts(detail('40','ai_suggested',[{quantity:3,variant_attributes:{size:'38'}}]))[0].size,'38');
assert.equal(proposedCounts(detail('40','ai_suggested',[{quantity:2,variant_attributes:{}}]))[0].quantity,'2');
assert.equal(proposedCounts(detail('40','ai_suggested',[{quantity:2,variant_attributes:{}},{quantity:1,variant_attributes:{}}]))[0].size,'');
const editor = fs.readFileSync('components/draft-editor.tsx','utf8');
assert(editor.includes('proposedCounts(detail.data)'));
console.log('PASS shared individual/bulk count suggestions: sizes, quantities, confirmed rows and multi-size protection');
