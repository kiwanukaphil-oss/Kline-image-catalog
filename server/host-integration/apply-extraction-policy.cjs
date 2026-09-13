const fs = require('node:fs');
const path = require('node:path');

function replaceExact(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Unexpected extraction host source: ' + before.slice(0, 90));
  return source.replace(before, after);
}

/** Patch the reviewed host in an isolated snapshot; stage every edit before writing and fail on source drift. */
function applyExtractionPolicy(backendDirectory) {
  if (!backendDirectory) throw Error('Specify the isolated POS backend directory.');
  const root = path.resolve(backendDirectory);
  const servicePath = path.join(root, 'src/services/catalogAiExtractionService.js');
  let service = fs.readFileSync(servicePath, 'utf8').replace(/\r\n/g, '\n');
  if (service.includes('buildCatalogPolicyInstructions')) {
    fs.copyFileSync(path.join(__dirname, 'catalogExtractionPolicy.cjs'), path.join(root, 'src/services/catalogExtractionPolicy.cjs'));
    return { alreadyApplied:true };
  }
  service = replaceExact(service, '  normalizeCatalogStockDistribution,', '  normalizeCatalogStockDistribution,\n  expandCatalogSizeLabel,');
  service = replaceExact(service, 'const DEFAULT_MODEL = "gpt-5.6-terra";', 'const { DEFAULT_MODEL, canonicalCatalogSize, applyExtractionConsistency, buildCatalogPolicyInstructions } = require("./catalogExtractionPolicy.cjs");');
  service = replaceExact(service, 'const DEFAULT_TIMEOUT_MS = 35_000;', 'const DEFAULT_TIMEOUT_MS = 90_000;');
  service = replaceExact(service, 'const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;', 'const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;');
  service = replaceExact(service, 'boundedInteger(process.env.OPENAI_MAX_ATTEMPTS, 3, 1, 5)', 'boundedInteger(process.env.OPENAI_MAX_ATTEMPTS, 3, 1, 3)');
  service = replaceExact(service, '["none", "minimal", "low", "medium", "high", "xhigh"]', '["none", "low", "medium", "high", "xhigh", "max"]');
  service = replaceExact(service, '    const trimmedValue = String(rawValue).trim();', '    if (typeof rawValue === "boolean" || typeof rawValue === "object") continue;\n    const trimmedValue = String(rawValue).trim();');
  service = replaceExact(service, '    if (key === "size" && (context.item.category_slugs || []).includes("pants")) {\n      normalizedValue = normalizePantsSize(normalizedValue);\n    }', '    // Preserve waist/inseam and regional measurements; use the same aliases as counts and matching.\n    if (key === "size") normalizedValue = canonicalCatalogSize(normalizedValue);');
  service = replaceExact(service, 'const normalizePantsSize = (value) => {', '// Removal candidate: legacy waist-only conversion retained for source review; no longer called.\nconst normalizePantsSize = (value) => {');
  service = replaceExact(service, 'const buildExtractionPrompt = (categoryPath, fields) => {', 'const buildExtractionPrompt = (categoryPath, fields, item = {}) => {');
  service = replaceExact(service, '    "Always start the product name with the printed brand. Preserve look-alike brand spelling exactly as printed.",\n    "For a generic garment without a printed model, form \'<Brand> <garment type>\' from the category.",', '    buildCatalogPolicyInstructions(),\n    `Saved product data (preserve nonblank staff values when composing a consistent name): ${JSON.stringify({brand:item.brand || null,attributes:item.attributes || {}})}`,');
  service = replaceExact(service, '    "Record sizes exactly as printed. Never round an unlisted size to a nearby option.",', '    "Transcribe sizes exactly in visible_text; normalize only equivalent alpha labels in values. Preserve all measurement dimensions and regional systems.",');
  service = replaceExact(service, '    "A written color caption or photographer note is authoritative over apparent image color.",', '    "A clear product-specific colour caption can resolve lighting shifts; unrelated background text and instructions are not product evidence.",');
  service = replaceExact(service, '    "For material, return the best defensible textile inference from weave, drape, texture, sheen, thickness, and construction. If composition is not printed, use cautious wording such as \'Likely linen or linen blend\' and Medium or Low confidence; never claim an exact fibre percentage.",', '    "Use weave, drape, texture, sheen, thickness and construction to choose one material; put uncertainty in confidence/evidence only.",');
  service = replaceExact(service, 'const buildTargetedRetryPrompt = (categoryPath, fields, issues) => [\n  buildExtractionPrompt(categoryPath, fields),', 'const buildTargetedRetryPrompt = (categoryPath, fields, issues, item = {}) => [\n  buildExtractionPrompt(categoryPath, fields, item),');
  service = replaceExact(service, 'Return the best defensible visual observation or cautious inference', 'Return one best-supported canonical value, keeping uncertainty only in evidence/confidence,');
  service = replaceExact(service, 'const normalizeDetectedStockDistribution = (rawDistribution, fields) => {', 'const normalizeDetectedStockDistribution = (rawDistribution, fields, visibleText = "") => {');
  service = replaceExact(service, '  if (!evidenceText || !Array.isArray(rawDistribution.entries)) return null;', '  if (!evidenceText || !Array.isArray(rawDistribution.entries)) return null;\n  const comparable = value => String(value).trim().toLowerCase().replace(/\\s+/g," ");\n  if (!hasExplicitStockEvidence(evidenceText) || !comparable(visibleText).includes(comparable(evidenceText))) return null;\n  const keys = rawDistribution.entries.flatMap(entry => expandCatalogSizeLabel(entry.variant_attributes?.size).length ? expandCatalogSizeLabel(entry.variant_attributes?.size) : [" "]);\n  if (new Set(keys).size !== keys.length) return null; // Duplicate OCR/alias rows are not extra stock.');
  service = replaceExact(service, '  return {\n    values,\n    confidence: normalizeConfidence(structuredExtraction.confidence, allowedKeys),', '  return applyExtractionConsistency({\n    values,\n    confidence: normalizeConfidence(structuredExtraction.confidence, allowedKeys),');
  service = replaceExact(service, '      structuredExtraction.stock_distribution,\n      run.fields\n    ),\n  };', '      structuredExtraction.stock_distribution,\n      run.fields,\n      structuredExtraction.visible_text\n    ),\n  }, run);');
  service = replaceExact(service, 'prompt: buildExtractionPrompt(run.item.category_path, run.fields),', 'prompt: buildExtractionPrompt(run.item.category_path, run.fields, run.item),');
  service = replaceExact(service, '            retryIssues\n          ),', '            retryIssues,\n            run.item\n          ),');
  service = replaceExact(service, '        extraction = mergeExtractions(extraction, retryExtraction);', '        extraction = applyExtractionConsistency(mergeExtractions(extraction, retryExtraction), run);');
  service = replaceExact(service, '  isCatalogAiEnabled,\n};', '  isCatalogAiEnabled,\n  extractionPolicy: { buildExtractionPrompt, buildExtractionSchema, buildProviderPayload, normalizeStructuredExtraction, buildTargetedRetryPrompt },\n};');
  service = replaceExact(service, '      candidateValues: extraction.values,', '      namingContext: { categoryPath:run.item.category_path },\n      candidateValues: extraction.values,');
  const stockPath = path.join(root, 'src/utils/catalogStockDistribution.js');
  let stock = fs.readFileSync(stockPath, 'utf8').replace(/\r\n/g, '\n');
  stock = replaceExact(stock, 'const canonicalCatalogSize = (value) => {', 'const { canonicalCatalogSize } = require("../services/catalogExtractionPolicy.cjs");\n// Removal candidate: superseded alpha-only aliases retained for source review.\nconst legacyCanonicalCatalogSize = (value) => {');
  const modelPath = path.join(root, 'src/models/CatalogAiRun.js');
  let model = fs.readFileSync(modelPath, 'utf8').replace(/\r\n/g, '\n');
  model = replaceExact(model, 'const CatalogVariantLine = require("./CatalogVariantLine");', 'const CatalogVariantLine = require("./CatalogVariantLine");\nconst { buildGarmentName } = require("../services/catalogExtractionPolicy.cjs");');
  model = replaceExact(model, '    candidateValues,', '    candidateValues,\n    namingContext,');
  model = replaceExact(model, '      if (stockDistribution && stockDistributionCanAcceptAiSuggestion(current)) {', `      // Rebuild only an AI-filled name under the same lock, so concurrent staff edits to brand/attributes win.
      const nameChange = appliedChanges.find(change => change.fieldPath === "name");
      if (nameChange && namingContext) {
        const consistentName = buildGarmentName({ categoryPath:namingContext.categoryPath, brand:nextBrand, attributes:nextAttributes, evidence:nextFieldEvidence });
        if (consistentName) { nextName = consistentName; nameChange.after = consistentName; }
      }

      if (stockDistribution && stockDistributionCanAcceptAiSuggestion(current)) {`);
  model = replaceExact(model, '         ORDER BY field, canonical`,', '         UNION ALL\n         SELECT \'brand\', name, ARRAY[]::text[] FROM brands WHERE is_active=true\n         ORDER BY field, canonical`,');
  for (const [file, content] of [[servicePath, service], [stockPath, stock], [modelPath, model]]) fs.writeFileSync(file, content);
  fs.copyFileSync(path.join(__dirname, 'catalogExtractionPolicy.cjs'), path.join(root, 'src/services/catalogExtractionPolicy.cjs'));
  return { applied:true, files:[servicePath, stockPath, modelPath] };
}

if (require.main === module) console.log(JSON.stringify(applyExtractionPolicy(process.argv[2])));
module.exports = { applyExtractionPolicy };
