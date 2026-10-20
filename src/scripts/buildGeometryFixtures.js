// backend/src/scripts/buildGeometryFixtures.js
/**
 * Procesa las fotos reales de backend/dev-assets/ una sola vez con Cloud
 * Vision y guarda la respuesta completa ANONIMIZADA (texto + geometría)
 * como fixtures de geometría en src/services/__fixtures__/geometry/.
 *
 * Uso:
 *   1. Copia tus fotos a backend/dev-assets/ci-frontal.jpg y ci-trasera.jpg
 *   2. node src/scripts/buildGeometryFixtures.js  (o: npm run fixtures:geo)
 *
 * Las imágenes NO se suben al repo; solo texto+geometría anonimizados.
 * Las etiquetas de los documentos se conservan; los valores (nombres,
 * números, fechas) se reemplazan por datos ficticios del mismo tipo/largo.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const ocrService = require('../services/ocrService');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DEV_ASSETS_DIR = path.join(__dirname, '../../dev-assets');
const OUT_DIR = path.join(__dirname, '../services/__fixtures__/geometry');

const DOCS = [
  { base: 'ci-frontal', documentType: 'ciFront', out: 'ci-frontal.geo.js' },
  { base: 'ci-trasera', documentType: 'ciBack', out: 'ci-trasera.geo.js' },
];

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png'];

function findImage(doc) {
  for (const ext of IMAGE_EXTS) {
    const p = path.join(DEV_ASSETS_DIR, doc.base + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const cleanWord = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const LABEL_WORDS = new Set(
  [
    'CEDULA', 'IDENTIDAD', 'IDENTIFICACION', 'REPUBLICA', 'BOLIVIA',
    'SERVICIO', 'GENERAL', 'PERSONAL', 'APELLIDOS', 'APELLIDO', 'NOMBRES',
    'NOMBRE', 'SEXO', 'FECHA', 'DE', 'NACIMIENTO', 'NACIDO', 'EMISION',
    'EXPIRACION', 'VENCIMIENTO', 'VIGENCIA', 'VENCE', 'VALIDA', 'HASTA',
    'DOMICILIO', 'PROFESION', 'OCUPACION', 'ESTADO', 'CIVIL', 'GRUPO',
    'SANGUINEO', 'LUGAR', 'FIRMA', 'NACIONALIDAD', 'CORREO', 'LIBRO',
    'NO', 'N', 'NRO', 'NUMERO', 'RENOVACION', 'DIRECCION', 'CATEGORIA', 'CLASE',
    'MARCA', 'MODELO', 'COLOR', 'PLACA', 'POLIZA', 'SOAT', 'TIPO',
    'ANTECEDENTES', 'VEHICULO', 'CONDUCIR', 'CONDUCCION', 'LICENCIA',
    'SEGURO', 'OBLIGATORIO', 'ACCIDENTES', 'TRANSITO', 'REGISTRO',
    'AUTOMOTOR', 'COMPANIA', 'ASEGURADORA', 'CERTIFICADO', 'POLICIAL',
    'UNICO', 'NACIONAL', 'RUAT', 'ANO', 'CAPACIDAD', 'PASAJEROS',
  ].map(cleanWord),
);

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

const VOWELS = 'AEIOU';
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';

function randomLetter(forceVowel) {
  return forceVowel
    ? VOWELS[randInt(0, VOWELS.length - 1)]
    : Math.random() < 0.35
    ? VOWELS[randInt(0, VOWELS.length - 1)]
    : CONSONANTS[randInt(0, CONSONANTS.length - 1)];
}

/**
 * Reemplaza una palabra por otra ficticia del mismo tipo y largo:
 * - fechas → fecha válida aleatoria (mismo separador)
 * - números puros → dígitos aleatorios
 * - MRZ de número de documento → conserva el prefijo IDBOL
 * - MRZ de fechas → AAMMDD válido + resto aleatorio
 * - mezclas → dígitos y letras aleatorios, símbolos intactos
 * - texto → letras aleatorias con al menos una vocal
 */
function fakeWord(original) {
  const upper = (original || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  if (!upper) return original;

  if (/^\d+$/.test(upper)) {
    return upper
      .split('')
      .map(() => String(randInt(0, 9)))
      .join('');
  }

  const dateMatch = upper.match(/^(\d{1,2})([\/\-.])(\d{1,2})([\/\-.])((?:19|20)?\d{2})$/);
  if (dateMatch) {
    const day = String(randInt(1, 28)).padStart(dateMatch[1].length, '0');
    const month = String(randInt(1, 12)).padStart(dateMatch[3].length, '0');
    const year =
      dateMatch[5].length === 2
        ? String(randInt(50, 99))
        : (Math.random() < 0.5 ? '19' : '20') + String(randInt(20, 99));
    return `${day}${dateMatch[2]}${month}${dateMatch[4]}${year}`;
  }

  // Línea MRZ de número de documento: conservar "IDBOL"/"IDB0L"
  if (/^IDB[0O]L/.test(upper)) {
    const rest = upper
      .slice(5)
      .split('')
      .map((ch) => {
        if (/[0-9]/.test(ch)) return String(randInt(0, 9));
        if (/[A-Z]/.test(ch)) return randomLetter(false);
        return ch;
      })
      .join('');
    return upper.slice(0, 5) + rest;
  }

  if (/^\d{6}/.test(upper) && /[A-Z<]/.test(upper)) {
    const yy = String(randInt(50, 99));
    const mm = String(randInt(1, 12)).padStart(2, '0');
    const dd = String(randInt(1, 28)).padStart(2, '0');
    const rest = upper
      .slice(6)
      .split('')
      .map((ch) => {
        if (/[0-9]/.test(ch)) return String(randInt(0, 9));
        if (/[A-Z]/.test(ch)) return randomLetter(false);
        return ch;
      })
      .join('');
    return yy + mm + dd + rest;
  }

  if (/\d/.test(upper) && /[A-Z]/.test(upper)) {
    return upper
      .split('')
      .map((ch) => {
        if (/[0-9]/.test(ch)) return String(randInt(0, 9));
        if (/[A-Z]/.test(ch)) return randomLetter(false);
        return ch;
      })
      .join('');
  }

  const hasVowel = /[AEIOU]/.test(upper);
  let fake = upper
    .split('')
    .map((ch, i) => {
      if (!/[A-Z]/.test(ch)) return ch;
      return randomLetter(!hasVowel && i === 0);
    })
    .join('');
  if (fake.length >= 2 && !/[AEIOU]/.test(fake)) {
    const arr = fake.split('');
    arr[arr.length - 1] = VOWELS[randInt(0, VOWELS.length - 1)];
    fake = arr.join('');
  }
  if (LABEL_WORDS.has(cleanWord(fake))) fake += 'ZQ';
  return fake;
}

function anonymizeWords(words) {
  return words.map((w) => {
    const text = (w.text || '').trim();
    if (!text) return w;
    const kept = LABEL_WORDS.has(cleanWord(text));
    return { ...w, text: kept ? text : fakeWord(text) };
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let processed = 0;

  for (const doc of DOCS) {
    const imgPath = findImage(doc);
    if (!imgPath) {
      console.log(
        `⏭️  ${doc.base}.jpg/.jpeg/.png no existe en backend/dev-assets/. Se omite.`,
      );
      continue;
    }
    console.log(`🔍 Procesando ${path.basename(imgPath)} con Cloud Vision…`);
    try {
      const buffer = fs.readFileSync(imgPath);
      const { fields, missing, rejected, rejectReason, words } =
        await ocrService.extractDocument(buffer, doc.documentType);
      if (!words.length) {
        console.log(
          `❌ ${path.basename(imgPath)}: Vision no devolvió geometría de palabras.`,
        );
        continue;
      }

      const anonWords = anonymizeWords(words);
      const rawText = ocrService
        .buildRows(anonWords)
        .map((r) => r.text)
        .join('\n');

      const payload = {
        documentType: doc.documentType,
        generatedAt: new Date().toISOString(),
        sourceFile: path.basename(imgPath),
        fieldsDetected: Object.keys(fields).filter((k) => fields[k]),
        missing,
        rejected,
        rejectReason: rejected ? rejectReason : '',
        words: anonWords,
        rawText,
      };

      const outPath = path.join(OUT_DIR, doc.out);
      fs.writeFileSync(
        outPath,
        `module.exports = ${JSON.stringify(payload, null, 2)};\n`,
      );
      console.log(
        `✅ ${doc.out} — campos: ${payload.fieldsDetected.join(', ') || '(ninguno)'} · palabras: ${words.length}`,
      );
      processed++;
    } catch (e) {
      console.error(`❌ Error procesando ${path.basename(imgPath)}: ${e.message}`);
    }
  }

  console.log(
    processed
      ? 'Listo. Los fixtures de geometría quedaron en src/services/__fixtures__/geometry/.'
      : 'Coloca ci-frontal.jpg y ci-trasera.jpg en backend/dev-assets/ y vuelve a ejecutar.',
  );
}

main();
