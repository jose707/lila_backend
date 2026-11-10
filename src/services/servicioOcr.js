// backend/src/services/servicioOcr.js
/**
 * Extracción de datos desde imágenes de documentos bolivianos
 * usando Google Cloud Vision API.
 *
 * - Reutiliza la cuenta de servicio de Firebase/FCM si no hay
 *   GOOGLE_APPLICATION_CREDENTIALS explícita.
 * - Incluye parsers heurísticos para: CI, licencia de conducir,
 *   SOAT, RUAT y antecedentes policiales.
 * - Incluye un parser ESPACIAL (etiqueta → valor a la derecha o
 *   debajo) cuando hay geometría de palabras; si no, se usa el
 *   parser por líneas.
 */
const fs = require('fs');
const ruta = require('path');
const vision = require('@google-cloud/vision');

// ─── Credenciales / cliente ─────────────────────────────────────────────────
function resolverCredencialesRuta(brutoRuta) {
  if (!brutoRuta) return null;
  if (ruta.isAbsolute(brutoRuta)) return brutoRuta;

  const desdeCwd = ruta.resolve(process.cwd(), brutoRuta);
  if (fs.existsSync(desdeCwd)) return desdeCwd;

  const desdeServidorRaiz = ruta.resolve(__dirname, '../../', brutoRuta);
  if (fs.existsSync(desdeServidorRaiz)) return desdeServidorRaiz;

  return desdeCwd;
}

let visionCliente = null;

function obtenerVisionCliente() {
  if (visionCliente) return visionCliente;

  const opciones = {};

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const resuelto = resolverCredencialesRuta(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    if (!fs.existsSync(resuelto)) {
      throw new Error(
        `Archivo de credenciales no encontrado: ${resuelto}. Verifica GOOGLE_APPLICATION_CREDENTIALS en backend/.env`
      );
    }
    opciones.keyFilename = resuelto;
  } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    opciones.credentials = {
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    };
  } else {
    throw new Error(
      'Credenciales de Google no configuradas. Agrega GOOGLE_APPLICATION_CREDENTIALS (ruta a serviceAccountKey.json) ' +
      'o FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY en backend/.env'
    );
  }

  visionCliente = new vision.ImageAnnotatorClient(opciones);
  return visionCliente;
}

/**
 * Extrae las palabras con su geometría (bbox en píxeles) desde la
 * respuesta de Vision: pages[0].blocks[].paragraphs[].words[].boundingBox.
 */
function extraerPalabrasDesdeAnnotation(resultado) {
  const annotation = resultado && resultado.fullTextAnnotation;
  const pages = Array.isArray(annotation && annotation.pages) ?
  annotation.pages :
  [];
  const palabras = [];
  for (const pagina of pages) {
    for (const bloquear of Array.isArray(pagina.blocks) ? pagina.blocks : []) {
      for (const paragraph of Array.isArray(bloquear.paragraphs) ? bloquear.paragraphs : []) {
        for (const palabra of Array.isArray(paragraph.words) ? paragraph.words : []) {
          const texto = (
          palabra.text ||
          (palabra.symbols || []).map((s) => s.text || '').join('')).
          trim();
          const caja = palabra.boundingBox;
          const vertices =
          caja && Array.isArray(caja.vertices) ? caja.vertices : [];
          if (!texto || vertices.length < 4) continue;
          const xs = vertices.map((v) => v.x || 0);
          const ys = vertices.map((v) => v.y || 0);
          palabras.push({
            text: texto,
            x: Math.min(...xs),
            y: Math.min(...ys),
            w: Math.max(...xs) - Math.min(...xs),
            h: Math.max(...ys) - Math.min(...ys),
            vertices: vertices.map((v) => ({ x: v.x || 0, y: v.y || 0 })),
            confidence:
            typeof palabra.confidence === 'number' ? palabra.confidence : null
          });
        }
      }
    }
  }
  return palabras;
}

/**
 * Analiza una imagen (buffer) con una sola llamada a Vision:
 * extrae texto de documentos (DOCUMENT_TEXT_DETECTION) y, cuando se solicita,
 * detecta rostros (FACE_DETECTION).
 * @returns {{ text: string, facesFound: number, words: Array }}
 */
async function anotarImagenBuffer(buffer, detectRostros = false) {
  const cliente = obtenerVisionCliente();
  const [resultado] = await cliente.annotateImage({
    image: { content: buffer },
    features: detectRostros ?
    [{ type: 'DOCUMENT_TEXT_DETECTION' }, { type: 'FACE_DETECTION' }] :
    [{ type: 'DOCUMENT_TEXT_DETECTION' }],
    imageContext: { languageHints: ['es'] }
  });
  const annotation = resultado && resultado.fullTextAnnotation;
  const texto = annotation && annotation.text ? annotation.text : '';
  const rostrosEncontrado = Array.isArray(resultado && resultado.faceAnnotations) ?
  resultado.faceAnnotations.length :
  0;
  const palabras = extraerPalabrasDesdeAnnotation(resultado);
  return { text: texto, facesFound: rostrosEncontrado, words: palabras };
}

/**
 * Extrae el texto completo de una imagen (buffer).
 */
async function extraerTextoDesdeBuffer(buffer) {
  const { text: texto } = await anotarImagenBuffer(buffer);
  return texto;
}

// ─── Utilidades de normalización ─────────────────────────────────────────────
const stripAccents = (s) =>
(s || '').
normalize('NFD').
replace(/[\u0300-\u036f]/g, '').
toUpperCase();

const normalizar = (s) =>
stripAccents(s || '').
replace(/[|\\]/g, ' ').
replace(/\s+/g, ' ').
trim();

const normalizarLineas = (texto) =>
String(texto || '').
split(/\r?\n/).
map(normalizar).
filter(Boolean);

/** Encuentra todas las fechas DD/MM/YYYY (o variantes) con su posición. */
function buscarFechasConPositions(texto) {
  const encontrado = [];
  const re = /\b(\d{1,2})[\/\-. ](\d{1,2})[\/\-.]((?:19|20)?\d{2})\b/g;
  let m;
  while (m = re.exec(texto || '')) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    if (require("./identidadValidacion").isoFecha(`${dd}/${mm}/${yyyy}`)) {
      encontrado.push({ value: `${dd}/${mm}/${yyyy}`, pos: m.index });
    }
  }
  const meses = {
    ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
    JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10,
    NOVIEMBRE: 11, DICIEMBRE: 12
  };
  const written = /\b(\d{1,2})[\s.,:;]+(?:DE\s+)?(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)[\s.,:;]+(?:(?:DE|DEL)\s+)?((?:19|20)\d{2})\b/g;
  const normalizado = stripAccents(texto || '');
  while (m = written.exec(normalizado)) {
    const valor = `${m[1].padStart(2, '0')}/${String(meses[m[2]]).padStart(2, '0')}/${m[3]}`;
    if (require("./identidadValidacion").isoFecha(valor)) encontrado.push({ value: valor, pos: m.index });
  }
  return encontrado.sort((primero, segundo) => primero.pos - segundo.pos);
}

/** Encuentra todas las fechas DD/MM/YYYY (o variantes) en un texto. */
function buscarFechas(texto) {
  return buscarFechasConPositions(texto).map((d) => d.value);
}

// Línea siguiente que NO puede ser el valor de una etiqueta de fecha
const SIGUIENTE_LINEA_ETIQUETA_RE = /^(FECHA|EMISION|EXPIRACION|VENCIMIENTO|VIGENCIA|VENCE|VALIDA|HASTA|NACIMIENTO|NACIDO|DIRECCION|CATEGORIA|RENOVACION|POLIZA)/;

/**
 * Busca una fecha cercana a una palabra clave:
 * - Misma línea: la primera fecha DESPUÉS de la etiqueta.
 * - Línea siguiente: solo si es "fecha pura" (no otra etiqueta antes).
 */
function fechaCercanoKeyword(texto, palabrasClave) {
  const lineas = normalizarLineas(texto);
  const kws = palabrasClave.map(stripAccents);
  for (let indice = 0; indice < lineas.length; indice++) {
    const linea = lineas[indice];
    for (const palabraClave of kws) {
      const idx = linea.indexOf(palabraClave);
      if (idx === -1) continue;
      const mismo = buscarFechasConPositions(linea).filter(
        (d) => d.pos >= idx
      );
      if (mismo.length) return mismo[0].value;
      if (indice + 1 < lineas.length) {
        const siguiente = lineas[indice + 1];
        const siguienteFechas = buscarFechasConPositions(siguiente);
        if (siguienteFechas.length === 1) {
          const antes = siguiente.
          slice(0, siguienteFechas[0].pos).
          replace(/[^A-Z]/g, '');
          if (antes.length <= 4 && !SIGUIENTE_LINEA_ETIQUETA_RE.test(antes)) {
            return siguienteFechas[0].value;
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
function valorDespuesKeyword(texto, palabrasClave) {
  const lineas = normalizarLineas(texto);
  const kws = palabrasClave.map(stripAccents);
  for (let indice = 0; indice < lineas.length; indice++) {
    const linea = lineas[indice];
    for (const palabraClave of kws) {
      const idx = linea.indexOf(palabraClave);
      if (idx !== -1) {
        let val = linea.slice(idx + palabraClave.length);
        val = val.replace(/^[\s:.\-–|»]+/, '').trim();
        if (val.length >= 2) return val;
        if (indice + 1 < lineas.length && lineas[indice + 1].length >= 2) {
          return lineas[indice + 1];
        }
        return val;
      }
    }
  }
  return '';
}

// Palabras que nunca pueden ser un valor de nombre (etiquetas/ruido)
const ETIQUETA_PALABRA_RE = /^(APELLIDOS|APELLIDO|NOMBRES|NOMBRE|SEXO|FECHA|NACIMIENTO|NACIDO|EMISION|EXPIRACION|VENCIMIENTO|VIGENCIA|VENCE|VALIDA|HASTA|DOMICILIO|PROFESION|OCUPACION|ESTADO|CIVIL|GRUPO|SANGUINEO|LUGAR|FIRMA|NACIONALIDAD|CORREO|LIBRO|NO|NRO|NUMERO|RENOVACION|DIRECCION|CATEGORIA|CLASE|MARCA|MODELO|COLOR|PLACA|POLIZA|SOAT|TIPO|CEDULA|IDENTIDAD|REPUBLICA|BOLIVIA|IDENTIFICACION|SERVICIO|GENERAL|PERSONAL|ANTECEDENTES|VEHICULO|CONDUCIR|LICENCIA|CONDUCCION|SEGURO|OBLIGATORIO|ACCIDENTES|TRANSITO|REGISTRO|AUTOMOTOR)$/;

/**
 * Valor de una etiqueta de campo (ej: "NOMBRES: JUAN CARLOS").
 * Solo texto alfabético plausible (1-4 palabras con vocales) y
 * nunca una etiqueta o una fecha.
 */
function etiquetadoValor(texto, palabrasClave) {
  const bruto = valorDespuesKeyword(texto, palabrasClave);
  const limpio = bruto.
  replace(/[^A-Za-z\u00C0-\u017F ]/g, ' ').
  replace(/\s+/g, ' ').
  trim();
  const palabras = limpio.
  split(' ').
  filter((w) => w.length >= 2 && /[AEIOU]/.test(w));
  if (!palabras.length || palabras.length > 4) return '';
  if (palabras.some((w) => ETIQUETA_PALABRA_RE.test(w))) return '';
  return palabras.join(' ');
}

// ─── MRZ (CI boliviana) ──────────────────────────────────────────────────────
function analizarMrz(texto) {
  const { lines: lineas, index: indice } = require('./ciMrz').normalizarMrzLineas(texto);
  if (indice === -1) return null;

  const primero = lineas[indice];
  const spacedPrimero = normalizar(String(texto || '').split(/\r?\n/)[indice] || '');
  const separatedNumero = /^(?:IDBOL|I<BOL)\s+(\d{6,9})\s+[0-9<](?:\s|$)/.exec(spacedPrimero);
  const numeroCoincidencia = separatedNumero ? [separatedNumero[1]] : primero.length === 30 ?
  primero.slice(5, 14).match(/^\d{6,9}(?=<|$)/) :
  primero.match(/\d{6,9}/);
  const ciNumero = numeroCoincidencia ? numeroCoincidencia[0] : '';

  // Fecha de nacimiento: segunda línea MRZ, posiciones 0-6 (AAMMDD)
  let nacimientoFecha = '';
  const segundo = indice + 1 < lineas.length ? lineas[indice + 1] : '';
  if (segundo) {
    const yymmdd = segundo.match(/^(\d{6})/);
    if (yymmdd) {
      const [, bruto] = yymmdd;
      const yy = parseInt(bruto.slice(0, 2), 10);
      const anio = yy <= new Date().getUTCFullYear() % 100 ? `20${bruto.slice(0, 2)}` : `19${bruto.slice(0, 2)}`;
      nacimientoFecha = `${bruto.slice(4, 6)}/${bruto.slice(2, 4)}/${anio}`;
    }
  }

  // Nombre: tercera línea MRZ "APELLIDOS<<NOMBRES"
  let completoNombre = '';
  const nombreLinea = indice + 2 < lineas.length ? lineas[indice + 2] : '';
  if (nombreLinea) {
    const nombrePart = nombreLinea.replace(/^<+/, '').replace(/<+$/, '');
    const partes = nombrePart.split('<<');
    const apellido = (partes[0] || '').
    replace(/</g, ' ').
    replace(/\s+/g, ' ').
    trim();
    const given = (partes[1] || '').
    replace(/</g, ' ').
    replace(/\s+/g, ' ').
    trim();
    // El OCR puede introducir números o símbolos en la línea de nombres.
    completoNombre = [apellido, given].filter(Boolean).join(' ').
    replace(/[^A-ZÁÉÍÓÚÜÑ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return { ciNumber: ciNumero, fullName: completoNombre, birthDate: nacimientoFecha, mrz: true };
}

// ─── Fallback de nombre por líneas ───────────────────────────────────────────
const ALTERNATIVA_NOMBRE_PREFIJO = /^(REPUBLICA|ESTADO|BOLIVIA|CEDULA|IDENTIDAD|IDENTIFICACION|SERVICIO|GENERAL|PERSONAL|SEXO|FECHA|LUGAR|NACIMIENTO|NACIDO|DOMICILIO|PROFESION|OCUPACION|CIVIL|NOMBRES|NOMBRE|APELLIDOS|APELLIDO|FIRMA|NACIONALIDAD|CORREO|LIBRO|NO|NRO|NUMERO|N|EMISION|EXPIRACION|VENCIMIENTO|GRUPO|SANGUINEO|RENOVACION|DIRECCION|CATEGORIA|CLASE|MARCA|MODELO|COLOR|PLACA|POLIZA|SOAT|TIPO|VIGENCIA|VENCE|HASTA|VALIDA|ANTECEDENTES|VEHICULO|CONDUCIR|LICENCIA|CONDUCCION|SEGURO|OBLIGATORIO|ACCIDENTES|TRANSITO|REGISTRO|AUTOMOTOR)\b/;

/**
 * Línea alfabética con 2-5 palabras plausibles (todas con vocal).
 * Nunca se usa para la trasera: ahí el nombre sale solo del MRZ.
 */
function alternativaNombreDesdeLineas(lineas) {
  for (const linea of lineas || []) {
    if (!linea || ALTERNATIVA_NOMBRE_PREFIJO.test(linea)) continue;
    const limpio = linea.replace(/[,.;:]$/, '').trim();
    if (!/^[A-Z][A-Z \u00C0-\u017F]*$/.test(limpio)) continue;
    const palabras = limpio.split(' ').filter((w) => w.length >= 3);
    if (palabras.length >= 2 && palabras.length <= 5) {
      if (palabras.every((w) => /[AEIOU]/.test(w))) return limpio;
    }
  }
  return '';
}

// ─── Parser ESPACIAL ─────────────────────────────────────────────────────────
// Agrupa palabras por filas físicas y extrae etiqueta → valor a la DERECHA
// (misma fila) o bloque alineado DEBAJO. Nunca "cualquier línea siguiente".

const CI_FRONTAL_CAMPO_DEFINICIONES = [
{ key: 'apellidos', labels: ['APELLIDOS', 'APELLIDO'], type: 'name', extract: true },
{ key: 'nombres', labels: ['NOMBRES', 'NOMBRE'], type: 'name', extract: true },
{
  key: 'birthDate',
  labels: ['FECHA DE NACIMIENTO', 'FECHA NACIMIENTO', 'NACIMIENTO', 'NACIDO'],
  type: 'date',
  extract: true
},
{ key: 'ciNumber', labels: ['NUMERO', 'NO', 'NRO', 'N', 'CI'], type: 'number', extract: true },
{ key: 'issueDate', labels: ['FECHA DE EMISION', 'FECHA EMISION', 'EMISION'], type: 'date', extract: true },
{ key: 'expiryDate', labels: ['FECHA DE EXPIRACION', 'FECHA EXPIRACION', 'EXPIRACION', 'FECHA DE EXPIRACY', 'EXPIRACY', 'VENCIMIENTO'], type: 'date', extract: true },
{ key: '_sexo', labels: ['SEXO'], type: 'text', extract: false }];


function mediana(arr) {
  const s = [...arr].sort((primero, segundo) => primero - segundo);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Agrupa palabras en filas físicas (solape vertical por centro Y). */
function construirFilas(palabras) {
  const limpio = [];
  for (const w of Array.isArray(palabras) ? palabras : []) {
    const texto = normalizar(w.text);
    if (!texto) continue;
    limpio.push({
      text: texto,
      clean: texto.replace(/[^A-Z0-9]/g, ''),
      x: w.x || 0,
      y: w.y || 0,
      w: w.w || 0,
      h: w.h || 0,
      confidence: w.confidence
    });
  }
  const sorted = [...limpio].sort(
    (primero, segundo) => primero.y + primero.h / 2 - (segundo.y + segundo.h / 2)
  );
  const filas = [];
  for (const w of sorted) {
    const cy = w.y + w.h / 2;
    let fila = null;
    for (const r of filas) {
      const tol = 0.6 * Math.min(w.h, mediana(r.hs), 4) + 4;
      if (Math.abs(r.cy - cy) <= tol) {
        fila = r;
        break;
      }
    }
    if (!fila) {
      filas.push({ cy, hs: [w.h], words: [w] });
    } else {
      fila.words.push(w);
      fila.hs.push(w.h);
      fila.cy = fila.cy + (cy - fila.cy) / fila.words.length;
    }
  }
  for (const r of filas) {
    r.words.sort((primero, segundo) => primero.x - segundo.x);
    r.text = r.words.map((w) => w.text).join(' ');
    r.h = mediana(r.hs);
    r.x0 = Math.min(...r.words.map((w) => w.x));
    r.x1 = Math.max(...r.words.map((w) => w.x + w.w));
    r.y0 = Math.min(...r.words.map((w) => w.y));
    r.y1 = Math.max(...r.words.map((w) => w.y + w.h));
  }
  filas.sort((primero, segundo) => primero.y0 - segundo.y0);
  return filas;
}

function ciPalabraDireccion(palabra) {
  const vertices = palabra.vertices;
  if (!Array.isArray(vertices) || vertices.length < 4) return null;
  const dx = vertices[1].x - vertices[0].x;
  const dy = vertices[1].y - vertices[0].y;
  if (Math.hypot(dx, dy) < 3) return null;
  return Math.abs(dx) >= Math.abs(dy) ?
  dx >= 0 ? 0 : 2 :
  dy >= 0 ? 1 : 3;
}

function dominantCiTextoDireccion(palabras) {
  const directions = [0, 0, 0, 0];
  for (const palabra of palabras) {
    const palabraDireccion = ciPalabraDireccion(palabra);
    if (palabraDireccion !== null) directions[palabraDireccion]++;
  }
  const cantidad = directions.reduce((primero, segundo) => primero + segundo, 0);
  const direccion = directions.indexOf(Math.max(...directions));
  return cantidad && directions[direccion] >= cantidad * 0.6 ? direccion : null;
}

// Vision conserva las coordenadas de la foto original aunque lea el texto
// girado. Endereza únicamente la geometría (no altera la imagen ni el OCR).
function uprightCiPalabras(palabras) {
  const direccion = dominantCiTextoDireccion(palabras);
  if (direccion === null) return palabras;
  // Los bordes de la CI anterior incluyen texto a 90° del cuerpo. Nunca
  // debe participar en nombre, fecha ni lugar de nacimiento.
  const readablePalabras = palabras.filter((palabra) => {
    const palabraDireccion = ciPalabraDireccion(palabra);
    return palabraDireccion === null || palabraDireccion === direccion;
  });
  if (direccion === 0) return readablePalabras;
  const girar = ({ x, y }) => {
    if (direccion === 1) return { x: y, y: -x };
    if (direccion === 2) return { x: -x, y: -y };
    return { x: -y, y: x };
  };
  return readablePalabras.map((palabra) => {
    const puntos = Array.isArray(palabra.vertices) && palabra.vertices.length >= 4 ?
    palabra.vertices :
    [
    { x: palabra.x, y: palabra.y },
    { x: palabra.x + palabra.w, y: palabra.y },
    { x: palabra.x + palabra.w, y: palabra.y + palabra.h },
    { x: palabra.x, y: palabra.y + palabra.h }];

    const transformado = puntos.map(girar);
    const xs = transformado.map((punto) => punto.x);
    const ys = transformado.map((punto) => punto.y);
    return {
      ...palabra,
      x: Math.min(...xs), y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys)
    };
  });
}

function primerPlanoAntiguoCiPalabras(palabras) {
  // Quitar primero las palabras de la microimpresión (también fragmentos
  // fusionados). La búsqueda espacial de etiquetas trabaja solo con esto.
  const candidatos = palabras.filter((palabra, indice) => {
    if (esAntiguoCiFondoToken(palabra.text)) return false;
    const token = normalizar(palabra.text).replace(/[^A-Z]/g, '');
    // «Estado» se conserva: puede ser la etiqueta real «Estado Civil».
    // «de» solo se elimina si está entre dos fragmentos del fondo.
    return !(token === 'DE' &&
    esAntiguoCiFondoToken(palabras[indice - 1]?.text) &&
    esAntiguoCiFondoToken(palabras[indice + 1]?.text));
  });
  // Anclar el tamaño al texto de los campos, no a la distribución global:
  // la microimpresión de fondo puede contener más palabras que los datos.
  const campoEtiquetas = /^(?:NACIDO|NACIDA|CIVIL|DOMICILIO|PROFESION|OCUPACION)$/;
  const etiquetaHeights = candidatos.
  filter((palabra) => campoEtiquetas.test(normalizar(palabra.text).replace(/[^A-Z]/g, ''))).
  map((palabra) => Number(palabra.h)).
  filter((alto) => Number.isFinite(alto) && alto > 0);
  if (etiquetaHeights.length >= 2) {
    const etiquetaAlto = mediana(etiquetaHeights);
    return candidatos.filter((palabra) => {
      if (!palabra.h || palabra.h >= etiquetaAlto * 0.68) return true;
      // «En» es una etiqueta corta y a veces más pequeña que los valores.
      return normalizar(palabra.text).replace(/[^A-Z]/g, '') === 'EN';
    });
  }
  const heights = candidatos.
  map((palabra) => Number(palabra.h)).
  filter((alto) => Number.isFinite(alto) && alto > 0).
  sort((primero, segundo) => primero - segundo);
  if (heights.length < 12) return candidatos;
  const low = heights[Math.floor((heights.length - 1) * 0.3)];
  const high = heights[Math.floor((heights.length - 1) * 0.9)];
  if (high < low * 1.5) return candidatos;
  // El papel anterior repite una microimpresión horizontal. Su altura es
  // sensiblemente menor que la del nombre, fecha y lugar impresos encima.
  const minimoPrimerPlanoAlto = Math.max(low * 1.25, high * 0.55);
  return candidatos.filter((palabra) => palabra.h >= minimoPrimerPlanoAlto);
}

/** ¿La palabra i de la fila inicia alguna etiqueta? */
function startsCualquieraEtiqueta(fila, indice, definiciones) {
  for (const def of definiciones) {
    for (const etiqueta of def.labels) {
      const lw = etiqueta.split(' ');
      if (indice + lw.length > fila.words.length) continue;
      if (lw.every((l, k) => fila.words[indice + k].clean === l)) return true;
    }
  }
  return false;
}

/**
 * Encuentra las etiquetas presentes en una fila (deduplicadas por campo,
 * conservando la coincidencia más larga).
 */
function buscarEtiquetaOccurrences(fila, definiciones) {
  const encontrado = [];
  for (const def of definiciones) {
    for (const etiqueta of def.labels) {
      const lw = etiqueta.split(' ');
      for (let indice = 0; indice + lw.length <= fila.words.length; indice++) {
        if (lw.every((l, k) => fila.words[indice + k].clean === l)) {
          encontrado.push({ def, label: etiqueta, start: indice, end: indice + lw.length - 1 });
        }
      }
    }
  }
  const porClave = {};
  for (const o of encontrado) {
    const anterior = porClave[o.def.key];
    if (!anterior || o.end - o.start > anterior.end - anterior.start) {
      porClave[o.def.key] = o;
    }
  }
  return Object.values(porClave).sort((primero, segundo) => primero.start - segundo.start);
}

/** Palabras a la derecha de la etiqueta en la misma fila. */
function valorDerechaDe(fila, occ, definiciones) {
  const vals = [];
  const separacionMaximo = 3 * Math.max(fila.h, 4);
  let anterior = fila.words[occ.end];
  for (let indice = occ.end + 1; indice < fila.words.length; indice++) {
    const w = fila.words[indice];
    if (!w.clean) continue;
    if (startsCualquieraEtiqueta(fila, indice, definiciones)) break;
    if (w.x - (anterior.x + anterior.w) > separacionMaximo) break;
    vals.push(w);
    anterior = w;
  }
  return vals;
}

/** Bloque de valor alineado DEBAJO de la etiqueta. */
function valorDebajo(filas, filaIndice, occ, definiciones, etiquetaFilaOccs) {
  const etiquetaFila = filas[filaIndice];
  const separacionMaximo = 3 * Math.max(etiquetaFila.h, 6);
  for (let indiceSecundario = filaIndice + 1; indiceSecundario < filas.length; indiceSecundario++) {
    const r = filas[indiceSecundario];
    if (r.y0 - etiquetaFila.y1 > separacionMaximo) return [];
    if (buscarEtiquetaOccurrences(r, definiciones).length) return [];
    if (etiquetaFilaOccs.length > 1) {
      const k = etiquetaFilaOccs.findIndex((o) => o === occ);
      if (k >= 0 && etiquetaFilaOccs.length === r.words.length) {
        return [r.words[k]];
      }
      const lw = etiquetaFila.words[occ.start];
      const le = etiquetaFila.words[occ.end];
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
function validarEspacialValor(palabras, tipo) {
  const joined = palabras.map((w) => w.text).join(' ').trim();
  if (!joined) return '';
  if (tipo === 'number') {
    const digitos = joined.replace(/[^0-9]/g, '');
    return /^\d{6,9}$/.test(digitos) ? digitos : '';
  }
  if (tipo === 'date') {
    const fechas = buscarFechas(joined);
    return fechas.length === 1 ? fechas[0] : '';
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
function extraerEspacialCampos(filas, definiciones) {
  const fuera = {};
  for (let indice = 0; indice < filas.length; indice++) {
    const occs = buscarEtiquetaOccurrences(filas[indice], definiciones);
    for (const occ of occs) {
      if (!occ.def.extract) continue;
      if (fuera[occ.def.key]) continue;
      let palabras = valorDerechaDe(filas[indice], occ, definiciones);
      if (!palabras.length) palabras = valorDebajo(filas, indice, occ, definiciones, occs);
      const val = validarEspacialValor(palabras, occ.def.type);
      if (val) fuera[occ.def.key] = val;
    }
  }
  return fuera;
}

/**
 * Extrae los campos del CI usando solo el texto por líneas
 * (heurísticas clásicas). Se usa cuando no hay geometría o como
 * respaldo de campos que el parser espacial no pudo resolver.
 */
function analizarCiCamposDesdeLineas(texto, mrz) {
  const resultado = { fullName: '', firstNames: '', paternalSurname: '', maternalSurname: '', ciNumber: '', birthDate: '' };

  // Número de CI: preferir los precedidos por N°/No./Nro.
  const rePrefixed = /N\s?(?:[o°º]|RO)\.?\s*:?\s*(\d{6,9})/i;
  let m = rePrefixed.exec(texto);
  if (m) {
    resultado.ciNumber = m[1];
  } else if (!mrz) {
    // "No."/"Nro"/"Numero" seguido de dígitos (con posibles separadores)
    let viaPalabraClave = '';
    for (const linea of normalizarLineas(texto)) {
      for (const palabraClave of ['NO', 'NRO', 'NUMERO']) {
        const indice = linea.indexOf(palabraClave);
        if (indice === -1) continue;
        const val = linea.
        slice(indice + palabraClave.length).
        replace(/^[\s:.\-–|»]+/, '').
        trim();
        const digitos = val.replace(/[^0-9]/g, '');
        if (/^\d{6,9}$/.test(digitos)) {
          viaPalabraClave = digitos;
          break;
        }
      }
      if (viaPalabraClave) break;
    }
    if (viaPalabraClave) {
      resultado.ciNumber = viaPalabraClave;
    } else {
      // Cualquier corrida de 6-8 dígitos que no forme parte de una fecha
      const fechas = buscarFechas(texto);
      const fechaDigitos = new Set(
        fechas.
        map((d) => d.replace(/\D/g, '')).
        flatMap((d) => [d, d.slice(0, 6), d.slice(2), d.slice(0, 4)])
      );
      const reDigitos = /\b(\d{6,8})\b/g;
      let dm;
      while (dm = reDigitos.exec(texto)) {
        if (!fechaDigitos.has(dm[1])) {
          resultado.ciNumber = dm[1];
          break;
        }
      }
    }
  }

  // Fecha de nacimiento (solo junto a NACIMIENTO, no EMISIÓN/EXPIRACIÓN)
  resultado.birthDate = fechaCercanoKeyword(texto, ['NACIMIENTO', 'NACIDO']);

  // Nombre: etiquetas NOMBRES / APELLIDOS del nuevo formato
  const nombres = etiquetadoValor(texto, ['NOMBRES', 'NOMBRE']);
  const apellidos = etiquetadoValor(texto, ['APELLIDOS', 'APELLIDO']);
  if (nombres || apellidos) {
    resultado.fullName = [nombres, apellidos].filter(Boolean).join(' ').trim();
    resultado.firstNames = nombres;
    resultado.surnames = apellidos;
    const apellidoPartes = apellidos.split(/\s+/).filter(Boolean);
    resultado.paternalSurname = apellidoPartes[0] || '';
    resultado.maternalSurname = apellidoPartes.slice(1).join(' ');
  }
  if (!resultado.fullName) {
    resultado.fullName = alternativaNombreDesdeLineas(normalizarLineas(texto));
  }

  return resultado;
}

/**
 * Conserva valores de CI que pueden tener más de cuatro palabras o números
 * (por ejemplo, lugar de nacimiento compuesto y domicilio). `labeledValue`
 * es deliberadamente más estricto porque se usa para nombres.
 */
function ciDetalleValor(texto, palabrasClave, permitirNumbers = false) {
  const bruto = valorDespuesKeyword(texto, palabrasClave);
  if (!bruto) return '';

  const limpio = bruto.
  replace(permitirNumbers ? /[^A-Z0-9ÁÉÍÓÚÜÑ .#\-]/g : /[^A-ZÁÉÍÓÚÜÑ ]/g, ' ').
  replace(/\s+/g, ' ').
  trim();
  if (!limpio || ETIQUETA_PALABRA_RE.test(limpio)) return '';

  // Evita que una lectura defectuosa ocupe todo el documento como valor.
  return limpio.split(' ').slice(0, 8).join(' ');
}

/** Extrae los datos complementarios impresos en ambos lados de la cédula. */
function analizarCiAdditionalCampos(texto) {
  const sangreBruto = valorDespuesKeyword(texto, [
  'GRUPO SANGUINEO',
  'GRUPO SANG',
  'TIPO DE SANGRE',
  'GRUPO']
  );
  const sangreCoincidencia = sangreBruto.match(
    /\b(AB|A|B|O)\s*(?:RH\s*)?([+-]|POSITIVO|NEGATIVO)(?![A-Z])/i
  );
  const sangreSigno = sangreCoincidencia ?
  /^(POSITIVO|\+)$/i.test(sangreCoincidencia[2]) ?
  '+' :
  '-' :
  '';

  return {
    issueDate: fechaCercanoKeyword(texto, ['FECHA DE EMISION', 'FECHA EMISION', 'EMISION', 'EMITIDA EL', 'EMITIDO EL']),
    expiryDate: fechaCercanoKeyword(texto, [
    'FECHA DE EXPIRACION',
    'FECHA EXPIRACION',
    'EXPIRACION',
    'FECHA DE EXPIRACY',
    'EXPIRACY',
    'VENCIMIENTO',
    'EXPIRA EL']
    ),
    birthPlace: ciDetalleValor(texto, [
    'LUGAR DE NACIMIENTO',
    'LUGAR NACIMIENTO',
    'LUGAR DE NAC',
    'LUGAR NAC',
    'NACIO EN',
    'NACIDO EN',
    'NACIDA EN']
    ),
    address: ciDetalleValor(texto, ['DOMICILIO', 'DOMIC', 'DOM', 'DIRECCION'], true),
    occupation: etiquetadoValor(texto, ['PROFESION/OCUPACION', 'PROFESION / OCUPACION', 'PROFESION', 'OCUPACION']),
    maritalStatus: etiquetadoValor(texto, ['ESTADO CIVIL', 'ESTADO CIVAL']),
    bloodType: sangreCoincidencia ? `${sangreCoincidencia[1].toUpperCase()}${sangreSigno}` : ''
  };
}

// En el reverso actual, lugar de nacimiento y domicilio pueden ocupar dos
// renglones. valueAfterKeyword solo devuelve uno y ciDetailValue lo recorta
// a ocho palabras; aquí se reúnen únicamente las líneas previas a otra
// etiqueta (o a la MRZ), sin tocar el lector del CI anterior.
const ACTUAL_CI_REVERSO_SIGUIENTE_CAMPO = /^(?:LUGAR\s+DE\s+NACIMIENTO|DOMICILIO|DIRECCION|PADRE|MADRE|NACIONALIDAD|ESTADO\s+CIVIL|PROFESION|OCUPACION|GRUPO\s+SANGUINEO|FECHA|SEXO|FIRMA|DOCUMENTOS\s+REGISTRADOS|I[<\s]?BOL)\b|<{3,}/;

function realCiReversoMultilineValor(texto, etiqueta, permitirNumbers = false) {
  const lineas = normalizarLineas(texto);
  for (let indice = 0; indice < lineas.length; indice++) {
    const coincidencia = etiqueta.exec(lineas[indice]);
    if (!coincidencia) continue;
    const partes = [];
    const enLinea = lineas[indice].slice(coincidencia.index + coincidencia[0].length).replace(/^[\s:.\-]+/, '').trim();
    if (enLinea && !ACTUAL_CI_REVERSO_SIGUIENTE_CAMPO.test(enLinea)) partes.push(enLinea);
    for (let indiceSecundario = indice + 1; indiceSecundario < lineas.length && partes.length < 2; indiceSecundario++) {
      const siguiente = lineas[indiceSecundario];
      if (ACTUAL_CI_REVERSO_SIGUIENTE_CAMPO.test(siguiente)) break;
      partes.push(siguiente);
    }
    const valor = partes.join(' ').
    replace(permitirNumbers ? /[^A-Z0-9 .#º°\-]/g : /[^A-Z ]/g, ' ').
    replace(/\s+/g, ' ').trim();
    if (valor && valor.length <= 140 && valor.split(' ').length <= 20) return valor;
  }
  return '';
}

// En la CI anterior los nombres y el nacimiento figuran en el reverso,
// antes de "Nacido el". No se infiere un nombre desde texto libre lejano.
function esAntiguoFrontal(texto) {
  const normalizado = normalizar(texto);
  return normalizado.includes('CEDULA DE IDENTIDAD') &&
  /\bEMITID[AO] EL\b/.test(normalizado) && /\bEXPIRA EL\b/.test(normalizado);
}

// La microimpresión del CI anterior puede llegar como palabras enormes,
// incluso pegada al nombre o a «LA PAZ». Las coordenadas eliminan lo pequeño,
// pero no bastan cuando Vision fusiona fondo y texto principal en una palabra.
function esAntiguoCiFondoToken(token) {
  const letras = normalizar(token).replace(/[^A-Z]/g, '');
  return letras.length >= 7 && (
  /^ALDEBOL[A-Z]*$/.test(letras) ||
  /(?:PLURINAC|RINACIONAL|NACIONALDEBOL|DEBOLIVIA|BOLIVIA|ESTADOP|STADOPLUR)/.test(letras));
}

function limpiarAntiguoCiFondo(texto) {
  return String(texto || '').split(/\r?\n/).map((linea) => {
    const tokens = normalizar(linea).split(' ').filter(Boolean);
    const kept = [];
    for (let indice = 0; indice < tokens.length; indice++) {
      const token = tokens[indice];
      if (esAntiguoCiFondoToken(token)) {
        // En algunos OCR «LA» queda unido al final de la marca de agua.
        if (token.endsWith('LA') && tokens[indice + 1] === 'PAZ') kept.push('LA');
        continue;
      }
      if (token === 'DE' && (esAntiguoCiFondoToken(tokens[indice - 1] || '') ||
      esAntiguoCiFondoToken(tokens[indice + 1] || ''))) continue;
      kept.push(token);
    }
    return kept.join(' ');
  }).filter(Boolean).join('\n');
}

function limpiarAntiguoCiDireccion(direccion) {
  // Un fragmento corto de la microimpresión puede quedar delante de la
  // abreviatura «C» (calle) o después de «EL ALTO». No tocar texto interior.
  const limpio = String(direccion || '').
  replace(/^BOLC\s+(?=C(?:\.|\s)|CALLE\b)/i, '').
  replace(/(\bEL\s+ALTO)\s+BA$/i, '$1').
  trim();
  if (/\b(?:SERVICIO GENERAL DE IDENTIFICACION PERSONAL|ESTADO PLURINACIONAL DE BOLIVIA|DOCUMENTOS REGISTRADOS|FIRMA DEL INTERESADO|DIRECTOR[AO]? GENERAL EJECUTIV[AO])\b/.test(normalizar(limpio))) return '';
  // El OCR puede asociar una palabra suelta del encabezado con domicilio.
  if (ETIQUETA_PALABRA_RE.test(normalizar(limpio))) return '';
  return limpio;
}

function antiguoCiDireccionDesdeTexto(texto) {
  const lineas = normalizarLineas(limpiarAntiguoCiFondo(texto));
  for (let indice = 0; indice < lineas.length; indice++) {
    const coincidencia = /(?:^|\s)DOMICILIO\s*[:.]?\s*(.*)$/.exec(lineas[indice]);
    if (!coincidencia) continue;
    const bruto = (coincidencia[1] || lineas[indice + 1] || '').
    split(/\b(?:DOCUMENTOS REGISTRADOS|FIRMA DEL INTERESADO)\b/)[0];
    const valor = limpiarAntiguoCiDireccion(bruto.
    replace(/[^A-Z0-9\u00C0-\u017F .#-]/g, ' ').
    replace(/\s+/g, ' ').
    trim());
    if (valor && valor.length <= 140 && valor.split(' ').length <= 20) return valor;
  }
  return '';
}

function mostCompletarAntiguoCiDireccion(candidatos) {
  let direccion = '';
  let unconfirmedSufijo = '';
  const canonical = (valor) => normalizar(valor).replace(/[^A-Z0-9]/g, '');
  for (const candidato of candidatos) {
    const limpio = limpiarAntiguoCiDireccion(candidato);
    if (!limpio) continue;
    // Una asociación espacial errónea puede tomar el cargo de la firmante
    // como si fuera el valor de «Domicilio».
    if (/^DIRECTOR[AO]? GENERAL EJECUTIV[AO]\b/.test(normalizar(limpio))) continue;
    if (!direccion) {
      direccion = limpio;
      continue;
    }
    const real = canonical(direccion);
    const siguiente = canonical(limpio);
    // Vision puede pegar al final un número aislado de la zona de firma o
    // registro. Si el OCR etiquetado ya contiene un número de domicilio y
    // confirma todo lo anterior, no incorporar ese sufijo sin respaldo.
    const final = real.startsWith(siguiente) ? real.slice(siguiente.length) : '';
    const ultimoToken = normalizar(direccion).split(/\s+/).at(-1)?.replace(/[^0-9]/g, '') || '';
    if (/^\d{1,2}$/.test(final) && final === ultimoToken &&
    /(?:\bN\s*\d{1,6}\b|#\s*\d{1,6}\b)/.test(normalizar(limpio))) {
      direccion = limpio;
      unconfirmedSufijo = final;
      continue;
    }
    if (real && siguiente.length > real.length && siguiente.startsWith(real) &&
    siguiente.slice(real.length) !== unconfirmedSufijo) {
      direccion = limpio;
    }
  }
  return direccion;
}

function limpiarAntiguoCiCivilEstado(valor) {
  const estado = normalizar(valor);
  // La microimpresión puede añadir una letra suelta tras el estado civil.
  const coincidencia = /^(SOLTER[AO]|CASAD[AO]|DIVORCIAD[AO]|VIUD[AO])\s+[A-Z]$/.exec(estado);
  return coincidencia ? coincidencia[1] : estado;
}

function antiguoNombreAntesNacimiento(texto) {
  const lineas = normalizarLineas(limpiarAntiguoCiFondo(texto));
  const nacimientoIndice = lineas.findIndex((linea) => /\bNACID[AO] EL\b/.test(linea));
  const nombreDesde = (bruto) => String(bruto || '').
  split(/\bNACID[AO] EL\b/)[0].
  replace(/^(?:SR|SRA)\.?\s+/, '').
  replace(/^[\s:.,;\-]+|[\s:.,;\-]+$/g, '').
  replace(/\s+/g, ' ').trim();
  const validoNombre = (candidato) => {
    if (/\d/.test(candidato)) return false;
    const partes = candidato.split(' ').filter(Boolean);
    return partes.length >= 3 && partes.length <= 5 &&
    partes.every((part) => /^[A-ZÁÉÍÓÚÜÑ]{2,}$/.test(part) &&
    !esAntiguoCiFondoToken(part) &&
    !/^(?:CERTIFICA|FIRMA|FOTOGRAFIA|IDENTIFICACION|DOCUMENTOS|REGISTRADOS|CEDULA|IDENTIDAD|NUMERO|PERTENECE|PERTENECEN|SERVICIO|GENERAL|PERSONAL|NACIDO|NACIDA|ESTADO|CIVIL)$/.test(part));
  };
  // "A:" puede cerrar la frase "... pertenecen a:" en la línea anterior.
  // Vision también puede dividir el nombre en dos líneas.
  for (let indice = Math.max(0, nacimientoIndice - 6); indice <= (nacimientoIndice < 0 ? lineas.length - 1 : nacimientoIndice); indice++) {
    const etiquetado = /(?:^|\s)A\s*[:.]\s*(.*)$/.exec(lineas[indice]);
    if (!etiquetado) continue;
    const primero = etiquetado[1] || lineas[indice + 1] || '';
    for (const candidato of [`${primero} ${lineas[indice + (etiquetado[1] ? 1 : 2)] || ''}`, primero]) {
      const nombre = nombreDesde(candidato);
      if (validoNombre(nombre)) return nombre;
    }
  }
  if (nacimientoIndice < 0) return '';
  // Respaldo cuando Vision omite "A:"; usar solo líneas inmediatas al nacimiento.
  const antesNacimiento = nombreDesde(lineas[nacimientoIndice]);
  for (let indice = nacimientoIndice; indice >= Math.max(0, nacimientoIndice - 12); indice--) {
    const primero = indice === nacimientoIndice ? antesNacimiento : lineas[indice];
    for (const candidato of [
    indice < nacimientoIndice ? `${primero} ${indice + 1 === nacimientoIndice ? antesNacimiento : lineas[indice + 1]}` : '',
    primero])
    {
      const nombre = nombreDesde(candidato);
      if (validoNombre(nombre)) return nombre;
    }
  }
  return '';
}

function antiguoNacimientoLugarDespuesEn(texto) {
  const lineas = normalizarLineas(texto);
  const nacimientoIndice = lineas.findIndex((linea) => /\bNACID[AO] EL\b/.test(linea));
  for (let indice = Math.max(0, nacimientoIndice); indice < lineas.length; indice++) {
    const linea = lineas[indice];
    if (/\b(?:ESTADO CIVIL|PROFESION|OCUPACION|DOMICILIO)\b/.test(linea)) break;
    const coincidencia = nacimientoIndice >= 0 && indice === nacimientoIndice ?
    /\bNACID[AO] EL\b.*?\bEN\b\s*[:.\-]?\s*(.*)$/.exec(linea) :
    /^EN\s*[:.\-]?\s*(.*)$/.exec(linea);
    if (!coincidencia) continue;
    const enLinea = limpiarAntiguoNacimientoLugar(coincidencia[1] || '');
    if (enLinea) return enLinea;
    // Vision puede dejar «En» sola y ubicar el valor lejano a la derecha
    // varias líneas después en el orden de lectura. Saltar microimpresión.
    let bestLugar = '';
    let bestPuntuacion = 0;
    for (let indiceSecundario = indice + 1; indiceSecundario < lineas.length; indiceSecundario++) {
      if (/\b(?:ESTADO CIVIL|PROFESION|OCUPACION|DOMICILIO)\b/.test(lineas[indiceSecundario])) break;
      const lugar = limpiarAntiguoNacimientoLugar(lineas[indiceSecundario]);
      const tokens = lugar.split(' ').filter(Boolean);
      if (tokens.length < (indiceSecundario === indice + 1 ? 2 : 3)) continue;
      const puntuacion = tokens.length + (lineas[indiceSecundario].includes('-') ? 2 : 0);
      if (puntuacion > bestPuntuacion) {bestLugar = lugar;bestPuntuacion = puntuacion;}
    }
    if (bestLugar) return bestLugar;
  }
  return '';
}

// El OCR a veces omite la pequeña etiqueta «En», pero conserva la línea
// departamento - provincia - localidad entre nacimiento y estado civil.
// Solo se acepta si hay una única línea con esa estructura en esa franja.
function antiguoNacimientoLugarSinEn(texto) {
  const lineas = normalizarLineas(limpiarAntiguoCiFondo(texto));
  const nacimientoIndice = lineas.findIndex((linea) => /\bNACID[AO] EL\b/.test(linea));
  const civilIndice = lineas.findIndex((linea, indice) =>
  indice > nacimientoIndice && /\bESTADO CIVIL\b/.test(linea));
  if (nacimientoIndice < 0 || civilIndice < 0) return '';
  const candidatos = lineas.slice(nacimientoIndice + 1, civilIndice).
  filter((linea) => (linea.match(/-/g) || []).length >= 2 && !/\d/.test(linea)).
  map(limpiarAntiguoNacimientoLugar).
  filter((lugar) => /^(?:LA PAZ|SANTA CRUZ|COCHABAMBA|POTOSI|CHUQUISACA|TARIJA|ORURO|BENI|PANDO)\b/.test(lugar));
  const unico = [...new Set(candidatos)];
  return unico.length === 1 ? unico[0] : '';
}

// El frente anterior solo imprime emisión y vencimiento. Si Vision separó
// las etiquetas de las fechas, usar las dos fechas completas y distintas,
// siempre que no contradigan una fecha ya asociada a su etiqueta.
function completarAntiguoFrontalFechas(resultado, texto) {
  if (resultado.issueDate && resultado.expiryDate) return;
  const fechas = [...new Set(buscarFechas(texto))];
  if (fechas.length !== 2) return;
  fechas.sort((primero, segundo) => require("./identidadValidacion").isoFecha(primero).
  localeCompare(require("./identidadValidacion").isoFecha(segundo)));
  const [emisionFecha, vencimientoFecha] = fechas;
  if (resultado.issueDate && resultado.issueDate !== emisionFecha) return;
  if (resultado.expiryDate && resultado.expiryDate !== vencimientoFecha) return;
  resultado.issueDate = emisionFecha;
  resultado.expiryDate = vencimientoFecha;
}

const ANTIGUO_CI_FRONTAL_DEFINICIONES = [
{ key: 'ciNumber', labels: ['NO', 'NRO', 'NUMERO'] },
{ key: 'issueDate', labels: ['EMITIDA EL', 'EMITIDO EL'] },
{ key: 'expiryDate', labels: ['EXPIRA EL', 'EXPIRA'] },
{ key: '_series', labels: ['SERIE', 'SECCION'] }];

const ANTIGUO_CI_REVERSO_DEFINICIONES = [
{ key: 'fullName', labels: ['A'] },
{ key: 'birthDate', labels: ['NACIDO EL', 'NACIDA EL'] },
{ key: 'birthPlace', labels: ['EN'] },
{ key: 'maritalStatus', labels: ['ESTADO CIVIL'] },
{ key: 'occupation', labels: ['PROFESION OCUPACION', 'PROFESIONOCUPACION', 'PROFESION', 'OCUPACION'] },
{ key: 'address', labels: ['DOMICILIO'] },
{ key: 'ciNumber', labels: ['NO', 'NRO', 'NUMERO'] },
{ key: '_footer', labels: ['DOCUMENTOS REGISTRADOS', 'FIRMA DEL INTERESADO'] }];


function antiguoCiValorEn(filas, indice, aparicion, definiciones, maximoContinuation = 1) {
  const fila = filas[indice];
  const etiquetas = buscarEtiquetaOccurrences(fila, definiciones);
  const siguienteEtiqueta = etiquetas.find((etiqueta) => etiqueta.start > aparicion.end);
  const palabras = fila.words.slice(aparicion.end + 1,
  siguienteEtiqueta ? siguienteEtiqueta.start : undefined);
  for (let desplazamiento = 1; desplazamiento <= maximoContinuation; desplazamiento++) {
    const debajo = filas[indice + desplazamiento];
    if (!debajo || debajo.y0 - filas[indice + desplazamiento - 1].y1 > 2.5 * fila.h) break;
    if (buscarEtiquetaOccurrences(debajo, definiciones).length) break;
    // Solo continúa dentro de la columna del valor, sin recoger otra zona.
    const izquierda = palabras.length ? palabras[0].x - 2 * fila.h : fila.words[aparicion.start].x - fila.h;
    const continuation = debajo.words.filter((palabra) => palabra.x >= izquierda);
    if (!continuation.length) break;
    palabras.push(...continuation);
  }
  return palabras.map((palabra) => palabra.text).join(' ').trim();
}

function validoAntiguoCiNombre(bruto) {
  const nombre = normalizar(bruto).replace(/^[\s:.,;\-]+|[\s:.,;\-]+$/g, '');
  const partes = nombre.split(/\s+/).filter(Boolean);
  return partes.length >= 3 && partes.length <= 5 &&
  partes.every((part) => /^[A-ZÑ]{2,}$/.test(part) &&
  !esAntiguoCiFondoToken(part) &&
  !/^(?:CERTIFICA|FIRMA|FOTOGRAFIA|IDENTIFICACION|DOCUMENTOS|REGISTRADOS|CEDULA|IDENTIDAD|NUMERO|PERTENECE|PERTENECEN|SERVICIO|GENERAL|PERSONAL|NACIDO|NACIDA|ESTADO|CIVIL|DOMICILIO|PROFESION|OCUPACION)$/.test(part)) ?
  nombre : '';
}

function mostCompletarAntiguoCiNombre(candidatos) {
  let nombre = '';
  for (const candidato of candidatos) {
    if (!candidato) continue;
    // Mantener la lectura espacial salvo que otra fuente la extienda con
    // palabras adicionales idénticas en el mismo orden.
    if (!nombre || candidato.startsWith(`${nombre} `)) nombre = candidato;
  }
  return nombre;
}

function limpiarAntiguoNacimientoLugar(bruto) {
  if (String(bruto || '').split(/\s+/).some(esAntiguoCiFondoToken)) return '';
  const valor = normalizar(bruto).
  replace(/[^A-ZÑ -]/g, ' ').
  replace(/\s*-\s*/g, ' ').
  replace(/\s+/g, ' ').
  replace(/^DE\s+(?=(?:LA|EL)\b)/, '').
  trim();
  const tokens = valor.split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.length <= 8 &&
  !/^(?:EL|LA|DE|EN|NACIDO|NACIDA|ESTADO|CIVIL|PROFESION|DOMICILIO)$/.test(valor) &&
  !/\b(?:ESTADO|BOLIVIA|SERVICIO GENERAL|IDENTIFICACION PERSONAL|CERTIFICA|DOCUMENTOS REGISTRADOS)\b/.test(valor) ?
  valor : '';
}

function antiguoLugarEnEn(filas, indice, aparicion, civilFila) {
  const etiqueta = filas[indice].words[aparicion.end];
  const etiquetaCy = etiqueta.y + etiqueta.h / 2;
  const inferior = civilFila >= 0 ? filas[civilFila].y0 : Infinity;
  const mismoBand = filas.flatMap((fila, filaIndice) => fila.words.
  filter((palabra, palabraIndice) =>
  (filaIndice !== indice || palabraIndice > aparicion.end) &&
  palabra.x >= etiqueta.x + etiqueta.w - etiqueta.h / 2 &&
  Math.abs(palabra.y + palabra.h / 2 - etiquetaCy) <= Math.max(etiqueta.h, palabra.h) * 0.9 &&
  palabra.y < inferior));
  mismoBand.sort((primero, segundo) => primero.x - segundo.x);
  const mismoLugar = limpiarAntiguoNacimientoLugar(
    limpiarAntiguoCiFondo(mismoBand.map((palabra) => palabra.text).join(' ')));
  if (mismoLugar && !mismoBand.some((palabra) => /\d/.test(palabra.text))) return mismoLugar;

  const debajo = [];
  for (let indiceSecundario = indice + 1; indiceSecundario < filas.length; indiceSecundario++) {
    const fila = filas[indiceSecundario];
    if (fila.y0 >= inferior || fila.y0 - etiqueta.y - etiqueta.h > 4 * etiqueta.h) break;
    if (buscarEtiquetaOccurrences(fila, ANTIGUO_CI_REVERSO_DEFINICIONES).length) break;
    debajo.push(...fila.words.filter((palabra) => palabra.x >= etiqueta.x - etiqueta.h));
  }
  const debajoLugar = limpiarAntiguoNacimientoLugar(
    limpiarAntiguoCiFondo(debajo.map((palabra) => palabra.text).join(' ')));
  return debajoLugar && !debajo.some((palabra) => /\d/.test(palabra.text)) ? debajoLugar : '';
}

// Si Vision omite la pequeña etiqueta «En», el formato anterior deja una
// única franja de texto entre nacimiento y estado civil. No se usa texto de
// otras zonas ni se infiere nada cuando hay varios bloques posibles.
function antiguoLugarBetweenNacimientoYCivil(filas, nacimientoFila, nacimientoFechaFila, civilFila) {
  const inicio = nacimientoFechaFila >= 0 ? nacimientoFechaFila : nacimientoFila;
  if (inicio < 0 || civilFila <= inicio + 1) return '';
  const blocks = [];
  for (let indice = inicio + 1; indice < civilFila; indice++) {
    const fila = filas[indice];
    if (fila.words.some((palabra) => /\d/.test(palabra.text)) ||
    buscarEtiquetaOccurrences(fila, ANTIGUO_CI_REVERSO_DEFINICIONES).some((etiqueta) =>
    etiqueta.def.key !== 'birthPlace')) continue;
    const lugar = limpiarAntiguoNacimientoLugar(fila.text.replace(/^EN\s*[:.\-]?\s*/, ''));
    if (!lugar || lugar.split(' ').length < 2) continue;
    const anterior = blocks.at(-1);
    if (anterior && fila.y0 - anterior.y1 <= 2.5 * fila.h) {
      anterior.text += ` ${lugar}`;
      anterior.y1 = fila.y1;
    } else {
      blocks.push({ text: lugar, y1: fila.y1 });
    }
  }
  return blocks.length === 1 ? limpiarAntiguoNacimientoLugar(blocks[0].text) : '';
}

function extraerAntiguoCiFrontalEspacial(filas) {
  const resultado = {};
  for (let indice = 0; indice < filas.length; indice++) {
    for (const aparicion of buscarEtiquetaOccurrences(filas[indice], ANTIGUO_CI_FRONTAL_DEFINICIONES)) {
      const clave = aparicion.def.key;
      if (clave === '_series' || resultado[clave]) continue;
      const bruto = antiguoCiValorEn(filas, indice, aparicion, ANTIGUO_CI_FRONTAL_DEFINICIONES);
      if (clave === 'ciNumber') {
        const numero = /^\s*[:.°º-]*\s*(\d{6,9})(?!\d)/.exec(bruto);
        if (numero) resultado.ciNumber = numero[1];
      } else {
        const fechas = buscarFechas(bruto);
        if (fechas.length === 1) resultado[clave] = fechas[0];
      }
    }
  }
  return resultado;
}

function extraerAntiguoCiReversoEspacial(filas) {
  const resultado = {};
  const nacimientoFila = filas.findIndex((fila) => /\bNACID[AO]\b/.test(fila.text));
  const espacialTexto = filas.map((fila) => fila.text).join('\n');
  const nacimientoFechaFila = filas.findIndex((fila) => buscarFechas(fila.text).length > 0);
  const nombreAnchorFila = filas.findIndex((fila) =>
  buscarEtiquetaOccurrences(fila, ANTIGUO_CI_REVERSO_DEFINICIONES).some((etiqueta) => etiqueta.def.key === 'fullName'));
  const civilInicio = Math.max(nacimientoFila, nacimientoFechaFila, nombreAnchorFila);
  const civilFila = filas.findIndex((fila, indice) =>
  indice > civilInicio && /\bCIVIL\b/.test(fila.text));
  for (let indice = 0; indice < filas.length && !resultado.fullName; indice++) {
    const etiqueta = buscarEtiquetaOccurrences(filas[indice], ANTIGUO_CI_REVERSO_DEFINICIONES).
    find((aparicion) => aparicion.def.key === 'fullName' && (
    filas[indice].words[aparicion.start].text.includes(':') ||
    indice === nombreAnchorFila));
    if (!etiqueta || nacimientoFila >= 0 && indice > nacimientoFila) continue;
    const bruto = antiguoCiValorEn(filas, indice, etiqueta, ANTIGUO_CI_REVERSO_DEFINICIONES, 2);
    const mismoFila = filas[indice].words.slice(etiqueta.end + 1).map((palabra) => palabra.text).join(' ');
    resultado.fullName = validoAntiguoCiNombre(bruto) || validoAntiguoCiNombre(mismoFila);
  }
  if (!resultado.fullName) resultado.fullName = antiguoNombreAntesNacimiento(espacialTexto);
  for (let indice = 0; indice < filas.length; indice++) {
    for (const aparicion of buscarEtiquetaOccurrences(filas[indice], ANTIGUO_CI_REVERSO_DEFINICIONES)) {
      const clave = aparicion.def.key;
      if (clave === 'fullName' || clave === '_footer' || resultado[clave]) continue;
      if (clave === 'birthPlace') {
        const minuscula = nacimientoFila >= 0 ? nacimientoFila :
        nacimientoFechaFila >= 0 ? nacimientoFechaFila : nombreAnchorFila;
        if (minuscula < 0 || indice < minuscula ||
        civilFila >= 0 && indice >= civilFila) continue;
      }
      const bruto = antiguoCiValorEn(filas, indice, aparicion, ANTIGUO_CI_REVERSO_DEFINICIONES,
      clave === 'address' || clave === 'birthPlace' ? 2 : 1);
      if (clave === 'birthDate') {
        const fechas = buscarFechas(bruto);
        if (fechas.length === 1) resultado.birthDate = fechas[0];
      } else if (clave === 'ciNumber') {
        const numero = /^\s*[:.°º-]*\s*(\d{6,9})(?!\d)/.exec(bruto);
        if (numero) resultado.ciNumber = numero[1];
      } else if (clave === 'birthPlace') {
        resultado.birthPlace = antiguoLugarEnEn(filas, indice, aparicion, civilFila) ||
        limpiarAntiguoNacimientoLugar(limpiarAntiguoCiFondo(bruto));
      } else if (clave === 'address') {
        const valor = bruto.replace(/[^A-Z0-9\u00C0-\u017F .#-]/g, ' ').replace(/\s+/g, ' ').trim();
        if (valor && valor.split(' ').length <= 20) resultado.address = valor;
      } else {
        const valor = bruto.replace(/[^A-Z\u00C0-\u017F ]/g, ' ').replace(/\s+/g, ' ').trim();
        if (valor && valor.split(' ').length <= 3) resultado[clave] = valor;
      }
    }
  }
  if (!resultado.birthPlace) {
    resultado.birthPlace = antiguoLugarBetweenNacimientoYCivil(
      filas, nacimientoFila, nacimientoFechaFila, civilFila);
  }
  return resultado;
}

// ─── Parser: CI ──────────────────────────────────────────────────────────────
function analizarCi(texto, opciones) {
  const documentoTipo = opciones && opciones.documentType || 'ciFront';
  const mrz = analizarMrz(texto);
  const formatear = opciones && opciones.format || (
  documentoTipo === 'ciBack' ?
  detectMRZ(texto) ? 'current' : 'legacy' :
  esAntiguoFrontal(texto) ? 'legacy' : 'current');
  const resultado = {
    fullName: '',
    firstNames: '',
    paternalSurname: '',
    maternalSurname: '',
    ciNumber: '',
    birthDate: '',
    ...analizarCiAdditionalCampos(texto),
    mrz: !!mrz,
    format: formatear
  };
  const etiquetadoEmisionFecha = resultado.issueDate;
  const etiquetadoVencimientoFecha = resultado.expiryDate;
  const palabras = opciones && Array.isArray(opciones.words) && opciones.words.length ?
  uprightCiPalabras(opciones.words) :
  null;

  // La CI anterior no tiene MRZ: nombre y nacimiento se leen del reverso.
  if (documentoTipo === 'ciBack') {
    if (resultado.format === 'legacy') {
      const filas = palabras ? construirFilas(primerPlanoAntiguoCiPalabras(palabras)) : null;
      const brutoReadableTexto = limpiarAntiguoCiFondo(texto);
      const readableTexto = filas ?
      limpiarAntiguoCiFondo(filas.map((fila) => fila.text).join('\n')) :
      brutoReadableTexto;
      const detalles = analizarCiAdditionalCampos(readableTexto);
      const brutoDetalles = filas ? analizarCiAdditionalCampos(brutoReadableTexto) : detalles;
      const espacial = filas ? extraerAntiguoCiReversoEspacial(filas) : {};
      const nombre = mostCompletarAntiguoCiNombre([
      antiguoNombreAntesNacimiento(brutoReadableTexto),
      antiguoNombreAntesNacimiento(readableTexto),
      espacial.fullName]
      );
      const partes = nombre.split(' ').filter(Boolean);
      if (partes.length >= 3 && partes.length <= 5) {
        resultado.firstNames = partes.slice(0, -2).join(' ');
        resultado.surnames = partes.slice(-2).join(' ');
        resultado.paternalSurname = partes.at(-2);
        resultado.maternalSurname = partes.at(-1);
        resultado.fullName = nombre;
      }
      resultado.birthDate = espacial.birthDate || fechaCercanoKeyword(readableTexto, ['NACIDO EL', 'NACIDA EL']) ||
      fechaCercanoKeyword(brutoReadableTexto, ['NACIDO EL', 'NACIDA EL']);
      // En este reverso suele haber una sola fecha, incluso si Vision separa
      // la etiqueta y la fecha en líneas distintas.
      if (!resultado.birthDate) {
        const fechas = [...new Set(buscarFechas(readableTexto))];
        if (fechas.length === 1) resultado.birthDate = fechas[0];
      }
      let nacimientoLugar = espacial.birthPlace || '';
      for (const candidato of [
      antiguoNacimientoLugarDespuesEn(readableTexto),
      antiguoNacimientoLugarDespuesEn(brutoReadableTexto)])
      {
        if (!candidato) continue;
        // Si Vision fusionó «LA» con la microimpresión, el filtrado de
        // palabras deja «PAZ…»; el texto completo permite recuperarlo.
        if (!nacimientoLugar || candidato.endsWith(nacimientoLugar) && candidato.length > nacimientoLugar.length) {
          nacimientoLugar = candidato;
        }
      }
      resultado.birthPlace = nacimientoLugar || antiguoNacimientoLugarSinEn(readableTexto) ||
      antiguoNacimientoLugarSinEn(brutoReadableTexto) || detalles.birthPlace;
      resultado.address = mostCompletarAntiguoCiDireccion([
      espacial.address,
      antiguoCiDireccionDesdeTexto(readableTexto),
      antiguoCiDireccionDesdeTexto(brutoReadableTexto),
      detalles.address]
      );
      resultado.occupation = normalizar(brutoDetalles.occupation || espacial.occupation || detalles.occupation).
      replace(/^(?:(?:PROFESION|OCUPACION)\s*[/.:\-]?\s*)+/, '').trim();
      const civilCandidatos = [brutoDetalles.maritalStatus, detalles.maritalStatus, espacial.maritalStatus].
      map(limpiarAntiguoCiCivilEstado).filter(Boolean);
      resultado.maritalStatus = civilCandidatos.find((estado) =>
      /^(?:SOLTER[AO]|CASAD[AO]|DIVORCIAD[AO]|VIUD[AO]|CONCUBIN[AO]|SEPARAD[AO]|CONVIVIENTE|UNION LIBRE)$/.test(estado)) ||
      civilCandidatos[0] || '';
      resultado.bloodType = detalles.bloodType;
      const numero = /\bN\s?(?:[o°º]|RO)\.?\s*:?\s*(\d{6,9})(?!\d)/i.exec(readableTexto);
      resultado.ciNumber = espacial.ciNumber || (numero ? numero[1] : '');
      return resultado;
    }
    // Formato actual: identidad del reverso solo desde la MRZ.
    if (mrz) {
      resultado.ciNumber = mrz.ciNumber;
      resultado.birthDate = mrz.birthDate;
      resultado.fullName = mrz.fullName;
    }
    resultado.birthPlace = realCiReversoMultilineValor(
      texto, /\bLUGAR\s+DE\s+NACIMIENTO\b\s*:?\s*/
    ) || resultado.birthPlace;
    resultado.address = realCiReversoMultilineValor(
      texto, /\b(?:DOMICILIO|DIRECCION)\b\s*:?\s*/, true
    ) || resultado.address;
    return resultado;
  }

  if (resultado.format === 'legacy') {
    const espacial = palabras ? extraerAntiguoCiFrontalEspacial(construirFilas(palabras)) : {};
    resultado.ciNumber = espacial.ciNumber ||
    (/\bN\s?(?:[o°º]|RO)\.?\s*:?\s*(\d{6,9})(?!\d)/i.exec(texto) || [])[1] || '';
    if (!resultado.ciNumber) {
      // En el frente anterior Vision a veces omite «No.» pero sí lee el CI
      // de ocho o nueve dígitos. No confundirlo con la serie de siete dígitos.
      const candidatos = [...new Set(String(texto || '').match(/\b\d{8,9}\b/g) || [])];
      if (candidatos.length === 1) resultado.ciNumber = candidatos[0];
    }
    resultado.issueDate = espacial.issueDate || resultado.issueDate;
    resultado.expiryDate = espacial.expiryDate || resultado.expiryDate;
    completarAntiguoFrontalFechas(resultado, texto);
    return resultado;
  }

  if (palabras) {
    const filas = construirFilas(palabras);
    const espacial = extraerEspacialCampos(filas, CI_FRONTAL_CAMPO_DEFINICIONES);
    if (espacial.ciNumber) resultado.ciNumber = espacial.ciNumber;
    if (espacial.birthDate) resultado.birthDate = espacial.birthDate;
    if (espacial.issueDate) resultado.issueDate = espacial.issueDate;
    if (espacial.expiryDate) resultado.expiryDate = espacial.expiryDate;
    if (espacial.nombres || espacial.apellidos) {
      resultado.fullName = [espacial.nombres, espacial.apellidos].
      filter(Boolean).
      join(' ').
      trim();
      resultado.firstNames = espacial.nombres || '';
      resultado.surnames = espacial.apellidos || '';
      const apellidoPartes = String(espacial.apellidos || '').split(/\s+/).filter(Boolean);
      resultado.paternalSurname = apellidoPartes[0] || '';
      resultado.maternalSurname = apellidoPartes.slice(1).join(' ');
    }
    // Respaldo por líneas para los campos que la geometría no resolvió
    const lineaResultado = analizarCiCamposDesdeLineas(texto, mrz);
    if (!resultado.ciNumber && lineaResultado.ciNumber) {
      resultado.ciNumber = lineaResultado.ciNumber;
    }
    if (!resultado.birthDate && lineaResultado.birthDate) {
      resultado.birthDate = lineaResultado.birthDate;
    }
    if (!resultado.fullName && lineaResultado.fullName) {
      resultado.fullName = lineaResultado.fullName;
    }
    if (!resultado.firstNames) resultado.firstNames = lineaResultado.firstNames;
    if (!resultado.paternalSurname) resultado.paternalSurname = lineaResultado.paternalSurname;
    if (!resultado.maternalSurname) resultado.maternalSurname = lineaResultado.maternalSurname;
    if (!resultado.surnames) resultado.surnames = lineaResultado.surnames;
  } else {
    const lineaResultado = analizarCiCamposDesdeLineas(texto, mrz);
    resultado.ciNumber = lineaResultado.ciNumber;
    resultado.birthDate = lineaResultado.birthDate;
    resultado.fullName = lineaResultado.fullName;
    resultado.firstNames = lineaResultado.firstNames;
    resultado.paternalSurname = lineaResultado.paternalSurname;
    resultado.maternalSurname = lineaResultado.maternalSurname;
    resultado.surnames = lineaResultado.surnames;
  }

  // Respaldo MRZ
  if (mrz) {
    if (!resultado.ciNumber) resultado.ciNumber = mrz.ciNumber;
    if (!resultado.birthDate) resultado.birthDate = mrz.birthDate;
    if (!resultado.fullName) resultado.fullName = mrz.fullName;
  }

  // Si el texto identifica ambas fechas junto a sus etiquetas, no permitir
  // que una asociación espacial ambigua copie vencimiento sobre emisión.
  if (etiquetadoEmisionFecha && etiquetadoVencimientoFecha && etiquetadoEmisionFecha !== etiquetadoVencimientoFecha) {
    resultado.issueDate = etiquetadoEmisionFecha;
    resultado.expiryDate = etiquetadoVencimientoFecha;
  }

  if (resultado.format === 'legacy') completarAntiguoFrontalFechas(resultado, texto);

  return resultado;
}

// ─── Clasificación / validación de CI ────────────────────────────────────────
const CI_FRONTAL_PALABRASCLAVE = [
'CEDULA DE IDENTIDAD',
'SERVICIO GENERAL DE IDENTIFICACION',
'NOMBRES',
'APELLIDOS',
'NACIMIENTO',
'EMISION',
'EXPIRACION',
'EXPIRACY',
'SEXO',
'FIRMA'];

const CI_REVERSO_PALABRASCLAVE = [
'DOMICILIO',
'PROFESION',
'OCUPACION',
'ESTADO CIVIL',
'GRUPO SANGUINEO',
'LUGAR DE NACIMIENTO'];


/**
 * Detecta zona MRZ: línea "IDBOL..." o línea larga con varios '<' y dígitos
 * (una línea MRZ siempre lleva dígitos: número, fechas, checks).
 */
function detectMRZ(texto) {
  const lineas = normalizarLineas(texto);
  for (const l of lineas) {
    if (l.includes('IDBOL')) return true;
    const chevrons = (l.match(/</g) || []).length;
    if (
    chevrons >= 4 &&
    l.length >= 20 &&
    /\d/.test(l) &&
    /^[A-Z0-9<]+$/.test(l))
    {
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
function clasificarCI(texto, rostrosEncontrado) {
  const t = normalizar(texto);
  let frontalPuntuacion = rostrosEncontrado > 0 ? 2 : 0;
  for (const palabraClave of CI_FRONTAL_PALABRASCLAVE) {
    if (t.includes(normalizar(palabraClave))) frontalPuntuacion++;
  }
  const tieneMrz = detectMRZ(texto);
  let reversoPuntuacion = tieneMrz ? 3 : 0;
  for (const palabraClave of CI_REVERSO_PALABRASCLAVE) {
    if (t.includes(normalizar(palabraClave))) reversoPuntuacion++;
  }
  return { frontScore: frontalPuntuacion, backScore: reversoPuntuacion, hasMRZ: tieneMrz };
}

/**
 * Valida que la foto corresponda al lado esperado de la cédula.
 * @param {string} text texto OCR
 * @param {number} facesFound rostros detectados
 * @param {'ciFront'|'ciBack'} side lado solicitado
 */
function validarCi(texto, rostrosEncontrado, lado) {
  if (!String(texto || '').trim()) {
    return {
      rejected: true,
      rejectReason:
      'No se pudo leer ningún texto de la foto. Vuelve a tomarla con mejor luz.'
    };
  }

  const { frontScore: frontalPuntuacion, backScore: reversoPuntuacion, hasMRZ: tieneMrz } = clasificarCI(texto, rostrosEncontrado);

  if (lado === 'ciFront') {
    // Basura tipo MRZ (código de barras, firma) no debe tumbar un frente claro:
    // si hay señales frontales fuertes, gana el frente.
    if (tieneMrz && frontalPuntuacion < 2) {
      return {
        rejected: true,
        rejectReason: 'Esta es la parte trasera de la cédula. Sube la foto frontal.'
      };
    }
    if (frontalPuntuacion >= 2) return { rejected: false, rejectReason: '' };
    if (reversoPuntuacion >= 2 && frontalPuntuacion === 0) {
      return {
        rejected: true,
        rejectReason: 'Esta es la parte trasera de la cédula. Sube la foto frontal.'
      };
    }
    if (frontalPuntuacion === 0) {
      return {
        rejected: true,
        rejectReason: 'No parece ser una cédula de identidad. Sube la foto correcta.'
      };
    }
    return { rejected: false, rejectReason: '' };
  }

  // ciBack
  if (rostrosEncontrado > 0) {
    return {
      rejected: true,
      rejectReason: 'Esta es la parte frontal de la cédula. Sube la parte trasera.'
    };
  }
  if (tieneMrz) return { rejected: false, rejectReason: '' };
  if (reversoPuntuacion >= 2) return { rejected: false, rejectReason: '' };
  if (frontalPuntuacion >= 2) {
    return {
      rejected: true,
      rejectReason: 'Esta es la parte frontal de la cédula. Sube la parte trasera.'
    };
  }
  return {
    rejected: true,
    rejectReason: 'No parece ser una cédula de identidad. Sube la foto correcta.'
  };
}

// ─── Parser: Licencia de conducir ────────────────────────────────────────────
const LICENCIA_FECHAS_ESPACIALES = [
  { key: 'issueDate', labels: ['EMISION', 'EMISI0N', 'EMIS ION'], type: 'date', extract: true },
  { key: 'licenseExpiryDate', labels: ['VENCIMIENTO'], type: 'date', extract: true },
  { key: 'birthDate', labels: ['FECHA DE NACIMIENTO', 'NACIMIENTO'], type: 'date', extract: true }
];

function emisionLicenciaEnColumna(filas) {
  for (let indice = 0; indice + 1 < filas.length; indice++) {
    const fila = filas[indice];
    const etiquetas = buscarEtiquetaOccurrences(fila, LICENCIA_FECHAS_ESPACIALES);
    const emision = etiquetas.find(({ def }) => def.key === 'issueDate');
    if (!emision) continue;

    const debajo = filas[indice + 1];
    if (debajo.y0 - fila.y1 > 2 * fila.h ||
    buscarEtiquetaOccurrences(debajo, LICENCIA_FECHAS_ESPACIALES).length) continue;

    const izquierda = fila.words[emision.start].x;
    const siguiente = etiquetas.find(({ start }) => start > emision.end);
    const derecha = siguiente ? fila.words[siguiente.start].x - fila.h / 2 :
      fila.words[emision.end].x + fila.words[emision.end].w + 4 * fila.h;
    const columna = debajo.words.filter(({ x }) => x >= izquierda - fila.h && x < derecha);
    if (!columna.length || Math.abs(columna[0].x - izquierda) > fila.h) continue;
    const texto = columna.map(({ text }) => text).join(' ').replace(/\s*([/.-])\s*/g, '$1');
    const fechas = buscarFechas(texto);
    if (fechas.length === 1) return fechas[0];
  }
  return '';
}

function analizarLicencia(texto, opciones) {
  const lineas = normalizarLineas(texto);
  const resultado = {
    licenseNumber: '',
    fullName: '',
    nationality: '',
    issueDate: '',
    licenseExpiryDate: '',
    birthDate: '',
    licenseCategory: ''
  };

  // No usar solamente `valueAfterKeyword('LICENCIA')`: suele encontrar antes
  // el título "LICENCIA DE CONDUCIR" que la línea del número.
  const licenciaNumeroPatrones = [
  /(?:NUMERO|NRO|NO|N)[.°º\s]*(?:DE\s*)?(?:LICENCIA|LIC\.?)\s*[:#.-]*\s*(\d{6,9})/i,
  /(?:LICENCIA|LIC\.?)\s*(?:NUMERO|NRO|NO|N)[.°º\s]*[:#.-]*\s*(\d{6,9})/i,
  /(?:NRO|NO|N)[.°º\s]*[:#.-]*\s*(\d{6,9})/i];

  for (const patron of licenciaNumeroPatrones) {
    const coincidencia = patron.exec(stripAccents(texto));
    if (coincidencia) {
      resultado.licenseNumber = coincidencia[1];
      break;
    }
  }
  if (!resultado.licenseNumber) {
    resultado.licenseNumber = lineas.find((linea) => /^\d{6,9}$/.test(linea)) || '';
  }

  // En esta licencia el rótulo es «Nombres, Apellidos» y el último apellido
  // suele estar en una segunda línea sin etiqueta propia.
  const combinedNombreIndice = lineas.findIndex((linea) => /\bNOMBRES?\s*[,.:]?\s*APELLIDOS?\b/.test(linea));
  if (combinedNombreIndice !== -1) {
    const nombreLineas = [];
    const primero = lineas[combinedNombreIndice].replace(/^.*?\bNOMBRES?\s*[,.:]?\s*APELLIDOS?\b/, '').trim();
    for (const brutoCandidato of [primero, lineas[combinedNombreIndice + 1], lineas[combinedNombreIndice + 2]]) {
      if (!brutoCandidato) continue;
      const candidato = brutoCandidato.replace(/\bSEGIP\b/g, ' ').replace(/[,.;:]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!candidato) continue;
      if (/^(SEGIP|SEXO|NACIONALIDAD|NRO|NUMERO|FECHA|EMISION|VENCIMIENTO|LICENCIA|ESTADO|SERVICIO)\b/.test(candidato)) break;
      if (!/^[A-ZÑÁÉÍÓÚÜ ]+$/.test(candidato)) break;
      const palabras = candidato.split(/\s+/);
      if (palabras.some((palabra) => ETIQUETA_PALABRA_RE.test(palabra))) break;
      if (nombreLineas.join(' ').split(/\s+/).filter(Boolean).length + palabras.length > 6) break;
      nombreLineas.push(candidato);
    }
    resultado.fullName = nombreLineas.join(' ').trim();
  }
  if (!resultado.fullName) {
    const licenciaNames = etiquetadoValor(texto, ['NOMBRES Y APELLIDOS', 'NOMBRE COMPLETO', 'NOMBRES', 'NOMBRE']);
    const licenciaApellidos = etiquetadoValor(texto, ['APELLIDOS', 'APELLIDO']);
    resultado.fullName = [licenciaNames, licenciaApellidos].filter(Boolean).join(' ').trim();
  }
  resultado.nationality = etiquetadoValor(texto, ['NACIONALIDAD']);
  resultado.issueDate = fechaCercanoKeyword(texto, ['FECHA DE EMISION', 'FECHA EMISION', 'EMISION']);
  resultado.birthDate = fechaCercanoKeyword(texto, ['FECHA DE NACIMIENTO', 'NACIMIENTO']);

  resultado.licenseExpiryDate =
  fechaCercanoKeyword(texto, [
  'VENCIMIENTO',
  'VENCIMlENTO',
  'VENCIMENTO',
  'EXPIRA',
  'EXPIRACION',
  'VENCE',
  'VALIDA HASTA',
  'HASTA']
  ) || '';

  // Vision puede devolver «Emisión\nVencimiento\n11/10/2022 11/10/2027».
  if (!resultado.issueDate || !resultado.licenseExpiryDate || resultado.issueDate === resultado.licenseExpiryDate) {
    const emissionIndice = lineas.findIndex((linea) => /\bEMISION\b/.test(linea));
    const vencimientoIndice = lineas.findIndex((linea) => /\bVENCIMIENTO\b/.test(linea));
    if (emissionIndice !== -1 && vencimientoIndice !== -1 && Math.abs(emissionIndice - vencimientoIndice) <= 2) {
      const inicio = Math.max(emissionIndice, vencimientoIndice);
      const fechas = [];
      for (let indice = inicio; indice <= Math.min(lineas.length - 1, inicio + 2); indice++) {
        if (indice > inicio && SIGUIENTE_LINEA_ETIQUETA_RE.test(lineas[indice])) break;
        fechas.push(...buscarFechas(lineas[indice]));
      }
      if (fechas.length === 2 && emissionIndice < vencimientoIndice) {
        resultado.issueDate = fechas[0];
        resultado.licenseExpiryDate = fechas[1];
      }
    }
  }

  if (opciones?.documentType !== 'licenseBack' && opciones?.words?.length &&
  (!resultado.issueDate || resultado.issueDate === resultado.licenseExpiryDate)) {
    const filas = construirFilas(uprightCiPalabras(opciones.words));
    const fechas = extraerEspacialCampos(filas, LICENCIA_FECHAS_ESPACIALES);
    const emision = emisionLicenciaEnColumna(filas) || fechas.issueDate;
    const vencimiento = fechas.licenseExpiryDate || resultado.licenseExpiryDate;
    const nacimiento = fechas.birthDate || resultado.birthDate;
    if (emision && emision !== vencimiento && emision !== nacimiento) {
      resultado.issueDate = emision;
      resultado.licenseExpiryDate = vencimiento;
    }
  }

  // Categoría: CATEGORIA: P / CAT. P-C / CLASE P
  const reCat = /CATEGORI[A]?\s*[.:]?\s*([A-Z](?:\s*[.\-–]\s*[A-Z])?)/;
  const reClase = /CLASE\s*[.:]?\s*([A-Z](?:\s*[.\-–]\s*[A-Z])?)/;
  const mc = texto.match(reCat) || texto.match(reClase);
  if (mc) {
    resultado.licenseCategory = mc[1].replace(/\s+/g, '');
  } else {
    // Algunas licencias imprimen únicamente la letra de categoría, sin etiqueta.
    const standaloneCategoria = normalizarLineas(texto).find((linea) =>
    /^(?:P|A|B|C)(?:\s*[.\-–]\s*(?:P|A|B|C))?$/.test(linea)
    );
    if (standaloneCategoria) {
      resultado.licenseCategory = standaloneCategoria.replace(/[\s.\-–]/g, '');
    }
  }

  return resultado;
}

// ─── Parser: Tarjeta de Identificación del Conductor (TIC) ─────────────────
const TIC_ESPACIAL_DEFINICIONES = [
{ key: 'firstNames', labels: ['NOMBRES'] },
{ key: 'surnames', labels: ['APELLIDOS'] },
{ key: 'fullName', labels: ['NOMBRES Y APELLIDOS', 'NOMBRE COMPLETO'] },
{ key: 'licenseNumber', labels: ['LICENCIA', 'NUMERO DE LICENCIA', 'NRO DE LICENCIA'] }];

const TIC_ISSUING_LUGARES = [
'LA PAZ', 'ORURO', 'COCHABAMBA', 'SANTA CRUZ', 'POTOSI',
'TARIJA', 'CHUQUISACA', 'SUCRE', 'BENI', 'PANDO'];


function validarTicEspacialValor(clave, palabras) {
  const valor = palabras.map((palabra) => palabra.text).join(' ').replace(/^[\s:.\-]+/, '').trim();
  if (clave === 'licenseNumber') return /^\d{6,9}$/.test(valor) ? valor : '';
  if (!/^[A-Z]+(?:\s+[A-Z]+){0,6}$/.test(valor)) return '';
  if (valor.split(' ').some((token) => ETIQUETA_PALABRA_RE.test(token))) return '';
  return valor;
}

function analizarTic(texto, opciones = {}) {
  const lineas = normalizarLineas(texto);
  const rumboIndice = lineas.findIndex((linea) => /TARJETA\s+DE\s+IDENTIFICACION\s+DEL?\s+CONDUCTOR/.test(linea));
  const cabecera = lineas.slice(0, rumboIndice < 0 ? 8 : rumboIndice);
  const resultado = {
    ticNumber: (cabecera.join(' ').match(/\b[A-Z]{2,4}\d{6,10}\b/) || [])[0] || '',
    issuingPlace: TIC_ISSUING_LUGARES.find((lugar) => cabecera.some((linea) =>
    new RegExp(`\\b${lugar}\\b`).test(linea))) || '',
    firstNames: etiquetadoValor(texto, ['NOMBRES', 'NOMBRE']),
    surnames: etiquetadoValor(texto, ['APELLIDOS', 'APELLIDO']),
    fullName: etiquetadoValor(texto, ['NOMBRE COMPLETO', 'NOMBRES Y APELLIDOS']),
    licenseNumber: ''
  };
  const licenciaLinea = valorDespuesKeyword(texto, ['NUMERO DE LICENCIA', 'NRO DE LICENCIA', 'LICENCIA']);
  resultado.licenseNumber = (licenciaLinea.match(/\b\d{6,9}\b/) || [])[0] || '';
  Object.assign(resultado, extraerEtiquetadoEspacialCampos(
    opciones.words, TIC_ESPACIAL_DEFINICIONES, validarTicEspacialValor
  ));
  if (!resultado.fullName) resultado.fullName = [resultado.firstNames, resultado.surnames].filter(Boolean).join(' ').trim();

  if (Array.isArray(opciones.words) && opciones.words.length) {
    const filas = construirRuatFilas(opciones.words);
    const rumbo = filas.find((fila) => /TARJETA\s+DE\s+IDENTIFICACION/.test(fila.text));
    const mayusculaPalabras = opciones.words.filter((palabra) => !rumbo || palabra.y + palabra.h <= rumbo.y0);
    const tarjeta = mayusculaPalabras.find((palabra) => /^[A-Z]{2,4}\d{6,10}$/.test(normalizar(palabra.text)));
    if (tarjeta) resultado.ticNumber = normalizar(tarjeta.text);
    const lugar = TIC_ISSUING_LUGARES.find((candidato) => mayusculaPalabras.some((palabra) =>
    normalizar(palabra.text) === candidato));
    if (lugar) resultado.issuingPlace = lugar;
  }
  return resultado;
}

/** Asocia cada etiqueta con el valor a su derecha o debajo, dentro de su columna. */
function extraerEtiquetadoEspacialCampos(palabras, definiciones, validar) {
  const filas = construirRuatFilas(palabras);
  const fuera = {};
  for (let filaIndice = 0; filaIndice < filas.length; filaIndice++) {
    const fila = filas[filaIndice];
    const occurrences = buscarEtiquetaOccurrences(fila, definiciones);
    const etiquetas = occurrences.filter((etiqueta) => !occurrences.some((otro) =>
    otro !== etiqueta && otro.start <= etiqueta.start && otro.end >= etiqueta.end &&
    otro.end - otro.start > etiqueta.end - etiqueta.start));
    for (const etiqueta of etiquetas) {
      const clave = etiqueta.def.key;
      if (fuera[clave]) continue;
      const siguienteEtiqueta = etiquetas.find((otro) => otro.start > etiqueta.end);
      const etiquetaFin = fila.words[etiqueta.end].x + fila.words[etiqueta.end].w;
      const derechaLimite = Math.min(
        siguienteEtiqueta ? fila.words[siguienteEtiqueta.start].x : Infinity,
        etiquetaFin + 24 * fila.h
      );
      const derecha = fila.words.slice(etiqueta.end + 1, siguienteEtiqueta ? siguienteEtiqueta.start : undefined).
      filter((palabra) => palabra.x >= etiquetaFin - 2 && palabra.x < derechaLimite);
      let valor = validar(clave, derecha);
      if (!valor) {
        const debajo = filas[filaIndice + 1];
        if (debajo && debajo.y0 - fila.y1 <= 2.5 * fila.h &&
        !buscarEtiquetaOccurrences(debajo, definiciones).length) {
          const izquierdaLimite = fila.words[etiqueta.start].x - fila.h;
          const debajoPalabras = debajo.words.filter((palabra) =>
          palabra.x >= izquierdaLimite && palabra.x < derechaLimite);
          valor = validar(clave, debajoPalabras);
        }
      }
      if (valor) fuera[clave] = valor;
    }
  }
  return fuera;
}

// ─── Parser: SOAT ────────────────────────────────────────────────────────────
const SOAT_ESPACIAL_DEFINICIONES = [
{ key: 'soatRosetteNumber', labels: ['ROSETA'] },
{ key: 'soatYear', labels: ['SOAT'] },
{ key: 'soatDepartment', labels: ['DEPARTAMENTO'] },
{ key: 'soatPlate', labels: ['PLACA'] },
{ key: 'soatVehicleType', labels: ['TIPO'] },
{ key: 'soatUse', labels: ['USO'] },
{ key: 'soatStartDate', labels: ['DEL'] },
{ key: 'soatExpiryDate', labels: ['HASTA'] }];


function validarSoatEspacialValor(clave, palabras) {
  const valor = palabras.map((palabra) => palabra.text).join(' ').trim();
  const compact = valor.replace(/\s+/g, '');
  if (clave === 'soatRosetteNumber') return /^\d{7,14}$/.test(compact) ? compact : '';
  if (clave === 'soatYear') return /^20\d{2}$/.test(compact) ? compact : '';
  if (clave === 'soatPlate') return /^(?:\d{3,4}[A-Z]{3}|[A-Z]{2}\d{4})$/.test(compact) ? compact : '';
  if (clave === 'soatUse') return /^(PUBLICO|PARTICULAR)$/.test(valor) ? valor : '';
  if (clave === 'soatStartDate' || clave === 'soatExpiryDate') {
    const fechas = buscarFechas(valor);
    return fechas.length === 1 ? fechas[0] : '';
  }
  if (clave === 'soatDepartment' || clave === 'soatVehicleType') {
    return /^[A-Z]+(?:\s+[A-Z]+){0,2}$/.test(valor) &&
    !valor.split(' ').some((token) => ETIQUETA_PALABRA_RE.test(token)) ? valor : '';
  }
  return '';
}

function analizarSoat(texto, opciones = {}) {
  const resultado = {
    soatRosetteNumber: '', soatYear: '', soatDepartment: '', soatPlate: '',
    soatVehicleType: '', soatUse: '', soatStartDate: '', soatExpiryDate: ''
  };
  const lineas = normalizarLineas(texto);
  const labeledValue = (etiqueta, valorPatron) => {
    for (let indice = 0; indice < lineas.length; indice++) {
      const coincidencia = etiqueta.exec(lineas[indice]);
      if (!coincidencia) continue;
      const mismo = lineas[indice].slice(coincidencia.index + coincidencia[0].length).trim();
      const valor = valorPatron.exec(mismo)?.[1] || '';
      if (valor) return valor.trim();
      if (indice + 1 < lineas.length) {
        const siguiente = valorPatron.exec(lineas[indice + 1])?.[1] || '';
        if (siguiente) return siguiente.trim();
      }
    }
    return '';
  };
  const fechaDespues = (etiqueta) => {
    for (let indice = 0; indice < lineas.length; indice++) {
      const coincidencia = etiqueta.exec(lineas[indice]);
      if (!coincidencia) continue;
      const mismo = buscarFechas(lineas[indice].slice(coincidencia.index + coincidencia[0].length))[0];
      if (mismo) return mismo;
      if (indice + 1 < lineas.length && /^\d{1,2}[\/.-]\d{1,2}[\/.-](?:19|20)\d{2}$/.test(lineas[indice + 1])) {
        return buscarFechas(lineas[indice + 1])[0] || '';
      }
    }
    return '';
  };

  // Roseta digital UNIVIDA: «N° de Roseta», «SOAT 2026», «Del» y «Hasta».
  resultado.soatRosetteNumber = labeledValue(/\bROSETA\s*[:.]?\s*/, /^(\d{7,14})\b/);
  resultado.soatYear = (/\bSOAT\s*(20\d{2})\b/.exec(lineas.join(' ')) || [])[1] || '';
  resultado.soatDepartment = labeledValue(/\bDEPARTAMENTO\s*[:.]?\s*/, /^([A-Z]+(?:\s+[A-Z]+){0,2})$/);
  resultado.soatPlate = labeledValue(/\bPLACA\s*[:.]?\s*/, /^((?:\d{3,4}\s?[A-Z]{3}|[A-Z]{2}\s?\d{4}))\b/).replace(/\s+/g, '');
  resultado.soatVehicleType = labeledValue(/\bTIPO\s*[:.]?\s*/, /^([A-Z]{3,}(?:\s+[A-Z]{3,})?)$/);
  resultado.soatUse = labeledValue(/\bUSO\s*[:.]?\s*/, /^(PUBLICO|PARTICULAR)\b/);
  resultado.soatStartDate = fechaDespues(/\bDEL\b\s*[:.]?\s*/);
  resultado.soatExpiryDate = fechaDespues(/\bHASTA\b\s*[:.]?\s*/);
  Object.assign(resultado, extraerEtiquetadoEspacialCampos(
    opciones.words, SOAT_ESPACIAL_DEFINICIONES, validarSoatEspacialValor
  ));
  return resultado;
}

// ─── Parser: certificado digital de antecedentes policiales ────────────────
const ANTECEDENTES_ESPACIAL_DEFINICIONES = [
{ key: 'fullName', labels: ['NOMBRES Y APELLIDOS'] },
{ key: 'ciNumber', labels: ['DOCUMENTO DE IDENTIDAD'] },
{ key: 'birthDate', labels: ['FECHA DE NACIMIENTO'] },
{ key: 'nationality', labels: ['NACIONALIDAD'] },
{ key: 'birthPlace', labels: ['LUGAR DE NACIMIENTO'] },
{ key: 'issuedIn', labels: ['EXPEDIDO EN'] },
{ key: 'maritalStatus', labels: ['ESTADO CIVIL'] },
{ key: 'occupation', labels: ['PROFESION OCUPACION', 'PROFESIONOCUPACION', 'PROFESION'] },
{ key: 'address', labels: ['DOMICILIO'] },
{ key: 'procedureReason', labels: ['MOTIVO DEL TRAMITE'] },
{ key: 'recipient', labels: ['DESTINATARIO DEL TRAMITE'] },
{ key: 'backgroundUnit', labels: ['ANTECEDENTES'] },
{ key: 'backgroundResult', labels: ['ANTECEDENTES'] },
{ key: 'issueDate', labels: ['FECHA DE EMISION'] },
{ key: 'validUntil', labels: ['VALIDEZ'] }];


function validarAntecedentesEspacialValor(clave, palabras) {
  const valor = palabras.map((palabra) => palabra.text).join(' ').replace(/^[\s:.\-]+/, '').trim();
  if (!valor) return '';
  if (clave === 'ciNumber') return (/^\d{5,10}\b/.exec(valor) || [])[0] || '';
  if (clave === 'birthDate' || clave === 'issueDate' || clave === 'validUntil') {
    const fechas = buscarFechas(valor);
    return fechas.length === 1 ? fechas[0] : '';
  }
  if (clave === 'backgroundUnit') return /F\.?\s*E\.?\s*L\.?\s*C\.?\s*V\.?/.test(valor) ? 'F.E.L.C.V.' : '';
  if (clave === 'backgroundResult') return (/\b(NO REGISTRA|NO|SI|NINGUNO|REGISTRA)\b/.exec(valor) || [])[0] || '';
  if (clave === 'fullName') {
    const nombre = valor.replace(/[,:;.]$/, '').trim();
    return /^[A-Z]+(?:\s+[A-Z]+){1,6}$/.test(nombre) &&
    !nombre.split(' ').some((token) => ETIQUETA_PALABRA_RE.test(token)) ? nombre : '';
  }
  if (clave === 'nationality' || clave === 'issuedIn' || clave === 'maritalStatus' ||
  clave === 'occupation' || clave === 'procedureReason' || clave === 'recipient') {
    return /^[A-Z]+(?:\s+[A-Z]+){0,5}$/.test(valor) &&
    !valor.split(' ').some((token) => ETIQUETA_PALABRA_RE.test(token)) ? valor : '';
  }
  if (clave === 'birthPlace' || clave === 'address') {
    return valor.length <= 100 && /[A-Z]{3}/.test(valor) ? valor : '';
  }
  return '';
}

function analizarAntecedentes(texto, opciones = {}) {
  const lineas = normalizarLineas(texto);
  const resultado = {
    certificateNumber: '', fullName: '', ciNumber: '', birthDate: '',
    nationality: '', birthPlace: '', issuedIn: '', maritalStatus: '',
    occupation: '', address: '', procedureReason: '', recipient: '',
    backgroundUnit: '', backgroundResult: '', issueDate: '', validUntil: ''
  };
  const siguienteEtiqueta = /\b(?:DOCUMENTO DE IDENTIDAD|FECHA DE NACIMIENTO|LUGAR DE NACIMIENTO|NACIONALIDAD|EXPEDIDO EN|ESTADO CIVIL|PROFESION\s*\/\s*OCUPACION|DOMICILIO|MOTIVO DEL TRAMITE|DESTINATARIO DEL TRAMITE|ANTECEDENTES|FECHA DE EMISION|VALIDEZ|TIPO)\s*:/;
  const leer = (etiqueta, patron) => {
    for (let indice = 0; indice < lineas.length; indice++) {
      const coincidencia = etiqueta.exec(lineas[indice]);
      if (!coincidencia) continue;
      const mismo = lineas[indice].slice(coincidencia.index + coincidencia[0].length).split(siguienteEtiqueta)[0].trim();
      if (mismo && patron.test(mismo)) return mismo;
      const following = lineas[indice + 1] || '';
      if (following && !siguienteEtiqueta.test(following) && patron.test(following)) return following;
    }
    return '';
  };
  const leerFecha = (etiqueta) => {
    const candidato = leer(etiqueta, /\b\d{1,2}[\/.-]\d{1,2}[\/.-](?:19|20)\d{2}\b/);
    return buscarFechas(candidato)[0] || '';
  };

  // El número sin etiqueta está impreso sobre el encabezado del certificado.
  const rumboIndice = lineas.findIndex((linea) => /CERTIFICADO\s+UNICO\s+DIGITAL/.test(linea));
  const cabecera = lineas.slice(0, rumboIndice < 0 ? 6 : rumboIndice);
  resultado.certificateNumber = (cabecera.join(' ').match(/\b\d{12}\b/) || [])[0] || '';
  const nombre = leer(/\bNOMBRES?\s+Y\s+APELLIDOS?\s*:?\s*/, /^[A-ZÑ ]{5,}$/);
  resultado.fullName = /^[A-ZÑ]+(?:\s+[A-ZÑ]+){1,6}$/.test(nombre) ? nombre : '';
  resultado.ciNumber = (leer(/\bDOCUMENTO\s+DE\s+IDENTIDAD\s*:?\s*/, /\b\d{5,10}\b/).match(/\b\d{5,10}\b/) || [])[0] || '';
  resultado.birthDate = leerFecha(/\bFECHA\s+DE\s+NACIMIENTO\s*:?\s*/);
  resultado.nationality = leer(/\bNACIONALIDAD\s*:?\s*/, /^[A-Z ]{3,}$/);
  resultado.birthPlace = leer(/\bLUGAR\s+DE\s+NACIMIENTO\s*:?\s*/, /[A-Z]{3}/);
  resultado.issuedIn = leer(/\bEXPEDIDO\s+EN\s*:?\s*/, /^[A-Z ]{3,}$/);
  resultado.maritalStatus = leer(/\bESTADO\s+CIVIL\s*:?\s*/, /^[A-Z ]{3,}$/);
  resultado.occupation = leer(/\bPROFESION\s*\/\s*OCUPACION\s*:?\s*/, /[A-Z]{3}/);
  resultado.address = leer(/\bDOMICILIO\s*:?\s*/, /[A-Z0-9]{2}/);
  resultado.procedureReason = leer(/\bMOTIVO\s+DEL\s+TRAMITE\s*:?\s*/, /[A-Z]{3}/);
  resultado.recipient = leer(/\bDESTINATARIO\s+DEL\s+TRAMITE\s*:?\s*/, /[A-Z]{3}/);

  let fondo = '';
  for (let indice = 0; indice < lineas.length; indice++) {
    const etiqueta = /^ANTECEDENTES\s*:?\s*/.exec(lineas[indice]);
    if (!etiqueta) continue;
    const partes = [lineas[indice].slice(etiqueta.index + etiqueta[0].length)];
    for (let desplazamiento = 1; desplazamiento <= 2 && indice + desplazamiento < lineas.length; desplazamiento++) {
      const siguiente = lineas[indice + desplazamiento];
      if (siguienteEtiqueta.test(siguiente)) break;
      partes.push(siguiente);
      if (/\b(?:NO|SI|NINGUNO|REGISTRA)\b/.test(siguiente)) break;
    }
    fondo = partes.join(' ').trim();
    break;
  }
  const unidad = /\bF\.?\s*E\.?\s*L\.?\s*C\.?\s*V\.?/i.exec(fondo);
  if (unidad) resultado.backgroundUnit = 'F.E.L.C.V.';
  const answer = (unidad ? fondo.slice(unidad.index + unidad[0].length) : fondo).replace(/^[\s:.\-]+/, '').trim();
  resultado.backgroundResult = (/^(NO REGISTRA|NO|SI|NINGUNO|REGISTRA)\b/.exec(answer) || [])[0] || '';
  resultado.issueDate = leerFecha(/\bFECHA\s+DE\s+EMISION\s*:?\s*/);
  resultado.validUntil = leerFecha(/\bVALIDEZ\s*:?\s*/);
  const espacial = extraerEtiquetadoEspacialCampos(
    opciones.words, ANTECEDENTES_ESPACIAL_DEFINICIONES, validarAntecedentesEspacialValor
  );
  Object.assign(resultado, espacial);
  if (!resultado.certificateNumber && Array.isArray(opciones.words)) {
    const filas = construirRuatFilas(opciones.words);
    const rumbo = filas.find((fila) => /CERTIFICADO\s+UNICO\s+DIGITAL/.test(fila.words.map((palabra) => palabra.text).join(' ')));
    const numero = opciones.words.find((palabra) => /^\d{12}$/.test(String(palabra.text || '').trim()) && (
    !rumbo || palabra.y + palabra.h <= rumbo.y0));
    if (numero) resultado.certificateNumber = numero.text.trim();
  }
  return resultado;
}

// ─── Parser: factura de luz como comprobante de domicilio ───────────────────
const ELECTRICIDAD_MESES = {
  ENERO: 1, ENE: 1, FEBRERO: 2, FEB: 2, MARZO: 3, MAR: 3,
  ABRIL: 4, ABR: 4, MAYO: 5, MAY: 5, JUNIO: 6, JUN: 6,
  JULIO: 7, JUL: 7, AGOSTO: 8, AGO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9,
  SEP: 9, SET: 9, OCTUBRE: 10, OCT: 10, NOVIEMBRE: 11, NOV: 11,
  DICIEMBRE: 12, DIC: 12
};
const ELECTRICIDAD_ESPACIAL_DEFINICIONES = [
{ key: 'serviceAddress', labels: ['DIRECCION'] },
{ key: 'billingMonth', labels: ['MES'] },
{ key: '_consumer', labels: ['CONSUMIDOR', 'NUMERO CONSUMIDOR'] },
{ key: '_meter', labels: ['MEDIDOR', 'NUMERO MEDIDOR'] },
{ key: '_number', labels: ['NRO', 'NUMERO'] },
{ key: '_floor', labels: ['PISO'] },
{ key: '_city', labels: ['CODIGO CIUDAD LOCALIDAD'] },
{ key: '_activity', labels: ['ACTIVIDAD'] },
{ key: '_category', labels: ['CATEGORIA'] },
{ key: '_reading', labels: ['FECHA DE LECTURA'] }];


function normalizarElectricidadMes(valor) {
  const normalizado = normalizar(valor);
  const coincidencia = /\b(ENERO|ENE|FEBRERO|FEB|MARZO|MAR|ABRIL|ABR|MAYO|MAY|JUNIO|JUN|JULIO|JUL|AGOSTO|AGO|SEPTIEMBRE|SETIEMBRE|SEP|SET|OCTUBRE|OCT|NOVIEMBRE|NOV|DICIEMBRE|DIC)\s*[-/. ]\s*(20\d{2}|\d{2})\b/.exec(normalizado);
  if (!coincidencia) return '';
  const anio = coincidencia[2].length === 2 ? `20${coincidencia[2]}` : coincidencia[2];
  return `${anio}-${String(ELECTRICIDAD_MESES[coincidencia[1]]).padStart(2, '0')}`;
}

function validarElectricidadEspacialValor(clave, palabras) {
  const valor = palabras.map((palabra) => palabra.text).join(' ').trim();
  if (clave === 'billingMonth') return normalizarElectricidadMes(valor);
  if (clave === 'serviceAddress') {
    return valor.length >= 6 && valor.length <= 150 && /[A-Z]{2,}/.test(valor) &&
    !/^(?:MES|FECHA|CODIGO|ACTIVIDAD|CATEGORIA)\b/.test(valor) ? valor : '';
  }
  return '';
}

function analizarFacturaElectricidad(texto, opciones = {}) {
  const resultado = { serviceAddress: '', billingMonth: '' };
  const lineas = normalizarLineas(texto);
  const cabeceraIndice = lineas.findIndex((linea) => /DATOS\s+DEL\s+CONSUMIDOR/.test(linea));
  if (cabeceraIndice !== -1) {
    const paradaDesplazamiento = lineas.slice(cabeceraIndice + 1).findIndex((linea) =>
    /^(?:FECHA\s+DE\s+LECTURA|DETALLE\s+DE\s+IMPORTES)\b/.test(linea));
    const seccion = lineas.slice(cabeceraIndice + 1,
    paradaDesplazamiento === -1 ? cabeceraIndice + 21 : cabeceraIndice + 1 + paradaDesplazamiento);
    for (let indice = 0; indice < seccion.length; indice++) {
      const direccion = /^DIRECCION\s*[:.]\s*(.*)$/.exec(seccion[indice]);
      if (direccion && !resultado.serviceAddress) {
        const candidato = (direccion[1] || seccion[indice + 1] || '').
        split(/\s+(?=(?:NRO|NUMERO|PISO|CODIGO|ACTIVIDAD|CATEGORIA|MES)\s*[:.])/)[0].
        trim();
        resultado.serviceAddress = validarElectricidadEspacialValor('serviceAddress', [{ text: candidato }]);
      }
      const mes = /^MES\s*[:.]\s*(.*)$/.exec(seccion[indice]);
      if (mes && !resultado.billingMonth) {
        resultado.billingMonth = normalizarElectricidadMes(mes[1] || seccion[indice + 1] || '');
      }
    }
  }

  const filas = construirRuatFilas(opciones.words);
  const consumerCabecera = filas.findIndex((fila) => /DATOS\s+DEL\s+CONSUMIDOR/.test(fila.text));
  if (consumerCabecera !== -1) {
    let fin = filas.findIndex((fila, indice) => indice > consumerCabecera &&
    /(?:FECHA\s+DE\s+LECTURA|DETALLE\s+DE\s+IMPORTES)/.test(fila.text));
    if (fin === -1) fin = Math.min(filas.length, consumerCabecera + 21);
    const seccionPalabras = filas.slice(consumerCabecera + 1, fin).flatMap((fila) => fila.words);
    Object.assign(resultado, extraerEtiquetadoEspacialCampos(
      seccionPalabras, ELECTRICIDAD_ESPACIAL_DEFINICIONES, validarElectricidadEspacialValor
    ));
  }
  return resultado;
}

// ─── Mapeo clase RUAT → tipo de vehículo de la app ───────────────────────────
const CAPACIDAD_PREDETERMINADA = { taxi: 4, minibus: 14, bus: 35, motocicleta: 1 };

function mapaClaseHastaVehiculoTipo(cls) {
  const c = stripAccents(cls || '');
  if (/MOTOCICLETA|MOTOCARRO|CUADRATRACK|MOTONETA|MOTOTAXI/.test(c)) return 'motocicleta';
  if (/MINIBUS|MINI BUS|MICROBUS|MICRO BUS/.test(c)) return 'minibus';
  if (/OMNIBUS|AUTOBUS|BUS|FLOTA/.test(c)) return 'bus';
  return 'taxi';
}

// ─── Parser: RUAT ────────────────────────────────────────────────────────────
function validoRuatPropietarioNombre(valor) {
  const nombre = normalizar(valor);
  return /^[A-Z]{2,}(?:\s+[A-Z]{2,}){1,5}$/.test(nombre) &&
  !nombre.split(' ').some((token) => ETIQUETA_PALABRA_RE.test(token) ||
  /^(?:PROPIETARIO|DATOS|DOCUMENTO|IDENTIDAD|PMC|TIPO|CONTRIBUYENTE|GAS|NATURAL)$/.test(token)) ?
  nombre : '';
}

const RUAT_ESPACIAL_DEFINICIONES = [
{ key: 'vehiclePlate', labels: ['PLACA'] },
{ key: 'crpvaNumber', labels: ['CRPVA'] },
{ key: 'vehicleBrand', labels: ['MARCA'] },
{ key: 'vehicleModel', labels: ['TIPO VEHICULO'] },
{ key: 'vehicleYear', labels: ['MODELO', 'ANO MODELO'] },
{ key: 'vehicleClass', labels: ['CLASE'] },
{ key: 'vehicleColor', labels: ['COLOR'] },
{ key: 'vehiclePassengerCapacity', labels: ['NUMERO PLAZAS', 'NUMERO DE PLAZAS', 'NRO PLAZAS'] },
{ key: 'doorCount', labels: ['NUMERO PUERTAS', 'NUMERO DE PUERTAS', 'NRO PUERTAS'] },
{ key: 'serviceType', labels: ['SERVICIO'] },
{ key: 'chassisNumber', labels: ['NUMERO CHASIS', 'NUMERO DE CHASIS', 'CHASIS'] },
{ key: 'engineNumber', labels: ['NUMERO MOTOR', 'NUMERO DE MOTOR'] },
{ key: 'fuelType', labels: ['COMBUSTIBLE'] },
{ key: 'engineDisplacement', labels: ['CILINDRADA'] },
{ key: 'engineType', labels: ['TIPO MOTOR'] },
{ key: 'vehicleOwnerName', labels: ['PROPIETARIO'] },
{ key: 'vehicleOwnerCi', labels: ['DOCUMENTO IDENTIDAD', 'DOCUMENTO DE IDENTIDAD'] },
{ key: 'ruatIssueDate', labels: ['FECHA EMISION', 'FECHA DE EMISION'] },
{ key: 'ownershipStartDate', labels: ['FECHA REGISTRO PROPIEDAD', 'FECHA INICIO PROPIEDAD'] },
{ key: 'registrationMunicipality', labels: ['RADICATORIA', 'MUNICIPIO'] },
{ key: 'legalObservations', labels: ['OBSERVACIONES'] },
// Boundaries: these are labels in the form, not values of nearby fields.
{ key: '_subtype', labels: ['SUBTIPO VEHICULO'] },
{ key: '_body', labels: ['TIPO CARROCERIA'] },
{ key: '_taxpayer', labels: ['TIPO CONTRIBUYENTE'] },
{ key: '_policy', labels: ['TIPO POLIZA'] },
{ key: '_pmc', labels: ['PMC'] }];


function construirRuatFilas(palabras) {
  const sorted = (Array.isArray(palabras) ? palabras : []).
  map((palabra) => ({
    text: normalizar(palabra.text),
    x: Number(palabra.x), y: Number(palabra.y),
    w: Number(palabra.w), h: Number(palabra.h)
  })).
  filter((palabra) => palabra.text && Number.isFinite(palabra.x) && Number.isFinite(palabra.y) &&
  Number.isFinite(palabra.w) && Number.isFinite(palabra.h) && palabra.w > 0 && palabra.h > 0).
  map((palabra) => ({ ...palabra, clean: palabra.text.replace(/[^A-Z0-9]/g, '') })).
  filter((palabra) => palabra.clean).
  sort((primero, segundo) => primero.y + primero.h / 2 - segundo.y - segundo.h / 2);
  const filas = [];
  for (const palabra of sorted) {
    const cy = palabra.y + palabra.h / 2;
    let fila = filas.find((r) => Math.abs(r.cy - cy) <= 0.55 * Math.min(r.h, palabra.h) + 2);
    if (!fila) {
      fila = { cy, h: palabra.h, words: [] };
      filas.push(fila);
    }
    fila.words.push(palabra);
    fila.cy += (cy - fila.cy) / fila.words.length;
    fila.h = mediana(fila.words.map((w) => w.h));
  }
  for (const fila of filas) {
    fila.words.sort((primero, segundo) => primero.x - segundo.x);
    fila.text = fila.words.map((palabra) => palabra.text).join(' ');
    fila.y0 = Math.min(...fila.words.map((w) => w.y));
    fila.y1 = Math.max(...fila.words.map((w) => w.y + w.h));
  }
  return filas.sort((primero, segundo) => primero.y0 - segundo.y0);
}

function validarRuatEspacialValor(clave, palabras) {
  const valor = palabras.map((palabra) => palabra.text).join(' ').trim();
  if (!valor) return '';
  const compact = valor.replace(/\s+/g, '');
  if (clave === 'vehiclePlate') return /^(?:\d{3,4}[A-Z]{3}|[A-Z]{2}\d{4})$/.test(compact) ? compact : '';
  if (clave === 'crpvaNumber') return /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{6,12}$/.test(compact) ? compact : '';
  if (clave === 'vehicleYear') return /^(?:19[5-9]\d|20[0-2]\d)$/.test(compact) ? compact : '';
  if (clave === 'ruatIssueDate' || clave === 'ownershipStartDate') return buscarFechas(valor)[0] || '';
  if (clave === 'vehiclePassengerCapacity' || clave === 'doorCount') {
    return /^\d{1,2}$/.test(compact) ? compact : '';
  }
  if (clave === 'vehicleOwnerCi') {
    const coincidencia = /^(?:CI\s*)?(\d{5,10})\s*([A-Z]{2})?$/.exec(valor);
    return coincidencia ? `${coincidencia[1]}${coincidencia[2] || ''}` : '';
  }
  if (clave === 'chassisNumber' || clave === 'engineNumber') {
    const minimo = clave === 'chassisNumber' ? 15 : 5;
    return new RegExp(`^(?=.*\\d)[A-Z0-9]{${minimo},20}$`).test(compact) ? compact : '';
  }
  if (clave === 'engineDisplacement') return /^\d{3,5}\s*CC\.?$/.test(valor) ? valor : '';
  if (clave === 'vehicleOwnerName') return validoRuatPropietarioNombre(valor);
  if (clave === 'vehicleBrand' || clave === 'vehicleModel' || clave === 'vehicleColor' ||
  clave === 'vehicleClass' || clave === 'serviceType' || clave === 'fuelType' ||
  clave === 'engineType' || clave === 'registrationMunicipality') {
    if (!/^[A-Z]+(?:\s+[A-Z]+){0,2}$/.test(valor)) return '';
    if (valor.split(' ').some((token) => ETIQUETA_PALABRA_RE.test(token))) return '';
    return valor;
  }
  if (clave === 'legalObservations') return valor.length <= 100 ? valor : '';
  return '';
}

function extraerRuatEspacialCampos(palabras) {
  const filas = construirRuatFilas(palabras);
  const fuera = {};
  for (let filaIndice = 0; filaIndice < filas.length; filaIndice++) {
    const fila = filas[filaIndice];
    const etiquetas = buscarEtiquetaOccurrences(fila, RUAT_ESPACIAL_DEFINICIONES);
    for (const etiqueta of etiquetas) {
      const clave = etiqueta.def.key;
      if (clave.startsWith('_') || fuera[clave]) continue;
      if (clave === 'vehicleOwnerName' &&
      ['DATOS', 'FIRMA', 'IDENTIFICACION'].includes(fila.words[etiqueta.start - 1]?.clean)) continue;
      const siguienteEtiqueta = etiquetas.find((otro) => otro.start > etiqueta.end);
      const fin = siguienteEtiqueta ? siguienteEtiqueta.start : fila.words.length;
      const etiquetaDerecha = fila.words[etiqueta.end].x + fila.words[etiqueta.end].w;
      const maximoDerecha = etiquetaDerecha + 18 * fila.h;
      const derecha = fila.words.slice(etiqueta.end + 1, fin).filter((palabra) => palabra.x <= maximoDerecha);
      let valor = validarRuatEspacialValor(clave, derecha);
      if (!valor) {
        const siguiente = filas[filaIndice + 1];
        if (siguiente && siguiente.y0 - fila.y1 <= 2.5 * fila.h) {
          const izquierda = fila.words[etiqueta.start].x - 2 * fila.h;
          const limite = siguienteEtiqueta ? fila.words[siguienteEtiqueta.start].x : etiquetaDerecha + 18 * fila.h;
          const debajo = siguiente.words.filter((palabra) => palabra.x >= izquierda && palabra.x < limite);
          valor = validarRuatEspacialValor(clave, debajo);
        }
      }
      if (valor) fuera[clave] = valor;
    }
  }
  return fuera;
}

function analizarRuat(texto, opciones = {}) {
  const resultado = {
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
    engineDisplacement: '', engineType: '', legalObservations: ''
  };

  const lineas = normalizarLineas(texto);
  const paradaEnSiguienteEtiqueta = /\s+(?=(?:PLACA|CRPVA|CLASE|MARCA|TIPO\s+VEHICULO|SUBTIPO\s+VEHICULO|TIPO\s+CARROCERIA|TIPO\s+CONTRIBUYENTE|MODELO|NUMERO\s+(?:MOTOR|CHASIS|PUERTAS|PLAZAS)|SERVICIO|COLOR|COMBUSTIBLE|CILINDRADA|TIPO\s+MOTOR|PROPIETARIO|DOCUMENTO\s+IDENTIDAD|FECHA\s+(?:EMISION|REGISTRO\s+PROPIEDAD)|OBSERVACIONES)\s*[:.])/i;
  const campo = (etiquetas, permitirSiguienteLinea = false) => {
    for (let indice = 0; indice < lineas.length; indice++) {
      for (const etiqueta of etiquetas) {
        const coincidencia = new RegExp(`\\b(?:${etiqueta})\\s*[:.]?\\s*`, 'i').exec(lineas[indice]);
        if (!coincidencia) continue;
        const despues = lineas[indice].slice(coincidencia.index + coincidencia[0].length).split(paradaEnSiguienteEtiqueta)[0].trim();
        if (despues) return despues;
        if (permitirSiguienteLinea && indice + 1 < lineas.length && !/^(?:[A-Z ]{2,30})\s*[:.]/.test(lineas[indice + 1])) {
          return lineas[indice + 1];
        }
      }
    }
    return '';
  };
  const fechaCampo = (etiquetas) => {
    const fechas = buscarFechas(campo(etiquetas, true));
    return fechas[0] || '';
  };
  const primeroNumero = (valor) => (String(valor).match(/\b\d{1,4}\b/) || [])[0] || '';

  // Placa: priorizar el casillero PLACA, no números repetidos del talón superior.
  const rePlaca = /\b([A-Z]{2}\s?\d{4}|\d{3,4}\s?[A-Z]{3})\b/;
  const mp = campo(['PLACA']).match(rePlaca) || texto.toUpperCase().match(rePlaca);
  if (mp) {
    resultado.vehiclePlate = mp[1].replace(/\s+/g, '');
  } else {
    const viaKeyword = valorDespuesKeyword(texto, ['PLACA', 'NO DE PLACA', 'NUMERO DE PLACA']);
    const km = viaKeyword.match(/[A-Z0-9]{4,8}/);
    if (km) resultado.vehiclePlate = km[0];
  }

  resultado.vehicleBrand = campo(['MARCA'], true);
  const modeloCampo = campo(['MODELO'], true);
  const tipoVehiculo = campo(['TIPO\\s+VEHICULO'], true);
  resultado.vehicleModel = /^\d{4}$/.test(modeloCampo) ? tipoVehiculo : modeloCampo || tipoVehiculo;
  resultado.vehicleColor = campo(['COLOR'], true);
  resultado.vehicleOwnerName = validoRuatPropietarioNombre(campo(
    ['PROPIETARIO\\s*:', 'NOMBRE\\s+DEL\\s+PROPIETARIO\\s*:'], false
  ).replace(/\s+(?:TIPO\s+CONTRIBUYENTE|DOCUMENTO\s+IDENTIDAD)\b.*$/, '').trim());
  const propietarioCiBruto = campo(['DOCUMENTO\\s+IDENTIDAD', 'CI\\s+PROPIETARIO', 'CEDULA\\s+DE\\s+IDENTIDAD'], true);
  const propietarioCiCoincidencia = propietarioCiBruto.match(/\bCI\s*[:.]?\s*(\d{5,10})\s*([A-Z]{2})?\b/i);
  resultado.vehicleOwnerCi = propietarioCiCoincidencia ? `${propietarioCiCoincidencia[1]}${propietarioCiCoincidencia[2] || ''}` : '';
  resultado.vehicleClass = campo(['CLASE', 'CLASE\\s+DE\\s+VEHICULO'], true);
  resultado.registrationMunicipality = campo(['RADICATORIA', 'MUNICIPIO'], true);
  if (!resultado.registrationMunicipality) {
    const municipalIndice = lineas.findIndex((linea) => /GOBIERNO\s+MUNICIPAL\b/.test(linea));
    const municipal = lineas[municipalIndice] || '';
    resultado.registrationMunicipality = municipal.match(/GOBIERNO\s+MUNICIPAL\s+([A-Z ]+)/)?.[1]?.trim() || (
    municipalIndice !== -1 && /^[A-Z ]{3,40}$/.test(lineas[municipalIndice + 1] || '') ? lineas[municipalIndice + 1] : '');
  }
  resultado.crpvaNumber = campo(['CRPVA\\s*:', 'NUMERO\\s+CRPVA', 'NRO\\s+CRPVA']).match(/\b[A-Z0-9]{6,12}\b/)?.[0] || '';
  resultado.ruatIssueDate = fechaCampo(['FECHA\\s+(?:DE\\s+)?EMISION', 'EMISION']);
  resultado.ownershipStartDate = fechaCampo(['FECHA\\s+REGISTRO\\s+PROPIEDAD', 'FECHA\\s+INICIO\\s+PROPIEDAD', 'INICIO\\s+PROPIEDAD']);
  resultado.doorCount = primeroNumero(campo(['NUMERO\\s+PUERTAS', 'NRO\\s+PUERTAS'], true));
  resultado.serviceType = campo(['TIPO\\s+SERVICIO', 'SERVICIO'], true);
  resultado.chassisNumber = campo(['NUMERO\\s+CHASIS', 'NRO\\s+CHASIS', 'CHASIS'], true).match(/\b[A-Z0-9]{10,20}\b/)?.[0] || '';
  resultado.engineNumber = campo(['NUMERO\\s+MOTOR', 'NRO\\s+MOTOR'], true).match(/\b[A-Z0-9]{5,20}\b/)?.[0] || '';
  resultado.fuelType = campo(['COMBUSTIBLE'], true);
  resultado.engineDisplacement = campo(['CILINDRADA'], true);
  resultado.engineType = campo(['TIPO\\s+MOTOR'], true);
  resultado.legalObservations = campo(['OBSERVACIONES', 'RESTRICCIONES'], true);
  if (/^(III\.?\s*)?OBSERVACIONES$/.test(resultado.legalObservations) || !resultado.legalObservations) {
    const observacionesIndice = lineas.findIndex((linea) => /^(?:III\.?\s*)?OBSERVACIONES\b/.test(linea));
    if (observacionesIndice !== -1) resultado.legalObservations = lineas[observacionesIndice + 1] || '';
  }

  // En este RUAT «Modelo» es el año; «Tipo Vehículo» es la línea comercial.
  resultado.vehicleYear = (modeloCampo.match(/\b(?:19[5-9]\d|20[0-2]\d)\b/) || [])[0] ||
  (campo(['ANO\\s+MODELO', 'MODELO\\s+ANO'], true).match(/\b(?:19[5-9]\d|20[0-2]\d)\b/) || [])[0] || '';

  resultado.vehicleType = mapaClaseHastaVehiculoTipo(resultado.vehicleClass || resultado.vehicleModel);
  resultado.vehiclePassengerCapacity = primeroNumero(campo(['NUMERO\\s+PLAZAS', 'NRO\\s+PLAZAS', 'PLAZAS'], true));

  // Vision puede leer primero todas las etiquetas de la columna izquierda y
  // luego todos los valores de la derecha. En ese caso, no se debe asumir que
  // la línea siguiente a una etiqueta es su valor.
  const exactoLinea = (re) => lineas.find((linea) => re.test(linea)) || '';
  const despuesEtiqueta = (etiqueta, valorPatron) => {
    for (let indice = 0; indice < lineas.length; indice++) {
      const coincidencia = etiqueta.exec(lineas[indice]);
      if (!coincidencia) continue;
      const mismo = lineas[indice].slice(coincidencia[0].length).trim();
      if (valorPatron.test(mismo)) return mismo;
      if (valorPatron.test(lineas[indice + 1] || '')) return lineas[indice + 1];
    }
    return '';
  };
  const exactoPlaca = despuesEtiqueta(/^PLACA\s*[:.]?\s*/, /^\d{3,4}\s?[A-Z]{3}$/) ||
  exactoLinea(/^\d{3,4}\s?[A-Z]{3}$/);
  if (exactoPlaca) resultado.vehiclePlate = exactoPlaca.replace(/\s/g, '');

  const crpva = despuesEtiqueta(/^CRPVA\s*[:.]?\s*/, /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{6,12}$/);
  if (crpva) resultado.crpvaNumber = crpva;

  const knownClase = exactoLinea(/^(?:CAMIONETA|AUTOMOVIL|VAGONETA|MICROBUS|MINIBUS|BUS|MOTOCICLETA)$/);
  if (knownClase) resultado.vehicleClass = knownClase;
  const enLineaBrand = exactoLinea(/^MAR(?:CA|X)\s*:?[ \t]+[A-Z][A-Z ]+$/);
  if (enLineaBrand) resultado.vehicleBrand = enLineaBrand.replace(/^MAR(?:CA|X)\s*:?[ \t]+/, '').trim();
  const enLineaModelo = exactoLinea(/^(?:TIPO|TOS)\s*:?[ \t]+[A-Z][A-Z0-9-]{2,}$/);
  if (enLineaModelo) resultado.vehicleModel = enLineaModelo.replace(/^(?:TIPO|TOS)\s*:?[ \t]+/, '').trim();
  const tipoVehiculoIndice = lineas.findIndex((linea) => /^TIPO\s+VEHICULO\s*[:.]?$/.test(linea));
  if (tipoVehiculoIndice !== -1 && (!resultado.vehicleModel || /^(?:SUBTIPO|TIPO|NUMERO|MODELO)\b/.test(resultado.vehicleModel))) {
    const modelo = lineas.slice(tipoVehiculoIndice + 1, tipoVehiculoIndice + 5).
    filter((linea) => !/^(?:SUBTIPO\s+VEHICULO|MODELO|NUMERO|SERVICIO)\b/.test(linea)).
    find((linea) => /^[A-Z][A-Z0-9-]{2,}$/.test(linea));
    if (modelo) resultado.vehicleModel = modelo;
  }
  const exactoServicio = exactoLinea(/^(?:PUBLICO|PARTICULAR)$/);
  if (exactoServicio) resultado.serviceType = exactoServicio;
  const enLineaServicio = exactoLinea(/^(?:SERVICIO|SARICI)\s*:?[ \t]+(?:PUBLICO|PARTICULAR)$/);
  if (enLineaServicio) resultado.serviceType = enLineaServicio.split(/\s+/).at(-1);
  const exactoColor = exactoLinea(/^(?:ROJO|AZUL|BLANCO|NEGRO|GRIS|PLATA|VERDE|AMARILLO|MOSTAZA|CAFE|GUINDO)$/);
  if (exactoColor) resultado.vehicleColor = exactoColor;
  const enLineaColor = exactoLinea(/^(?:COLOR|C)\s*:?[ \t]+(?:ROJO|AZUL|BLANCO|NEGRO|GRIS|PLATA|VERDE|AMARILLO|MOSTAZA|CAFE|GUINDO)$/);
  if (enLineaColor) resultado.vehicleColor = enLineaColor.split(/\s+/).at(-1);
  const exactoFuel = exactoLinea(/^(?:GAS NATURAL|GASOLINA|DIESEL|GNV|GLP|ELECTRICO)$/);
  if (exactoFuel) resultado.fuelType = exactoFuel;
  const exactoEngineTipo = exactoLinea(/^(?:INYECCION|CARBURADOR|ELECTRICO|HIBRIDO)$/);
  if (exactoEngineTipo) resultado.engineType = exactoEngineTipo;
  const displacement = exactoLinea(/^\d{3,5}\s*CC\.?$/);
  if (displacement) resultado.engineDisplacement = displacement;

  const modeloIndice = lineas.findIndex((linea) => /^MODELO\s*[:.]?$/.test(linea));
  if (!resultado.vehicleYear && modeloIndice !== -1) {
    resultado.vehicleYear = lineas.slice(modeloIndice + 1, modeloIndice + 7).
    find((linea) => /^(?:19[5-9]\d|20[0-2]\d)$/.test(linea)) || '';
  }
  const engineEtiquetaIndice = lineas.findIndex((linea) => /^NUMERO\s+MOTOR\s*[:.]?$/.test(linea));
  if (engineEtiquetaIndice !== -1) {
    const cercano = lineas.slice(engineEtiquetaIndice + 1, engineEtiquetaIndice + 12);
    const engine = cercano.find((linea) => /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{8,14}$/.test(linea));
    const chasis = cercano.find((linea) => /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{15,20}$/.test(linea));
    if (engine) resultado.engineNumber = engine;
    if (chasis) resultado.chassisNumber = chasis;
  }
  const lugaresIndice = lineas.findIndex((linea) => /^NUMERO\s+PLAZAS\s*[:.]?$/.test(linea));
  if (lugaresIndice !== -1) {
    const lugares = lineas.slice(lugaresIndice + 1, lugaresIndice + 5).
    find((linea) => /^\d{1,2}$/.test(linea));
    if (lugares) resultado.vehiclePassengerCapacity = lugares;
  }
  const propietarioSeccionIndice = lineas.findIndex((linea) => /^D\.?\s+DATOS\s+PROPIETARIO$/.test(linea));
  if (propietarioSeccionIndice !== -1) {
    const finDesplazamiento = lineas.slice(propietarioSeccionIndice + 1).findIndex((linea) =>
    /^(?:III\.?\s*)?OBSERVACIONES\b/.test(linea));
    const propietarioLineas = lineas.slice(propietarioSeccionIndice + 1,
    finDesplazamiento === -1 ? Math.min(lineas.length, propietarioSeccionIndice + 81) : propietarioSeccionIndice + 1 + finDesplazamiento);
    const ciLineaIndice = propietarioLineas.findIndex((linea) => /\bCI\s*[:.]?\s*\d{5,10}\b/.test(linea));
    if (ciLineaIndice !== -1) {
      const propietarioCi = /\bCI\s*[:.]?\s*(\d{5,10})\s*([A-Z]{2})?\b/.exec(propietarioLineas[ciLineaIndice]);
      if (propietarioCi) resultado.vehicleOwnerCi = `${propietarioCi[1]}${propietarioCi[2] || ''}`;
      for (let indice = ciLineaIndice - 1; indice >= Math.max(0, ciLineaIndice - 5); indice--) {
        const propietarioNombre = validoRuatPropietarioNombre(propietarioLineas[indice]);
        if (propietarioNombre) {
          resultado.vehicleOwnerName = propietarioNombre;
          break;
        }
      }
    }
  }

  const espacial = extraerRuatEspacialCampos(opciones.words);
  Object.assign(resultado, espacial);
  resultado.vehicleType = mapaClaseHastaVehiculoTipo(resultado.vehicleClass || resultado.vehicleModel);

  return resultado;
}

// ─── Despachador ─────────────────────────────────────────────────────────────
const ANALIZADORES = {
  ciFront: analizarCi,
  ciBack: analizarCi,
  licenseFront: analizarLicencia,
  licenseBack: analizarLicencia,
  ticPhoto: analizarTic,
  soatPhoto: analizarSoat,
  ruatPhoto: analizarRuat,
  antecedentsPhoto: analizarAntecedentes,
  domicileProof: analizarFacturaElectricidad
};

/** Campos requeridos por tipo de documento (para saber si la extracción fue completa). */
const REQUERIDOS_POR_TIPO = {
  ciFront: ['ciNumber', 'firstNames', 'surnames', 'birthDate', 'issueDate', 'expiryDate'],
  ciBack: ['birthPlace', 'address', 'occupation', 'maritalStatus'],
  licenseFront: ['licenseNumber', 'fullName', 'nationality', 'issueDate', 'licenseExpiryDate', 'birthDate', 'licenseCategory'],
  licenseBack: ['licenseNumber', 'issueDate', 'licenseExpiryDate', 'licenseCategory'],
  ticPhoto: ['ticNumber', 'fullName', 'licenseNumber'],
  soatPhoto: ['soatRosetteNumber', 'soatYear', 'soatPlate', 'soatStartDate', 'soatExpiryDate'],
  ruatPhoto: ['vehiclePlate', 'vehicleBrand', 'vehicleModel', 'vehicleYear', 'vehicleColor', 'vehicleOwnerName', 'vehicleOwnerCi'],
  antecedentsPhoto: ['fullName', 'ciNumber', 'backgroundResult', 'issueDate', 'validUntil'],
  domicileProof: ['serviceAddress', 'billingMonth'],
  profilePhoto: [],
  carFront: [],
  carBack: [],
  carLeft: [],
  carRight: []
};
const REQUERIDO_ANTIGUO_CI = {
  ciFront: ['ciNumber', 'issueDate', 'expiryDate'],
  ciBack: ['firstNames', 'surnames', 'birthDate', 'birthPlace', 'address', 'occupation', 'maritalStatus']
};

/**
 * Extrae y parsea el texto de una imagen según su tipo de documento.
 * @param {Buffer} buffer imagen
 * @param {string} documentType uno de los tipos soportados
 * @returns {{fields: object, rawText: string, missing: string[], facesFound: number, rejected: boolean, rejectReason: string, words: Array}}
 */
async function extraerDocumento(buffer, documentoTipo) {
  const { text: brutoTexto, facesFound: rostrosEncontrado, words: palabras } = await anotarImagenBuffer(
    buffer, documentoTipo === 'ciFront' || documentoTipo === 'ciBack'
  );

  const analizador = ANALIZADORES[documentoTipo];
  const campos = analizador ? analizador(brutoTexto, { words: palabras, documentType: documentoTipo }) : {};

  // Validación de tipo/lado (por ahora solo CI)
  let rechazado = false;
  let rechazarMotivo = '';
  let clasificar = null;
  if (documentoTipo === 'ciFront' || documentoTipo === 'ciBack') {
    clasificar = clasificarCI(brutoTexto, rostrosEncontrado);
    const v = validarCi(brutoTexto, rostrosEncontrado, documentoTipo);
    rechazado = v.rejected;
    rechazarMotivo = v.rejectReason;
  } else if (documentoTipo === 'ticPhoto' && !/TARJETA\s+(?:DE\s+)?IDENTIFICACION\s+(?:DEL?\s+)?CONDUCTOR|\bT\.?I\.?C\.?\b/.test(normalizar(brutoTexto))) {
    rechazado = true;
    rechazarMotivo = 'La foto no parece ser una Tarjeta de Identificación del Conductor (TIC).';
  }

  const requerido = campos.format === 'legacy' ?
  REQUERIDO_ANTIGUO_CI[documentoTipo] || [] :
  REQUERIDOS_POR_TIPO[documentoTipo] || [];
  const faltante = requerido.filter(
    (clave) => !campos[clave] || !String(campos[clave]).trim()
  );

  return { fields: campos, rawText: brutoTexto, missing: faltante, facesFound: rostrosEncontrado, rejected: rechazado, rejectReason: rechazarMotivo, words: palabras, classify: clasificar };
}

module.exports = {
  extraerDocumento: extraerDocumento,
  extraerTextoDesdeBuffer: extraerTextoDesdeBuffer,
  anotarImagenBuffer: anotarImagenBuffer,
  analizarCi: analizarCi,
  analizarLicencia: analizarLicencia,
  analizarTic: analizarTic,
  analizarSoat: analizarSoat,
  analizarRuat: analizarRuat,
  analizarAntecedentes: analizarAntecedentes,
  analizarFacturaElectricidad: analizarFacturaElectricidad,
  analizarMrz: analizarMrz,
  clasificarCI: clasificarCI,
  validarCi: validarCi,
  construirFilas: construirFilas,
  mapaClaseAVehiculoTipo: mapaClaseHastaVehiculoTipo,
  CAPACIDAD_PREDETERMINADA: CAPACIDAD_PREDETERMINADA,
  REQUERIDOS_POR_TIPO: REQUERIDOS_POR_TIPO
};
