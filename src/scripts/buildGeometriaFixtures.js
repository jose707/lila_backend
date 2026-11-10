// backend/src/scripts/buildGeometriaFixtures.js
/**
 * Procesa las fotos reales de backend/dev-assets/ una sola vez con Cloud
 * Vision y guarda la respuesta completa ANONIMIZADA (texto + geometría)
 * como fixtures de geometría en src/services/__fixtures__/geometry/.
 *
 * Uso:
 *   1. Copia tus fotos a backend/dev-assets/ci-frontal.jpg y ci-trasera.jpg
 *   2. node src/scripts/buildGeometriaFixtures.js  (o: npm run fixtures:geo)
 *
 * Las imágenes NO se suben al repo; solo texto+geometría anonimizados.
 * Las etiquetas de los documentos se conservan; los valores (nombres,
 * números, fechas) se reemplazan por datos ficticios del mismo tipo/largo.
 */
const fs = require('fs');
const ruta = require('path');
const dotenv = require('dotenv');
const ocrServicio = require("../services/servicioOcr");

dotenv.config({ path: ruta.resolve(__dirname, '../../.env') });

const DEV_ASSETS_DIRECTORIO = ruta.join(__dirname, '../../dev-assets');
const FUERA_DIRECTORIO = ruta.join(__dirname, '../services/__fixtures__/geometry');

const DOCUMENTOS = [
{ base: 'ci-frontal', documentType: 'ciFront', out: 'ci-frontal.geo.js' },
{ base: 'ci-trasera', documentType: 'ciBack', out: 'ci-trasera.geo.js' }];


const IMAGEN_EXTS = ['.jpg', '.jpeg', '.png'];

function buscarImagen(documento) {
  for (const ext of IMAGEN_EXTS) {
    const p = ruta.join(DEV_ASSETS_DIRECTORIO, documento.base + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const limpiarPalabra = (s) =>
(s || '').
normalize('NFD').
replace(/[\u0300-\u036f]/g, '').
toUpperCase().
replace(/[^A-Z0-9]/g, '');

const ETIQUETA_PALABRAS = new Set(
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
  'UNICO', 'NACIONAL', 'RUAT', 'ANO', 'CAPACIDAD', 'PASAJEROS'].
  map(limpiarPalabra)
);

function randInt(minimo, maximo) {
  return minimo + Math.floor(Math.random() * (maximo - minimo + 1));
}

const VOWELS = 'AEIOU';
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';

function aleatorioLetter(forceVowel) {
  return forceVowel ?
  VOWELS[randInt(0, VOWELS.length - 1)] :
  Math.random() < 0.35 ?
  VOWELS[randInt(0, VOWELS.length - 1)] :
  CONSONANTS[randInt(0, CONSONANTS.length - 1)];
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
function fakePalabra(original) {
  const mayuscula = (original || '').
  normalize('NFD').
  replace(/[\u0300-\u036f]/g, '').
  toUpperCase();
  if (!mayuscula) return original;

  if (/^\d+$/.test(mayuscula)) {
    return mayuscula.
    split('').
    map(() => String(randInt(0, 9))).
    join('');
  }

  const fechaCoincidencia = mayuscula.match(/^(\d{1,2})([\/\-.])(\d{1,2})([\/\-.])((?:19|20)?\d{2})$/);
  if (fechaCoincidencia) {
    const dia = String(randInt(1, 28)).padStart(fechaCoincidencia[1].length, '0');
    const mes = String(randInt(1, 12)).padStart(fechaCoincidencia[3].length, '0');
    const anio =
    fechaCoincidencia[5].length === 2 ?
    String(randInt(50, 99)) :
    (Math.random() < 0.5 ? '19' : '20') + String(randInt(20, 99));
    return `${dia}${fechaCoincidencia[2]}${mes}${fechaCoincidencia[4]}${anio}`;
  }

  // Línea MRZ de número de documento: conservar "IDBOL"/"IDB0L"
  if (/^IDB[0O]L/.test(mayuscula)) {
    const rest = mayuscula.
    slice(5).
    split('').
    map((caracter) => {
      if (/[0-9]/.test(caracter)) return String(randInt(0, 9));
      if (/[A-Z]/.test(caracter)) return aleatorioLetter(false);
      return caracter;
    }).
    join('');
    return mayuscula.slice(0, 5) + rest;
  }

  if (/^\d{6}/.test(mayuscula) && /[A-Z<]/.test(mayuscula)) {
    const yy = String(randInt(50, 99));
    const mm = String(randInt(1, 12)).padStart(2, '0');
    const dd = String(randInt(1, 28)).padStart(2, '0');
    const rest = mayuscula.
    slice(6).
    split('').
    map((caracter) => {
      if (/[0-9]/.test(caracter)) return String(randInt(0, 9));
      if (/[A-Z]/.test(caracter)) return aleatorioLetter(false);
      return caracter;
    }).
    join('');
    return yy + mm + dd + rest;
  }

  if (/\d/.test(mayuscula) && /[A-Z]/.test(mayuscula)) {
    return mayuscula.
    split('').
    map((caracter) => {
      if (/[0-9]/.test(caracter)) return String(randInt(0, 9));
      if (/[A-Z]/.test(caracter)) return aleatorioLetter(false);
      return caracter;
    }).
    join('');
  }

  const tieneVowel = /[AEIOU]/.test(mayuscula);
  let fake = mayuscula.
  split('').
  map((caracter, indice) => {
    if (!/[A-Z]/.test(caracter)) return caracter;
    return aleatorioLetter(!tieneVowel && indice === 0);
  }).
  join('');
  if (fake.length >= 2 && !/[AEIOU]/.test(fake)) {
    const arr = fake.split('');
    arr[arr.length - 1] = VOWELS[randInt(0, VOWELS.length - 1)];
    fake = arr.join('');
  }
  if (ETIQUETA_PALABRAS.has(limpiarPalabra(fake))) fake += 'ZQ';
  return fake;
}

function anonymizePalabras(palabras) {
  return palabras.map((w) => {
    const texto = (w.text || '').trim();
    if (!texto) return w;
    const kept = ETIQUETA_PALABRAS.has(limpiarPalabra(texto));
    return { ...w, text: kept ? texto : fakePalabra(texto) };
  });
}

async function principal() {
  fs.mkdirSync(FUERA_DIRECTORIO, { recursive: true });
  let procesado = 0;

  for (const documento of DOCUMENTOS) {
    const imagenRuta = buscarImagen(documento);
    if (!imagenRuta) {
      console.log(
        `⏭️  ${documento.base}.jpg/.jpeg/.png no existe en backend/dev-assets/. Se omite.`
      );
      continue;
    }
    console.log(`🔍 Procesando ${ruta.basename(imagenRuta)} con Cloud Vision…`);
    try {
      const buffer = fs.readFileSync(imagenRuta);
      const { fields: campos, missing: faltante, rejected: rechazado, rejectReason: rechazarMotivo, words: palabras } =
      await ocrServicio.extraerDocumento(buffer, documento.documentType);
      if (!palabras.length) {
        console.log(
          `❌ ${ruta.basename(imagenRuta)}: Vision no devolvió geometría de palabras.`
        );
        continue;
      }

      const anonPalabras = anonymizePalabras(palabras);
      const brutoTexto = ocrServicio.
      construirFilas(anonPalabras).
      map((r) => r.text).
      join('\n');

      const contenido = {
        documentType: documento.documentType,
        generatedAt: new Date().toISOString(),
        sourceFile: ruta.basename(imagenRuta),
        fieldsDetected: Object.keys(campos).filter((k) => campos[k]),
        missing: faltante,
        rejected: rechazado,
        rejectReason: rechazado ? rechazarMotivo : '',
        words: anonPalabras,
        rawText: brutoTexto
      };

      const fueraRuta = ruta.join(FUERA_DIRECTORIO, documento.out);
      fs.writeFileSync(
        fueraRuta,
        `module.exports = ${JSON.stringify(contenido, null, 2)};\n`
      );
      console.log(
        `✅ ${documento.out} — campos: ${contenido.fieldsDetected.join(', ') || '(ninguno)'} · palabras: ${palabras.length}`
      );
      procesado++;
    } catch (error) {
      console.error(`❌ Error procesando ${ruta.basename(imagenRuta)}: ${error.message}`);
    }
  }

  console.log(
    procesado ?
    'Listo. Los fixtures de geometría quedaron en src/services/__fixtures__/geometry/.' :
    'Coloca ci-frontal.jpg y ci-trasera.jpg en backend/dev-assets/ y vuelve a ejecutar.'
  );
}

principal();
