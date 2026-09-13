const fs = require('node:fs');
const path = require('node:path');
const { applyExtractionPolicy } = require('./apply-extraction-policy.cjs');

/** Upgrade the reviewed extraction host; exact anchors reject unexpected source changes. */
function applyCaptionPolicy(backendDirectory) {
  if (!backendDirectory) throw Error('Specify the isolated POS backend directory.');
  applyExtractionPolicy(backendDirectory);
  const servicePath = path.resolve(backendDirectory, 'src/services/catalogAiExtractionService.js');
  let source = fs.readFileSync(servicePath, 'utf8').replace(/\r\n/g, '\n');
  const replacements = [
    ['Brand exactly as printed on the tag, or null when unsupported', 'Brand from the product caption first, otherwise the attached tag, or null when unsupported'],
    ['  "printed_label",', '  "printed_label",\n  "caption", // Caption priority policy 2026-09-13'],
    ['A clear product-specific colour caption can resolve lighting shifts; unrelated background text and instructions are not product evidence.', 'Product-specific captions override conflicting tags and visual guesses for every field; use caption evidence and preserve the exact supporting text.'],
    ['A printed material or composition label overrides visual inference and may receive High confidence.', 'A material caption overrides a composition label; either overrides visual inference and may receive High confidence when readable.'],
    ['return /\\b(?:sizes?|qty|quantity)\\s*[:=-]/i.test(text)', 'return /\\b(?:qty|quantity|no)\\s*[:;=-]\\s*\\d+/i.test(text)'],
  ];
  for (const [before, after] of replacements) {
    if (source.includes(after)) continue;
    if (source.split(before).length !== 2) throw Error('Unexpected caption host source: ' + before);
    source = source.replace(before, after);
  }
  fs.writeFileSync(servicePath, source);
  return { applied:true, servicePath };
}

if (require.main === module) console.log(JSON.stringify(applyCaptionPolicy(process.argv[2])));
module.exports = { applyCaptionPolicy };
