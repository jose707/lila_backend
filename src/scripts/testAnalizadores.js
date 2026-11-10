// backend/src/scripts/testAnalizadores.js
/**
 * Ejecuta los fixtures de texto/espaciales contra los parsers y compara
 * con los valores esperados. Uso: npm run test:parsers
 */
const fs = require('fs');
const ruta = require('path');
const { analizarCi: analizarCi, validarCi: validarCi } = require("../services/servicioOcr");

const FIXTURES_DIRECTORIO = ruta.join(__dirname, '../services/__fixtures__');
const GEO_DIRECTORIO = ruta.join(FIXTURES_DIRECTORIO, 'geometry');

const SUITES = [
{
  label: 'Parse CI frontal',
  docType: 'ciFront',
  files: ['ciFrontal.fixtures.js', 'ciFrontalEspacial.fixtures.js']
},
{
  label: 'Parse CI trasera',
  docType: 'ciBack',
  files: ['ciTrasera.fixtures.js', 'ciTraseraEspacial.fixtures.js']
},
{
  label: 'Validate CI',
  files: ['ciValidacion.fixtures.js']
}];


function eq(primero, segundo) {
  return primero === segundo || String(primero) === String(segundo);
}

let totalPasado = 0;
let totalFallido = 0;

for (const suite of SUITES) {
  console.log(`\n── ${suite.label} ──────────────────────────────────────────`);
  let pasado = 0;
  let fallido = 0;

  for (const archivo of suite.files) {
    const fixtures = require(ruta.join(FIXTURES_DIRECTORIO, archivo));
    for (const fx of fixtures) {
      if (suite.label === 'Validate CI') {
        const v = validarCi(fx.input, fx.facesFound || 0, fx.side);
        if (!!v.rejected === !!fx.expected.rejected) {
          pasado++;
          console.log(` ✅ ${fx.name}`);
        } else {
          fallido++;
          console.log(
            ` ❌ ${fx.name}\n    rejected: esperado ${fx.expected.rejected} · obtenido ${v.rejected}`
          );
        }
        continue;
      }

      const opciones = { documentType: suite.docType };
      if (Array.isArray(fx.words) && fx.words.length) opciones.words = fx.words;
      const resultado = analizarCi(fx.input, opciones);
      const esperado = fx.expected || {};
      const errores = [];
      for (const clave of Object.keys(esperado)) {
        const got = clave in resultado ? resultado[clave] : '';
        if (!eq(got, esperado[clave])) {
          errores.push(`${clave}: esperado '${esperado[clave]}' · obtenido '${got}'`);
        }
      }
      if (errores.length) {
        fallido++;
        console.log(` ❌ ${fx.name}\n    ${errores.join('\n    ')}`);
      } else {
        pasado++;
        console.log(` ✅ ${fx.name}`);
      }
    }
  }

  // Fixtures de geometría generados desde fotos reales (opcionales)
  if (suite.docType && fs.existsSync(GEO_DIRECTORIO)) {
    const geoArchivos = fs.
    readdirSync(GEO_DIRECTORIO).
    filter((f) => f.endsWith('.geo.js'));
    for (const g of geoArchivos) {
      let geo;
      try {
        geo = require(ruta.join(GEO_DIRECTORIO, g));
      } catch {
        continue;
      }
      if (geo.documentType !== suite.docType) continue;
      try {
        const resultado = analizarCi(geo.rawText, {
          words: geo.words,
          documentType: suite.docType
        });
        const faltante = (geo.fieldsDetected || []).filter((k) => !resultado[k]);
        if (faltante.length) {
          fallido++;
          console.log(
            ` ❌ [geometría] ${g}\n    campos de la foto real no reextraídos: ${faltante.join(', ')}`
          );
        } else {
          pasado++;
          console.log(` ✅ [geometría] ${g} (foto real anonimizada)`);
        }
      } catch (error) {
        fallido++;
        console.log(` ❌ [geometría] ${g}\n    error: ${error.message}`);
      }
    }
  }

  console.log(`${suite.label}: ${pasado}/${pasado + fallido}`);
  totalPasado += pasado;
  totalFallido += fallido;
}

console.log('\n─────────────────────────────────────────────────────────');
console.log(`Total: ${totalPasado} ✅ · ${totalFallido} ❌`);
process.exit(totalFallido ? 1 : 0);
