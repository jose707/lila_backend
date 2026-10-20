// backend/src/services/ocrService.js
/**
 * Extracción de datos desde imágenes de documentos bolivianos
 * usando Google Cloud Vision API.
 *
 * - Reutiliza la cuenta de servicio de Firebase/FCM si no hay
 *   GOOGLE_APPLICATION_CREDENTIALS explícita.
 * - Incluye parsers heurísticos para: CI, licencia de conducir,
 *   SOAT y RUAT.
 * - Incluye un parser ESPACIAL (etiqueta → valor a la derecha o
 *   debajo) cuando hay geometría de palabras; si no, se usa el
 *   parser por líneas.
 */
const fs = require('fs');
const path = require('path');
const vision = require('@google-cloud/vision');

// ─── Credenciales / cliente ─────────────────────────────────────────────────
function resolveCredentialsPath(rawPath) {
  if (!rawPath) return null;
  if (path.isAbsolute(rawPath)) return rawPath;

  const fromCwd = path.resolve(process.cwd(), rawPath);
  if (fs.existsSync(fromCwd)) return fromCwd;

  const fromBackendRoot = path.resolve(__dirname, '../../', rawPath);
  if (fs.existsSync(fromBackendRoot)) return fromBackendRoot;

  return fromCwd;
}

let visionClient = null;

function getVisionClient() {
  if (visionClient) return visionClient;

  const opts = {};

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const resolved = resolveCredentialsPath(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `Archivo de credenciales no encontrado: ${resolved}. Verifica GOOGLE_APPLICATION_CREDENTIALS en backend/.env`,
      );
    }
    opts.keyFilename = resolved;
  } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    opts.credentials = {
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  } else {
    throw new Error(
      'Credenciales de Google no configuradas. Agrega GOOGLE_APPLICATION_CREDENTIALS (ruta a serviceAccountKey.json) ' +
        'o FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY en backend/.env',
    );
  }

  visionClient = new vision.ImageAnnotatorClient(opts);
  return visionClient;
}

/**
 * Extrae las palabras con su geometría (bbox normalizado 0-1) desde la
 * respuesta de Vision: pages[0].blocks[].paragraphs[].words[].boundingBox.
 */
function extractWordsFromAnnotation(result) {
  const annotation = result && result.fullTextAnnotation;
  const pages = Array.isArray(annotation && annotation.pages)
    ? annotation.pages
    : [];
  const words = [];
  for (const page of pages) {
    for (const block of Array.isArray(page.blocks) ? page.blocks : []) {
      for (const paragraph of Array.isArray(block.paragraphs) ? block.paragraphs : []) {
        for (const word of Array.isArray(paragraph.words) ? paragraph.words : []) {
          const text = (
            word.text ||
            (word.symbols || []).map((s) => s.text || '').join('')
          ).trim();
          const box = word.boundingBox;
          const vertices =
            box && Array.isArray(box.vertices) ? box.vertices : [];
          if (!text || vertices.length < 4) continue;
          const xs = vertices.map((v) => v.x || 0);
          const ys = vertices.map((v) => v.y || 0);
          words.push({
            text,
            x: Math.min(...xs),
            y: Math.min(...ys),
            w: Math.max(...xs) - Math.min(...xs),
            h: Math.max(...ys) - Math.min(...ys),
            confidence:
              typeof word.confidence === 'number' ? word.confidence : null,
          });
        }
      }
    }
  }
  return words;
}

/**
 * Analiza una imagen (buffer) con una sola llamada a Vision:
 * extrae texto (TEXT_DETECTION) y detecta rostros (FACE_DETECTION).
 * @returns {{ text: string, facesFound: number, words: Array }}
 */
async function annotateImageBuffer(buffer) {
  const client = getVisionClient();
  const [result] = await client.annotateImage({
    image: { content: buffer },
    features: [{ type: 'TEXT_DETECTION' }, { type: 'FACE_DETECTION' }],
    imageContext: { languageHints: ['es'] },
  });
  const annotation = result && result.fullTextAnnotation;
  const text = annotation && annotation.text ? annotation.text : '';
  const facesFound = Array.isArray(result && result.faceAnnotations)
    ? result.faceAnnotations.length
    : 0;
  const words = extractWordsFromAnnotation(result);
  return { text, facesFound, words };
}

/**
 * Extrae el texto completo de una imagen (buffer).
 */
async function extractTextFromBuffer(buffer) {
  const { text } = await annotateImageBuffer(buffer);
  return text;
}

// ─── Utilidades de normalización ─────────────────────────────────────────────
const stripAccents = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const normalize = (s) =>
  stripAccents(s || '')
    .replace(/[|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeLines = (text) =>
  String(text || '')
    .split(/\r?\n/)
    .map(normalize)
    .filter(Boolean);

/** Encuentra todas las fechas DD/MM/YYYY (o variantes) con su posición. */
function findDatesWithPositions(text) {
  const found = [];
  const re = /\b(\d{1,2})[\/\-. ](\d{1,2})[\/\-.]((?:19|20)?\d{2})\b/g;
  let m;
  while ((m = re.exec(text || ''))) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    if (require('./identityValidation').isoDate(`${dd}/${mm}/${yyyy}`)) {
      found.push({ value: `${dd}/${mm}/${yyyy}`, pos: m.index });
    }
  }
  const months = {
    ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
    JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10,
    NOVIEMBRE: 11, DICIEMBRE: 12,
  };
  const written = /\b(\d{1,2})[\s.,:;]+(?:DE\s+)?(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)[\s.,:;]+(?:(?:DE|DEL)\s+)?((?:19|20)\d{2})\b/g;
  const normalized = stripAccents(text || '');
  while ((m = written.exec(normalized))) {
    const value = `${m[1].padStart(2, '0')}/${String(months[m[2]]).padStart(2, '0')}/${m[3]}`;
    if (require('./identityValidation').isoDate(value)) found.push({ value, pos: m.index });
  }
  return found.sort((a, b) => a.pos - b.pos);
}

/** Encuentra todas las fechas DD/MM/YYYY (o variantes) en un texto. */
function findDates(text) {
  return findDatesWithPositions(text).map((d) => d.value);
}

// Línea siguiente que NO puede ser el valor de una etiqueta de fecha
const NEXT_LINE_LABEL_RE = /^(FECHA|EMISION|EXPIRACION|VENCIMIENTO|VIGENCIA|VENCE|VALIDA|HASTA|NACIMIENTO|NACIDO|DIRECCION|CATEGORIA|RENOVACION|POLIZA)/;

/**
 * Busca una fecha cercana a una palabra clave:
 * - Misma línea: la primera fecha DESPUÉS de la etiqueta.
 * - Línea siguiente: solo si es "fecha pura" (no otra etiqueta antes).
 */
function dateNearKeyword(text, keywords) {
  const lines = normalizeLines(text);
  const kws = keywords.map(stripAccents);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const kw of kws) {
      const idx = line.indexOf(kw);
      if (idx === -1) continue;
      const same = findDatesWithPositions(line).filter(
        (d) => d.pos >= idx,
      );
      if (same.length) return same[0].value;
      if (i + 1 < lines.length) {
        const next = lines[i + 1];
        const nextDates = findDatesWithPositions(next);
        if (nextDates.length === 1) {
          const before = next
            .slice(0, nextDates[0].pos)
            .replace(/[^A-Z]/g, '');
          if (before.length <= 4 && !NEXT_LINE_LABEL_RE.test(before)) {
            return nextDates[0].value;
          }
        }
      }
    }
  }
  return '';
}

/**
 * Valor que sigue a una palabra clave (misma línea o la siguiente).
 */
function valueAfterKeyword(text, keywords) {
  const lines = normalizeLines(text);
  const kws = keywords.map(stripAccents);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const kw of kws) {
      const idx = line.indexOf(kw);
      if (idx !== -1) {
        let val = line.slice(idx + kw.length);
        val = val.replace(/^[\s:.\-–|»]+/, '').trim();
        if (val.length >= 2) return val;
        if (i + 1 < lines.length && lines[i + 1].length >= 2) {
          return lines[i + 1];
        }
        return val;
      }
    }
  }
  return '';
}

// Palabras que nunca pueden ser un valor de nombre (etiquetas/ruido)
const LABEL_WORD_RE = /^(APELLIDOS|APELLIDO|NOMBRES|NOMBRE|SEXO|FECHA|NACIMIENTO|NACIDO|EMISION|EXPIRACION|VENCIMIENTO|VIGENCIA|VENCE|VALIDA|HASTA|DOMICILIO|PROFESION|OCUPACION|ESTADO|CIVIL|GRUPO|SANGUINEO|LUGAR|FIRMA|NACIONALIDAD|CORREO|LIBRO|NO|NRO|NUMERO|RENOVACION|DIRECCION|CATEGORIA|CLASE|MARCA|MODELO|COLOR|PLACA|POLIZA|SOAT|TIPO|CEDULA|IDENTIDAD|REPUBLICA|BOLIVIA|IDENTIFICACION|SERVICIO|GENERAL|PERSONAL|ANTECEDENTES|VEHICULO|CONDUCIR|LICENCIA|CONDUCCION|SEGURO|OBLIGATORIO|ACCIDENTES|TRANSITO|REGISTRO|AUTOMOTOR)$/;

/**
 * Valor de una etiqueta de campo (ej: "NOMBRES: JUAN CARLOS").
 * Solo texto alfabético plausible (1-4 palabras con vocales) y
 * nunca una etiqueta o una fecha.
 */
function labeledValue(text, keywords) {
  const raw = valueAfterKeyword(text, keywords);
  const cleaned = raw
    .replace(/[^A-Za-z\u00C0-\u017F ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned
    .split(' ')
    .filter((w) => w.length >= 2 && /[AEIOU]/.test(w));
  if (!words.length || words.length > 4) return '';
  if (words.some((w) => LABEL_WORD_RE.test(w))) return '';
  return words.join(' ');
}

// ─── MRZ (CI boliviana) ──────────────────────────────────────────────────────
function parseMRZ(text) {
  const lines = normalizeLines(text).map(line => line.replace(/\s/g, ''));
  const idx = lines.findIndex(
    (l) => /^I(?:D|<)B[0O]L/.test(l) || l.includes('IDBOL') || l.includes('I<BOL'),
  );
  if (idx === -1) return null;

  const first = lines[idx];
  const spacedFirst = normalizeLines(text)[idx];
  const separatedNumber = /^(?:IDBOL|I<BOL)\s+(\d{6,9})\s+[0-9<](?:\s|$)/.exec(spacedFirst);
  const numMatch = separatedNumber ? [separatedNumber[1]] : (first.length === 30
    ? first.slice(5, 14).match(/^\d{6,9}(?=<|$)/)
    : first.match(/\d{6,9}/));
  const ciNumber = numMatch ? numMatch[0] : '';

  // Fecha de nacimiento: segunda línea MRZ, posiciones 0-6 (AAMMDD)
  let birthDate = '';
  const second = idx + 1 < lines.length ? lines[idx + 1] : '';
  if (second) {
    const yymmdd = second.match(/^(\d{6})/);
    if (yymmdd) {
      const [, raw] = yymmdd;
      const yy = parseInt(raw.slice(0, 2), 10);
      const year = yy <= new Date().getUTCFullYear() % 100 ? `20${raw.slice(0, 2)}` : `19${raw.slice(0, 2)}`;
      birthDate = `${raw.slice(4, 6)}/${raw.slice(2, 4)}/${year}`;
    }
  }

  // Nombre: tercera línea MRZ "APELLIDOS<<NOMBRES"
  let fullName = '';
  const nameLine = idx + 2 < lines.length ? lines[idx + 2] : '';
  if (nameLine) {
    const namePart = nameLine.replace(/^<+/, '').replace(/<+$/, '');
    const parts = namePart.split('<<');
    const surname = (parts[0] || '')
      .replace(/</g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const given = (parts[1] || '')
      .replace(/</g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    fullName = [surname, given].filter(Boolean).join(' ').trim();
  }

  return { ciNumber, fullName, birthDate, mrz: true };
}

// ─── Fallback de nombre por líneas ───────────────────────────────────────────
const FALLBACK_NAME_PREFIX = /^(REPUBLICA|ESTADO|BOLIVIA|CEDULA|IDENTIDAD|IDENTIFICACION|SERVICIO|GENERAL|PERSONAL|SEXO|FECHA|LUGAR|NACIMIENTO|NACIDO|DOMICILIO|PROFESION|OCUPACION|CIVIL|NOMBRES|NOMBRE|APELLIDOS|APELLIDO|FIRMA|NACIONALIDAD|CORREO|LIBRO|NO|NRO|NUMERO|N|EMISION|EXPIRACION|VENCIMIENTO|GRUPO|SANGUINEO|RENOVACION|DIRECCION|CATEGORIA|CLASE|MARCA|MODELO|COLOR|PLACA|POLIZA|SOAT|TIPO|VIGENCIA|VENCE|HASTA|VALIDA|ANTECEDENTES|VEHICULO|CONDUCIR|LICENCIA|CONDUCCION|SEGURO|OBLIGATORIO|ACCIDENTES|TRANSITO|REGISTRO|AUTOMOTOR)\b/;

/**
 * Línea alfabética con 2-5 palabras plausibles (todas con vocal).
 * Nunca se usa para la trasera: ahí el nombre sale solo del MRZ.
 */
function fallbackNameFromLines(lines) {
  for (const line of lines || []) {
    if (!line || FALLBACK_NAME_PREFIX.test(line)) continue;
    const cleaned = line.replace(/[,.;:]$/, '').trim();
    if (!/^[A-Z][A-Z \u00C0-\u017F]*$/.test(cleaned)) continue;
    const words = cleaned.split(' ').filter((w) => w.length >= 3);
    if (words.length >= 2 && words.length <= 5) {
      if (words.every((w) => /[AEIOU]/.test(w))) return cleaned;
    }
  }
  return '';
}

// ─── Parser ESPACIAL ─────────────────────────────────────────────────────────
// Agrupa palabras por filas físicas y extrae etiqueta → valor a la DERECHA
// (misma fila) o bloque alineado DEBAJO. Nunca "cualquier línea siguiente".

const CI_FRONT_FIELD_DEFS = [
  { key: 'apellidos', labels: ['APELLIDOS', 'APELLIDO'], type: 'name', extract: true },
  { key: 'nombres', labels: ['NOMBRES', 'NOMBRE'], type: 'name', extract: true },
  {
    key: 'birthDate',
    labels: ['FECHA DE NACIMIENTO', 'FECHA NACIMIENTO', 'NACIMIENTO', 'NACIDO'],
    type: 'date',
    extract: true,
  },
  { key: 'ciNumber', labels: ['NUMERO', 'NO', 'NRO', 'N', 'CI'], type: 'number', extract: true },
  { key: 'issueDate', labels: ['FECHA DE EMISION', 'FECHA EMISION', 'EMISION'], type: 'date', extract: true },
  { key: 'expiryDate', labels: ['FECHA DE EXPIRACION', 'FECHA EXPIRACION', 'EXPIRACION', 'VENCIMIENTO'], type: 'date', extract: true },
  { key: '_sexo', labels: ['SEXO'], type: 'text', extract: false },
];

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Agrupa palabras en filas físicas (solape vertical por centro Y). */
function buildRows(words) {
  const cleaned = [];
  for (const w of Array.isArray(words) ? words : []) {
    const text = normalize(w.text);
    if (!text) continue;
    cleaned.push({
      text,
      clean: text.replace(/[^A-Z0-9]/g, ''),
      x: w.x || 0,
      y: w.y || 0,
      w: w.w || 0,
      h: w.h || 0,
      confidence: w.confidence,
    });
  }
  const sorted = [...cleaned].sort(
    (a, b) => a.y + a.h / 2 - (b.y + b.h / 2),
  );
  const rows = [];
  for (const w of sorted) {
    const cy = w.y + w.h / 2;
    let row = null;
    for (const r of rows) {
      const tol = 0.6 * Math.min(w.h, median(r.hs), 4) + 4;
      if (Math.abs(r.cy - cy) <= tol) {
        row = r;
        break;
      }
    }
    if (!row) {
      rows.push({ cy, hs: [w.h], words: [w] });
    } else {
      row.words.push(w);
      row.hs.push(w.h);
      row.cy = row.cy + (cy - row.cy) / row.words.length;
    }
  }
  for (const r of rows) {
    r.words.sort((a, b) => a.x - b.x);
    r.text = r.words.map((w) => w.text).join(' ');
    r.h = median(r.hs);
    r.x0 = Math.min(...r.words.map((w) => w.x));
    r.x1 = Math.max(...r.words.map((w) => w.x + w.w));
    r.y0 = Math.min(...r.words.map((w) => w.y));
    r.y1 = Math.max(...r.words.map((w) => w.y + w.h));
  }
  rows.sort((a, b) => a.y0 - b.y0);
  return rows;
}

/** ¿La palabra i de la fila inicia alguna etiqueta? */
function startsAnyLabel(row, idx, defs) {
  for (const def of defs) {
    for (const label of def.labels) {
      const lw = label.split(' ');
      if (idx + lw.length > row.words.length) continue;
      if (lw.every((l, k) => row.words[idx + k].clean === l)) return true;
    }
  }
  return false;
}

/**
 * Encuentra las etiquetas presentes en una fila (deduplicadas por campo,
 * conservando la coincidencia más larga).
 */
function findLabelOccurrences(row, defs) {
  const found = [];
  for (const def of defs) {
    for (const label of def.labels) {
      const lw = label.split(' ');
      for (let i = 0; i + lw.length <= row.words.length; i++) {
        if (lw.every((l, k) => row.words[i + k].clean === l)) {
          found.push({ def, label, start: i, end: i + lw.length - 1 });
        }
      }
    }
  }
  const byKey = {};
  for (const o of found) {
    const prev = byKey[o.def.key];
    if (!prev || o.end - o.start > prev.end - prev.start) {
      byKey[o.def.key] = o;
    }
  }
  return Object.values(byKey).sort((a, b) => a.start - b.start);
}

/** Palabras a la derecha de la etiqueta en la misma fila. */
function valueRightOf(row, occ, defs) {
  const vals = [];
  const gapMax = 3 * Math.max(row.h, 4);
  let prev = row.words[occ.end];
  for (let i = occ.end + 1; i < row.words.length; i++) {
    const w = row.words[i];
    if (!w.clean) continue;
    if (startsAnyLabel(row, i, defs)) break;
    if (w.x - (prev.x + prev.w) > gapMax) break;
    vals.push(w);
    prev = w;
  }
  return vals;
}

/** Bloque de valor alineado DEBAJO de la etiqueta. */
function valueBelow(rows, rowIdx, occ, defs, labelRowOccs) {
  const labelRow = rows[rowIdx];
  const gapMax = 3 * Math.max(labelRow.h, 6);
  for (let j = rowIdx + 1; j < rows.length; j++) {
    const r = rows[j];
    if (r.y0 - labelRow.y1 > gapMax) return [];
    if (findLabelOccurrences(r, defs).length) return [];
    if (labelRowOccs.length > 1) {
      const k = labelRowOccs.findIndex((o) => o === occ);
      if (k >= 0 && labelRowOccs.length === r.words.length) {
        return [r.words[k]];
      }
      const lw = labelRow.words[occ.start];
      const le = labelRow.words[occ.end];
      const lo = lw.x - 10;
      const hi = le.x + le.w + 10;
      const hits = r.words.filter((w) => w.x + w.w >= lo && w.x <= hi);
      if (hits.length === 1) return [hits[0]];
      return [];
    }
    return r.words.slice(0);
  }
  return [];
}

/** Valida el valor candidato según el tipo de campo (estricto). */
function validateSpatialValue(words, type) {
  const joined = words.map((w) => w.text).join(' ').trim();
  if (!joined) return '';
  if (type === 'number') {
    const digits = joined.replace(/[^0-9]/g, '');
    return /^\d{6,9}$/.test(digits) ? digits : '';
  }
  if (type === 'date') {
    const dates = findDates(joined);
    return dates.length === 1 ? dates[0] : '';
  }
  const tokens = joined.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 4) return '';
  for (const t of tokens) {
    if (t.length < 2) return '';
    if (!/^[A-Z\u00C0-\u017F]+$/.test(t)) return '';
    if (!/[AEIOU]/.test(t)) return '';
  }
  return tokens.join(' ');
}

/** Extrae los campos de todas las filas según las definiciones. */
function extractSpatialFields(rows, defs) {
  const out = {};
  for (let i = 0; i < rows.length; i++) {
    const occs = findLabelOccurrences(rows[i], defs);
    for (const occ of occs) {
      if (!occ.def.extract) continue;
      if (out[occ.def.key]) continue;
      let words = valueRightOf(rows[i], occ, defs);
      if (!words.length) words = valueBelow(rows, i, occ, defs, occs);
      const val = validateSpatialValue(words, occ.def.type);
      if (val) out[occ.def.key] = val;
    }
  }
  return out;
}

/**
 * Extrae los campos del CI usando solo el texto por líneas
 * (heurísticas clásicas). Se usa cuando no hay geometría o como
 * respaldo de campos que el parser espacial no pudo resolver.
 */
function parseCIFieldsFromLines(text, mrz) {
  const result = { fullName: '', firstNames: '', paternalSurname: '', maternalSurname: '', ciNumber: '', birthDate: '' };

  // Número de CI: preferir los precedidos por N°/No./Nro.
  const rePrefixed = /N\s?(?:[o°º]|RO)\.?\s*:?\s*(\d{6,9})/i;
  let m = rePrefixed.exec(text);
  if (m) {
    result.ciNumber = m[1];
  } else if (!mrz) {
    // "No."/"Nro"/"Numero" seguido de dígitos (con posibles separadores)
    let viaKw = '';
    for (const line of normalizeLines(text)) {
      for (const kw of ['NO', 'NRO', 'NUMERO']) {
        const idx = line.indexOf(kw);
        if (idx === -1) continue;
        const val = line
          .slice(idx + kw.length)
          .replace(/^[\s:.\-–|»]+/, '')
          .trim();
        const digits = val.replace(/[^0-9]/g, '');
        if (/^\d{6,9}$/.test(digits)) {
          viaKw = digits;
          break;
        }
      }
      if (viaKw) break;
    }
    if (viaKw) {
      result.ciNumber = viaKw;
    } else {
      // Cualquier corrida de 6-8 dígitos que no forme parte de una fecha
      const dates = findDates(text);
      const dateDigits = new Set(
        dates
          .map((d) => d.replace(/\D/g, ''))
          .flatMap((d) => [d, d.slice(0, 6), d.slice(2), d.slice(0, 4)]),
      );
      const reDigits = /\b(\d{6,8})\b/g;
      let dm;
      while ((dm = reDigits.exec(text))) {
        if (!dateDigits.has(dm[1])) {
          result.ciNumber = dm[1];
          break;
        }
      }
    }
  }

  // Fecha de nacimiento (solo junto a NACIMIENTO, no EMISIÓN/EXPIRACIÓN)
  result.birthDate = dateNearKeyword(text, ['NACIMIENTO', 'NACIDO']);

  // Nombre: etiquetas NOMBRES / APELLIDOS del nuevo formato
  const nombres = labeledValue(text, ['NOMBRES', 'NOMBRE']);
  const apellidos = labeledValue(text, ['APELLIDOS', 'APELLIDO']);
  if (nombres || apellidos) {
    result.fullName = [nombres, apellidos].filter(Boolean).join(' ').trim();
    result.firstNames = nombres;
    result.surnames = apellidos;
    const surnameParts = apellidos.split(/\s+/).filter(Boolean);
    result.paternalSurname = surnameParts[0] || '';
    result.maternalSurname = surnameParts.slice(1).join(' ');
  }
  if (!result.fullName) {
    result.fullName = fallbackNameFromLines(normalizeLines(text));
  }

  return result;
}

/**
 * Conserva valores de CI que pueden tener más de cuatro palabras o números
 * (por ejemplo, lugar de nacimiento compuesto y domicilio). `labeledValue`
 * es deliberadamente más estricto porque se usa para nombres.
 */
function ciDetailValue(text, keywords, allowNumbers = false) {
  const raw = valueAfterKeyword(text, keywords);
  if (!raw) return '';

  const cleaned = raw
    .replace(allowNumbers ? /[^A-Z0-9ÁÉÍÓÚÜÑ .#\-]/g : /[^A-ZÁÉÍÓÚÜÑ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || LABEL_WORD_RE.test(cleaned)) return '';

  // Evita que una lectura defectuosa ocupe todo el documento como valor.
  return cleaned.split(' ').slice(0, 8).join(' ');
}

/** Extrae los datos complementarios impresos en ambos lados de la cédula. */
function parseCIAdditionalFields(text) {
  const bloodRaw = valueAfterKeyword(text, [
    'GRUPO SANGUINEO',
    'GRUPO SANG',
    'TIPO DE SANGRE',
    'GRUPO',
  ]);
  const bloodMatch = bloodRaw.match(
    /\b(AB|A|B|O)\s*(?:RH\s*)?([+-]|POSITIVO|NEGATIVO)(?![A-Z])/i,
  );
  const bloodSign = bloodMatch
    ? /^(POSITIVO|\+)$/i.test(bloodMatch[2])
      ? '+'
      : '-'
    : '';

  return {
    issueDate: dateNearKeyword(text, ['FECHA DE EMISION', 'FECHA EMISION', 'EMISION', 'EMITIDA EL', 'EMITIDO EL']),
    expiryDate: dateNearKeyword(text, [
      'FECHA DE EXPIRACION',
      'FECHA EXPIRACION',
      'EXPIRACION',
      'VENCIMIENTO',
      'EXPIRA EL',
    ]),
    birthPlace: ciDetailValue(text, [
      'LUGAR DE NACIMIENTO',
      'LUGAR NACIMIENTO',
      'LUGAR DE NAC',
      'LUGAR NAC',
      'NACIO EN',
      'NACIDO EN',
      'NACIDA EN',
    ]),
    address: ciDetailValue(text, ['DOMICILIO', 'DOMIC', 'DOM', 'DIRECCION'], true),
    occupation: labeledValue(text, ['PROFESION/OCUPACION', 'PROFESION / OCUPACION', 'PROFESION', 'OCUPACION']),
    maritalStatus: labeledValue(text, ['ESTADO CIVIL']),
    bloodType: bloodMatch ? `${bloodMatch[1].toUpperCase()}${bloodSign}` : '',
  };
}

// En la CI anterior los nombres y el nacimiento figuran en el reverso,
// antes de "Nacido el". No se infiere un nombre desde texto libre lejano.
function isLegacyFront(text) {
  const normalized = normalize(text);
  return normalized.includes('CEDULA DE IDENTIDAD') &&
    /\bEMITID[AO] EL\b/.test(normalized) && /\bEXPIRA EL\b/.test(normalized);
}

function legacyNameBeforeBirth(text) {
  const lines = normalizeLines(text);
  const birthIndex = lines.findIndex(line => /\bNACID[AO] EL\b/.test(line));
  const nameFrom = raw => String(raw || '')
    .split(/\bNACID[AO] EL\b/)[0]
    .replace(/^(?:SR|SRA)\.?\s+/, '')
    .replace(/^[\s:.,;\-]+|[\s:.,;\-]+$/g, '')
    .replace(/\s+/g, ' ').trim();
  const validName = candidate => {
    if (/\d/.test(candidate)) return false;
    const parts = candidate.split(' ').filter(Boolean);
    return parts.length >= 3 && parts.length <= 5 &&
      parts.every(part => /^[A-ZÁÉÍÓÚÜÑ]{2,}$/.test(part) &&
        !/^(?:CERTIFICA|FIRMA|FOTOGRAFIA|IDENTIFICACION|DOCUMENTOS|REGISTRADOS|CEDULA|IDENTIDAD|NUMERO|PERTENECE|PERTENECEN|SERVICIO|GENERAL|PERSONAL|NACIDO|NACIDA|ESTADO|CIVIL)$/.test(part));
  };
  // "A:" puede cerrar la frase "... pertenecen a:" en la línea anterior.
  // Vision también puede dividir el nombre en dos líneas.
  for (let i = Math.max(0, birthIndex - 6); i <= (birthIndex < 0 ? lines.length - 1 : birthIndex); i++) {
    const labeled = /(?:^|\s)A\s*[:.]\s*(.*)$/.exec(lines[i]);
    if (!labeled) continue;
    const first = labeled[1] || lines[i + 1] || '';
    for (const candidate of [first, `${first} ${lines[i + (labeled[1] ? 1 : 2)] || ''}`]) {
      const name = nameFrom(candidate);
      if (validName(name)) return name;
    }
  }
  if (birthIndex < 0) return '';
  // Respaldo cuando Vision omite "A:"; usar solo líneas inmediatas al nacimiento.
  const beforeBirth = nameFrom(lines[birthIndex]);
  for (let i = birthIndex; i >= Math.max(0, birthIndex - 4); i--) {
    const first = i === birthIndex ? beforeBirth : lines[i];
    for (const candidate of [first, i < birthIndex ? `${first} ${i + 1 === birthIndex ? beforeBirth : lines[i + 1]}` : '']) {
      const name = nameFrom(candidate);
      if (validName(name)) return name;
    }
  }
  return '';
}

function legacyBirthPlaceAfterEn(text) {
  const lines = normalizeLines(text);
  const birthIndex = lines.findIndex(line => /\bNACID[AO] EL\b/.test(line));
  for (let i = Math.max(0, birthIndex); i < lines.length; i++) {
    const line = lines[i];
    if (/\b(?:ESTADO CIVIL|PROFESION|OCUPACION|DOMICILIO)\b/.test(line)) break;
    const match = birthIndex >= 0 && i === birthIndex
      ? /\bNACID[AO] EL\b.*?\bEN\b\s*[:.\-]?\s*(.*)$/.exec(line)
      : /^EN\s*[:.\-]?\s*(.*)$/.exec(line);
    if (!match) continue;
    const raw = (match[1] || lines[i + 1] || '')
      .split(/\b(?:ESTADO CIVIL|PROFESION|OCUPACION|DOMICILIO)\b/)[0];
    const place = raw.replace(/[^A-ZÁÉÍÓÚÜÑ ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (place && place.split(' ').length <= 8 &&
        !/^(?:ESTADO|PROFESION|OCUPACION|DOMICILIO|NACID[AO])\b/.test(place)) return place;
  }
  return '';
}

// El frente anterior solo imprime emisión y vencimiento. Si Vision separó
// las etiquetas de las fechas, usar las dos fechas completas y distintas,
// siempre que no contradigan una fecha ya asociada a su etiqueta.
function completeLegacyFrontDates(result, text) {
  if (result.issueDate && result.expiryDate) return;
  const dates = [...new Set(findDates(text))];
  if (dates.length !== 2) return;
  dates.sort((a, b) => require('./identityValidation').isoDate(a)
    .localeCompare(require('./identityValidation').isoDate(b)));
  const [issueDate, expiryDate] = dates;
  if (result.issueDate && result.issueDate !== issueDate) return;
  if (result.expiryDate && result.expiryDate !== expiryDate) return;
  result.issueDate = issueDate;
  result.expiryDate = expiryDate;
}

// ─── Parser: CI ──────────────────────────────────────────────────────────────
function parseCI(text, options) {
  const documentType = (options && options.documentType) || 'ciFront';
  const mrz = parseMRZ(text);
  const format = options && options.format ||
    (documentType === 'ciBack'
      ? (detectMRZ(text) ? 'current' : 'legacy')
      : (isLegacyFront(text) ? 'legacy' : 'current'));
  const result = {
    fullName: '',
    firstNames: '',
    paternalSurname: '',
    maternalSurname: '',
    ciNumber: '',
    birthDate: '',
    ...parseCIAdditionalFields(text),
    mrz: !!mrz,
    format,
  };

  // La CI anterior no tiene MRZ: nombre y nacimiento se leen del reverso.
  if (documentType === 'ciBack') {
    if (result.format === 'legacy') {
      const name = legacyNameBeforeBirth(text);
      const parts = name.split(' ').filter(Boolean);
      if (parts.length >= 3 && parts.length <= 5) {
        result.firstNames = parts.slice(0, -2).join(' ');
        result.surnames = parts.slice(-2).join(' ');
        result.paternalSurname = parts.at(-2);
        result.maternalSurname = parts.at(-1);
        result.fullName = name;
      }
      result.birthDate = dateNearKeyword(text, ['NACIDO EL', 'NACIDA EL']);
      // En este reverso suele haber una sola fecha, incluso si Vision separa
      // la etiqueta y la fecha en líneas distintas.
      if (!result.birthDate) {
        const dates = [...new Set(findDates(text))];
        if (dates.length === 1) result.birthDate = dates[0];
      }
      if (!result.birthPlace) result.birthPlace = legacyBirthPlaceAfterEn(text);
      const number = /\bN\s?(?:[o°º]|RO)\.?\s*:?\s*(\d{6,9})\b/i.exec(text);
      if (number) result.ciNumber = number[1];
      return result;
    }
    // Formato actual: identidad del reverso solo desde la MRZ.
    if (mrz) {
      result.ciNumber = mrz.ciNumber;
      result.birthDate = mrz.birthDate;
      result.fullName = mrz.fullName;
    }
    return result;
  }

  const words =
    options && Array.isArray(options.words) && options.words.length
      ? options.words
      : null;

  if (words) {
    const rows = buildRows(words);
    const spatial = extractSpatialFields(rows, CI_FRONT_FIELD_DEFS);
    if (spatial.ciNumber) result.ciNumber = spatial.ciNumber;
    if (spatial.birthDate) result.birthDate = spatial.birthDate;
    if (spatial.issueDate) result.issueDate = spatial.issueDate;
    if (spatial.expiryDate) result.expiryDate = spatial.expiryDate;
    if (spatial.nombres || spatial.apellidos) {
      result.fullName = [spatial.nombres, spatial.apellidos]
        .filter(Boolean)
        .join(' ')
        .trim();
      result.firstNames = spatial.nombres || '';
      result.surnames = spatial.apellidos || '';
      const surnameParts = String(spatial.apellidos || '').split(/\s+/).filter(Boolean);
      result.paternalSurname = surnameParts[0] || '';
      result.maternalSurname = surnameParts.slice(1).join(' ');
    }
    // Respaldo por líneas para los campos que la geometría no resolvió
    const lineResult = parseCIFieldsFromLines(text, mrz);
    if (!result.ciNumber && lineResult.ciNumber) {
      result.ciNumber = lineResult.ciNumber;
    }
    if (!result.birthDate && lineResult.birthDate) {
      result.birthDate = lineResult.birthDate;
    }
    if (!result.fullName && lineResult.fullName) {
      result.fullName = lineResult.fullName;
    }
    if (!result.firstNames) result.firstNames = lineResult.firstNames;
    if (!result.paternalSurname) result.paternalSurname = lineResult.paternalSurname;
    if (!result.maternalSurname) result.maternalSurname = lineResult.maternalSurname;
    if (!result.surnames) result.surnames = lineResult.surnames;
  } else {
    const lineResult = parseCIFieldsFromLines(text, mrz);
    result.ciNumber = lineResult.ciNumber;
    result.birthDate = lineResult.birthDate;
    result.fullName = lineResult.fullName;
    result.firstNames = lineResult.firstNames;
    result.paternalSurname = lineResult.paternalSurname;
    result.maternalSurname = lineResult.maternalSurname;
    result.surnames = lineResult.surnames;
  }

  // Respaldo MRZ
  if (mrz) {
    if (!result.ciNumber) result.ciNumber = mrz.ciNumber;
    if (!result.birthDate) result.birthDate = mrz.birthDate;
    if (!result.fullName) result.fullName = mrz.fullName;
  }

  if (result.format === 'legacy') completeLegacyFrontDates(result, text);

  return result;
}

// ─── Clasificación / validación de CI ────────────────────────────────────────
const CI_FRONT_KEYWORDS = [
  'CEDULA DE IDENTIDAD',
  'SERVICIO GENERAL DE IDENTIFICACION',
  'NOMBRES',
  'APELLIDOS',
  'NACIMIENTO',
  'EMISION',
  'EXPIRACION',
  'SEXO',
  'FIRMA',
];
const CI_BACK_KEYWORDS = [
  'DOMICILIO',
  'PROFESION',
  'OCUPACION',
  'ESTADO CIVIL',
  'GRUPO SANGUINEO',
  'LUGAR DE NACIMIENTO',
];

/**
 * Detecta zona MRZ: línea "IDBOL..." o línea larga con varios '<' y dígitos
 * (una línea MRZ siempre lleva dígitos: número, fechas, checks).
 */
function detectMRZ(text) {
  const lines = normalizeLines(text);
  for (const l of lines) {
    if (l.includes('IDBOL')) return true;
    const chevrons = (l.match(/</g) || []).length;
    if (
      chevrons >= 4 &&
      l.length >= 20 &&
      /\d/.test(l) &&
      /^[A-Z0-9<]+$/.test(l)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Puntúa el texto para decidir si es el frente o la trasera de la CI.
 * @param {string} text texto OCR
 * @param {number} facesFound cantidad de rostros detectados
 */
function classifyCI(text, facesFound) {
  const t = normalize(text);
  let frontScore = facesFound > 0 ? 2 : 0;
  for (const kw of CI_FRONT_KEYWORDS) {
    if (t.includes(normalize(kw))) frontScore++;
  }
  const hasMRZ = detectMRZ(text);
  let backScore = hasMRZ ? 3 : 0;
  for (const kw of CI_BACK_KEYWORDS) {
    if (t.includes(normalize(kw))) backScore++;
  }
  return { frontScore, backScore, hasMRZ };
}

/**
 * Valida que la foto corresponda al lado esperado de la cédula.
 * @param {string} text texto OCR
 * @param {number} facesFound rostros detectados
 * @param {'ciFront'|'ciBack'} side lado solicitado
 */
function validateCI(text, facesFound, side) {
  if (!String(text || '').trim()) {
    return {
      rejected: true,
      rejectReason:
        'No se pudo leer ningún texto de la foto. Vuelve a tomarla con mejor luz.',
    };
  }

  const { frontScore, backScore, hasMRZ } = classifyCI(text, facesFound);

  if (side === 'ciFront') {
    // Basura tipo MRZ (código de barras, firma) no debe tumbar un frente claro:
    // si hay señales frontales fuertes, gana el frente.
    if (hasMRZ && frontScore < 2) {
      return {
        rejected: true,
        rejectReason: 'Esta es la parte trasera de la cédula. Sube la foto frontal.',
      };
    }
    if (frontScore >= 2) return { rejected: false, rejectReason: '' };
    if (backScore >= 2 && frontScore === 0) {
      return {
        rejected: true,
        rejectReason: 'Esta es la parte trasera de la cédula. Sube la foto frontal.',
      };
    }
    if (frontScore === 0) {
      return {
        rejected: true,
        rejectReason: 'No parece ser una cédula de identidad. Sube la foto correcta.',
      };
    }
    return { rejected: false, rejectReason: '' };
  }

  // ciBack
  if (facesFound > 0) {
    return {
      rejected: true,
      rejectReason: 'Esta es la parte frontal de la cédula. Sube la parte trasera.',
    };
  }
  if (hasMRZ) return { rejected: false, rejectReason: '' };
  if (backScore >= 2) return { rejected: false, rejectReason: '' };
  if (frontScore >= 2) {
    return {
      rejected: true,
      rejectReason: 'Esta es la parte frontal de la cédula. Sube la parte trasera.',
    };
  }
  return {
    rejected: true,
    rejectReason: 'No parece ser una cédula de identidad. Sube la foto correcta.',
  };
}

// ─── Parser: Licencia de conducir ────────────────────────────────────────────
function parseLicense(text, options) {
  const result = {
    licenseNumber: '',
    fullName: '',
    nationality: '',
    issueDate: '',
    licenseExpiryDate: '',
    birthDate: '',
    licenseCategory: '',
    glasses: '',
    bloodType: '',
    hearingAid: '',
  };

  // No usar solamente `valueAfterKeyword('LICENCIA')`: suele encontrar antes
  // el título "LICENCIA DE CONDUCIR" que la línea del número.
  const licenseNumberPatterns = [
    /(?:NUMERO|NRO|NO|N)[.°º\s]*(?:DE\s*)?(?:LICENCIA|LIC\.?)\s*[:#.-]*\s*(\d{6,9})/i,
    /(?:LICENCIA|LIC\.?)\s*(?:NUMERO|NRO|NO|N)[.°º\s]*[:#.-]*\s*(\d{6,9})/i,
    /(?:NRO|NO|N)[.°º\s]*[:#.-]*\s*(\d{6,9})/i,
  ];
  for (const pattern of licenseNumberPatterns) {
    const match = pattern.exec(stripAccents(text));
    if (match) {
      result.licenseNumber = match[1];
      break;
    }
  }
  const licenseNames = labeledValue(text, ['NOMBRES Y APELLIDOS', 'NOMBRE COMPLETO', 'NOMBRES', 'NOMBRE']);
  const licenseSurnames = labeledValue(text, ['APELLIDOS', 'APELLIDO']);
  result.fullName = [licenseNames, licenseSurnames].filter(Boolean).join(' ').trim();
  result.nationality = labeledValue(text, ['NACIONALIDAD']);
  result.issueDate = dateNearKeyword(text, ['FECHA DE EMISION', 'FECHA EMISION', 'EMISION']);
  result.birthDate = dateNearKeyword(text, ['FECHA DE NACIMIENTO', 'NACIMIENTO']);

  result.licenseExpiryDate =
    dateNearKeyword(text, [
      'VENCIMIENTO',
      'VENCIMlENTO',
      'VENCIMENTO',
      'EXPIRA',
      'EXPIRACION',
      'VENCE',
      'VALIDA HASTA',
      'HASTA',
    ]) || '';

  // Categoría: CATEGORIA: P / CAT. P-C / CLASE P
  const reCat = /CATEGORI[A]?\s*[.:]?\s*([A-Z](?:\s*[.\-–]\s*[A-Z])?)/;
  const reClase = /CLASE\s*[.:]?\s*([A-Z](?:\s*[.\-–]\s*[A-Z])?)/;
  const mc = text.match(reCat) || text.match(reClase);
  if (mc) {
    result.licenseCategory = mc[1].replace(/\s+/g, '');
  } else {
    // Algunas licencias imprimen únicamente la letra de categoría, sin etiqueta.
    const standaloneCategory = normalizeLines(text).find((line) =>
      /^(?:P|A|B|C)(?:\s*[.\-–]\s*(?:P|A|B|C))?$/.test(line),
    );
    if (standaloneCategory) {
      result.licenseCategory = standaloneCategory.replace(/[\s.\-–]/g, '');
    }
  }

  const yesNo = (labels) => {
    const value = normalize(valueAfterKeyword(text, labels));
    if (/\b(SI|SIEMPRE|YES)\b/.test(value)) return 'Sí';
    if (/\b(NO|NONE)\b/.test(value)) return 'No';
    return '';
  };
  result.glasses = yesNo(['LENTES', 'USA LENTES']);
  result.hearingAid = yesNo(['AUDIFONOS', 'USA AUDIFONOS']);
  const blood = valueAfterKeyword(text, ['GRUPO SANGUINEO', 'GRUPO SANG', 'GRUPO']);
  const bloodMatch = blood.match(/\b(AB|A|B|O)\s*(?:RH\s*)?([+-]|POSITIVO|NEGATIVO)(?![A-Z])/i);
  if (bloodMatch) result.bloodType = `${bloodMatch[1].toUpperCase()}${/^(POSITIVO|\+)$/i.test(bloodMatch[2]) ? '+' : '-'}`;

  return result;
}

// ─── Parser: SOAT ────────────────────────────────────────────────────────────
function parseSoat(text) {
  const result = { soatRosetteNumber: '', soatStartDate: '', soatExpiryDate: '', soatUse: '' };

  result.soatStartDate =
    dateNearKeyword(text, ['VIGENCIA DESDE', 'INICIO VIGENCIA', 'DESDE']) || '';

  result.soatExpiryDate =
    dateNearKeyword(text, ['VENCIMIENTO', 'EXPIRA', 'VENCE', 'VIGENCIA', 'HASTA']) ||
    '';

  const reRosette = /(?:ROSETA|N[ÚU]MERO\s+ROSETA|NRO\s+ROSETA)\s*[.:N°º]*\s*([A-Z0-9-]{5,20})/i;
  const mp = text.match(reRosette);
  if (mp) {
    result.soatRosetteNumber = mp[1];
  }
  const use = valueAfterKeyword(text, ['USO', 'TIPO DE USO']);
  if (/PUBLICO/.test(use)) result.soatUse = 'PUBLICO';
  if (/PARTICULAR/.test(use)) result.soatUse = 'PARTICULAR';

  return result;
}

// ─── Mapeo clase RUAT → tipo de vehículo de la app ───────────────────────────
const DEFAULT_CAPACITY = { taxi: 4, minibus: 14, bus: 35, motorcycle: 1 };

function mapClassToVehicleType(cls) {
  const c = stripAccents(cls || '');
  if (/MOTOCICLETA|MOTOCARRO|CUADRATRACK|MOTONETA|MOTOTAXI/.test(c)) return 'motorcycle';
  if (/MINIBUS|MINI BUS|MICROBUS|MICRO BUS/.test(c)) return 'minibus';
  if (/OMNIBUS|AUTOBUS|BUS|FLOTA/.test(c)) return 'bus';
  return 'taxi';
}

// ─── Parser: RUAT ────────────────────────────────────────────────────────────
function parseRuat(text) {
  const result = {
    vehiclePlate: '',
    vehicleBrand: '',
    vehicleModel: '',
    vehicleYear: '',
    vehicleColor: '',
    vehicleClass: '',
    vehicleType: '',
    vehiclePassengerCapacity: '',
    vehicleOwnerName: '',
    vehicleOwnerCi: '',
    registrationMunicipality: '', crpvaNumber: '', ruatIssueDate: '', ownershipStartDate: '',
    doorCount: '', serviceType: '', chassisNumber: '', engineNumber: '', fuelType: '',
    engineDisplacement: '', engineType: '', legalObservations: '',
  };

  // Placa: formato boliviano "1234ABC" / "1234 ABC" / "AB 1234"
  const rePlate = /\b([A-Z]{2}\s?\d{4}|\d{3,4}\s?[A-Z]{3,4})\b/;
  const mp = text.toUpperCase().match(rePlate);
  if (mp) {
    result.vehiclePlate = mp[1].replace(/\s+/g, '');
  } else {
    const viaKeyword = valueAfterKeyword(text, ['PLACA', 'NO DE PLACA', 'NUMERO DE PLACA']);
    const km = viaKeyword.match(/[A-Z0-9]{4,8}/);
    if (km) result.vehiclePlate = km[0];
  }

  result.vehicleBrand = valueAfterKeyword(text, ['MARCA']);
  result.vehicleModel = valueAfterKeyword(text, ['MODELO']);
  result.vehicleColor = valueAfterKeyword(text, ['COLOR']);
  result.vehicleOwnerName = labeledValue(text, [
    'PROPIETARIO', 'NOMBRE DEL PROPIETARIO', 'TITULAR', 'NOMBRE TITULAR',
  ]);
  const ownerCiRaw = valueAfterKeyword(text, ['CI PROPIETARIO', 'DOCUMENTO IDENTIDAD', 'CEDULA DE IDENTIDAD', 'C.I.']);
  const ownerCiMatch = ownerCiRaw.match(/\b\d{5,10}(?:\s*[A-Z]{2})?\b/i);
  result.vehicleOwnerCi = ownerCiMatch ? ownerCiMatch[0].replace(/\s+/g, '') : '';
  result.vehicleClass = valueAfterKeyword(text, ['CLASE', 'TIPO DE VEHICULO', 'CLASE DE VEHICULO']);
  result.registrationMunicipality = valueAfterKeyword(text, ['RADICATORIA', 'MUNICIPIO']);
  result.crpvaNumber = valueAfterKeyword(text, ['CRPVA', 'NUMERO CRPVA', 'NRO CRPVA']);
  result.ruatIssueDate = valueAfterKeyword(text, ['FECHA EMISION', 'EMISION']);
  result.ownershipStartDate = valueAfterKeyword(text, ['INICIO PROPIEDAD', 'FECHA INICIO PROPIEDAD']);
  result.doorCount = valueAfterKeyword(text, ['NUMERO PUERTAS', 'NRO PUERTAS']).match(/\d{1,2}/)?.[0] || '';
  result.serviceType = valueAfterKeyword(text, ['TIPO SERVICIO', 'SERVICIO']);
  result.chassisNumber = valueAfterKeyword(text, ['NUMERO CHASIS', 'NRO CHASIS', 'CHASIS']).replace(/\s+/g, '');
  result.engineNumber = valueAfterKeyword(text, ['NUMERO MOTOR', 'NRO MOTOR', 'MOTOR']).replace(/\s+/g, '');
  result.fuelType = valueAfterKeyword(text, ['COMBUSTIBLE']);
  result.engineDisplacement = valueAfterKeyword(text, ['CILINDRADA']);
  result.engineType = valueAfterKeyword(text, ['TIPO MOTOR']);
  result.legalObservations = valueAfterKeyword(text, ['OBSERVACIONES', 'RESTRICCIONES']);

  // Año: 4 dígitos plausibles cerca de "AÑO/ANO/MODELO"
  const yearFromKeyword = valueAfterKeyword(text, ['ANO', 'AÑO']);
  const ym = yearFromKeyword.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  if (ym) {
    result.vehicleYear = ym[0];
  } else {
    const anyYear = String(text).match(/\b(19[5-9]\d|20[0-2]\d)\b/);
    if (anyYear) result.vehicleYear = anyYear[0];
  }

  result.vehicleType = mapClassToVehicleType(result.vehicleClass || result.vehicleModel);
  result.vehiclePassengerCapacity = String(
    DEFAULT_CAPACITY[result.vehicleType] || 4,
  );

  return result;
}

// ─── Despachador ─────────────────────────────────────────────────────────────
const PARSERS = {
  ciFront: parseCI,
  ciBack: parseCI,
  licenseFront: parseLicense,
  licenseBack: parseLicense,
  soatPhoto: parseSoat,
  ruatPhoto: parseRuat,
};

/** Campos requeridos por tipo de documento (para saber si la extracción fue completa). */
const REQUIRED_BY_TYPE = {
  ciFront: ['ciNumber', 'firstNames', 'surnames', 'birthDate', 'issueDate', 'expiryDate'],
  ciBack: ['birthPlace', 'address', 'occupation', 'maritalStatus'],
  licenseFront: ['licenseNumber', 'fullName', 'nationality', 'issueDate', 'licenseExpiryDate', 'birthDate', 'licenseCategory'],
  licenseBack: ['licenseNumber', 'issueDate', 'licenseExpiryDate', 'glasses', 'bloodType', 'hearingAid', 'licenseCategory'],
  soatPhoto: ['soatExpiryDate'],
  ruatPhoto: ['vehiclePlate', 'vehicleBrand', 'vehicleModel', 'vehicleYear', 'vehicleColor', 'vehicleOwnerName', 'vehicleOwnerCi'],
  antecedentsPhoto: [],
  profilePhoto: [],
  carFront: [],
  carBack: [],
  carLeft: [],
  carRight: [],
};
const REQUIRED_LEGACY_CI = {
  ciFront: ['ciNumber', 'issueDate', 'expiryDate'],
  ciBack: ['firstNames', 'surnames', 'birthDate', 'birthPlace', 'address', 'occupation', 'maritalStatus'],
};

/**
 * Extrae y parsea el texto de una imagen según su tipo de documento.
 * @param {Buffer} buffer imagen
 * @param {string} documentType uno de los tipos soportados
 * @returns {{fields: object, rawText: string, missing: string[], facesFound: number, rejected: boolean, rejectReason: string, words: Array}}
 */
async function extractDocument(buffer, documentType) {
  const { text: rawText, facesFound, words } = await annotateImageBuffer(buffer);

  const parser = PARSERS[documentType];
  const fields = parser ? parser(rawText, { words, documentType }) : {};

  // Validación de tipo/lado (por ahora solo CI)
  let rejected = false;
  let rejectReason = '';
  let classify = null;
  if (documentType === 'ciFront' || documentType === 'ciBack') {
    classify = classifyCI(rawText, facesFound);
    const v = validateCI(rawText, facesFound, documentType);
    rejected = v.rejected;
    rejectReason = v.rejectReason;
  }

  const required = fields.format === 'legacy'
    ? REQUIRED_LEGACY_CI[documentType] || []
    : REQUIRED_BY_TYPE[documentType] || [];
  const missing = required.filter(
    (key) => !fields[key] || !String(fields[key]).trim(),
  );

  return { fields, rawText, missing, facesFound, rejected, rejectReason, words, classify };
}

module.exports = {
  extractDocument,
  extractTextFromBuffer,
  annotateImageBuffer,
  parseCI,
  parseLicense,
  parseSoat,
  parseRuat,
  parseMRZ,
  classifyCI,
  validateCI,
  buildRows,
  mapClassToVehicleType,
  DEFAULT_CAPACITY,
  REQUIRED_BY_TYPE,
};
