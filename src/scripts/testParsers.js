// backend/src/scripts/testParsers.js
/**
 * Ejecuta los fixtures de texto/espaciales contra los parsers y compara
 * con los valores esperados. Uso: npm run test:parsers
 */
const fs = require('fs');
const path = require('path');
const { parseCI, validateCI } = require('../services/ocrService');

const FIXTURES_DIR = path.join(__dirname, '../services/__fixtures__');
const GEO_DIR = path.join(FIXTURES_DIR, 'geometry');

const SUITES = [
  {
    label: 'Parse CI frontal',
    docType: 'ciFront',
    files: ['ciFrontal.fixtures.js', 'ciFrontalEspacial.fixtures.js'],
  },
  {
    label: 'Parse CI trasera',
    docType: 'ciBack',
    files: ['ciTrasera.fixtures.js', 'ciTraseraEspacial.fixtures.js'],
  },
  {
    label: 'Validate CI',
    files: ['ciValidacion.fixtures.js'],
  },
];

function eq(a, b) {
  return a === b || String(a) === String(b);
}

let totalPassed = 0;
let totalFailed = 0;

for (const suite of SUITES) {
  console.log(`\n── ${suite.label} ──────────────────────────────────────────`);
  let passed = 0;
  let failed = 0;

  for (const file of suite.files) {
    const fixtures = require(path.join(FIXTURES_DIR, file));
    for (const fx of fixtures) {
      if (suite.label === 'Validate CI') {
        const v = validateCI(fx.input, fx.facesFound || 0, fx.side);
        if (!!v.rejected === !!fx.expected.rejected) {
          passed++;
          console.log(` ✅ ${fx.name}`);
        } else {
          failed++;
          console.log(
            ` ❌ ${fx.name}\n    rejected: esperado ${fx.expected.rejected} · obtenido ${v.rejected}`,
          );
        }
        continue;
      }

      const options = { documentType: suite.docType };
      if (Array.isArray(fx.words) && fx.words.length) options.words = fx.words;
      const result = parseCI(fx.input, options);
      const expected = fx.expected || {};
      const errors = [];
      for (const key of Object.keys(expected)) {
        const got = key in result ? result[key] : '';
        if (!eq(got, expected[key])) {
          errors.push(`${key}: esperado '${expected[key]}' · obtenido '${got}'`);
        }
      }
      if (errors.length) {
        failed++;
        console.log(` ❌ ${fx.name}\n    ${errors.join('\n    ')}`);
      } else {
        passed++;
        console.log(` ✅ ${fx.name}`);
      }
    }
  }

  // Fixtures de geometría generados desde fotos reales (opcionales)
  if (suite.docType && fs.existsSync(GEO_DIR)) {
    const geoFiles = fs
      .readdirSync(GEO_DIR)
      .filter((f) => f.endsWith('.geo.js'));
    for (const g of geoFiles) {
      let geo;
      try {
        geo = require(path.join(GEO_DIR, g));
      } catch {
        continue;
      }
      if (geo.documentType !== suite.docType) continue;
      try {
        const result = parseCI(geo.rawText, {
          words: geo.words,
          documentType: suite.docType,
        });
        const missing = (geo.fieldsDetected || []).filter((k) => !result[k]);
        if (missing.length) {
          failed++;
          console.log(
            ` ❌ [geometría] ${g}\n    campos de la foto real no reextraídos: ${missing.join(', ')}`,
          );
        } else {
          passed++;
          console.log(` ✅ [geometría] ${g} (foto real anonimizada)`);
        }
      } catch (e) {
        failed++;
        console.log(` ❌ [geometría] ${g}\n    error: ${e.message}`);
      }
    }
  }

  console.log(`${suite.label}: ${passed}/${passed + failed}`);
  totalPassed += passed;
  totalFailed += failed;
}

console.log('\n─────────────────────────────────────────────────────────');
console.log(`Total: ${totalPassed} ✅ · ${totalFailed} ❌`);
process.exit(totalFailed ? 1 : 0);
