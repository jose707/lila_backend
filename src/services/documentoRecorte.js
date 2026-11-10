const sharp = require('sharp');

// Generous center crop for callers that request cropping without camera geometry.
const OCR_ALTERNATIVA_RECORTE = { x: 0.1, y: 0.14, w: 0.8, h: 0.66 };
// Valor experimental para la microimpresión del CI anterior. Se ajustará
// tras comparar la vista previa con varias capturas reales.
const CI_OCR_UMBRAL = 128;
// El anverso necesita conservar etiquetas claras sin alterar el reverso.
const CI_FRONTAL_UMBRAL = 128;
// El umbral general borra algunos trazos iniciales de las etiquetas del
// reverso antiguo. Solo esa franja admite un umbral ligeramente mayor.
const CI_REVERSO_ETIQUETA_UMBRAL = 128;
const CI_REVERSO_ETIQUETA_ANCHO_FRACTION = 0.24;

function analizarRecorteRectangulo(cuerpo, prefijo) {
  if (!cuerpo || typeof cuerpo !== 'object') return null;
  const valores = ['X', 'Y', 'W', 'H', 'ScreenW', 'ScreenH'].map((clave) =>
  Number.parseFloat(cuerpo[`${prefijo}Crop${clave}`])
  );
  if (!valores.every(Number.isFinite)) return null;
  const [x, y, w, h, pantallaW, pantallaH] = valores;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || pantallaW <= 0 || pantallaH <= 0) return null;
  if ([x, y, w, h, pantallaW, pantallaH].some((valor) => valor > 10000)) return null;
  if (x + w > pantallaW * 1.05 || y + h > pantallaH * 1.05) return null;
  return { x, y, w, h, screenW: pantallaW, screenH: pantallaH };
}

// Apply only the orientation encoded by the camera in EXIF before cropping.
// Never infer a quarter-turn from aspect ratio: the camera output is locked to
// the portrait interface, and an inferred turn can invert a document.
async function aplicarCamaraExifOrientacion(buffer) {
  return sharp(buffer, { limitInputPixels: 24000000 }).rotate().toBuffer();
}

/**
 * Crop an image using the camera frame expressed in screen coordinates.
 * rect: { screenW, screenH, x, y, w, h }.
 */
async function recorteHastaFotograma(buffer, rectangulo, margen = 0.1) {
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) throw new Error('Imagen sin dimensiones.');
  const imagenW = meta.width;
  const imagenH = meta.height;
  let norm;
  if (rectangulo) {
    const { screenW: pantallaW, screenH: pantallaH, x, y, w, h } = rectangulo;
    const s = Math.min(imagenW / pantallaW, imagenH / pantallaH);
    const mostrarW = imagenW / s;
    const mostrarH = imagenH / s;
    const offX = (mostrarW - pantallaW) / 2;
    const offY = (mostrarH - pantallaH) / 2;
    let x0 = (offX + x) * s;
    let y0 = (offY + y) * s;
    let x1 = (offX + x + w) * s;
    let y1 = (offY + y + h) * s;
    const mx = (x1 - x0) * margen;
    const miSuperior = (y1 - y0) * margen;
    const miInferior = (y1 - y0) * margen;
    x0 = Math.max(0, x0 - mx);
    y0 = Math.max(0, y0 - miSuperior);
    x1 = Math.min(imagenW, x1 + mx);
    y1 = Math.min(imagenH, y1 + miInferior);
    norm = {
      x: x0 / imagenW,
      y: y0 / imagenH,
      w: (x1 - x0) / imagenW,
      h: (y1 - y0) / imagenH
    };
  } else {
    norm = OCR_ALTERNATIVA_RECORTE;
  }
  const izquierda = Math.round(imagenW * norm.x);
  const superior = Math.round(imagenH * norm.y);
  const ancho = Math.min(Math.round(imagenW * norm.w), imagenW - izquierda);
  const alto = Math.min(Math.round(imagenH * norm.h), imagenH - superior);
  if (ancho <= 0 || alto <= 0) throw new Error('El marco de recorte quedó fuera de la imagen.');
  return await sharp(buffer).
  extract({ left: izquierda, top: superior, width: ancho, height: alto }).
  toBuffer();
}

async function recorteParaOcr(buffer, rectangulo, margen = 0.1) {
  try {
    return await sharp(await recorteHastaFotograma(buffer, rectangulo, margen)).
    grayscale().normalize().toBuffer();
  } catch (error) {
    console.warn('No se pudo recortar la imagen para OCR:', error.message);
    return buffer;
  }
}

async function prepararDocumentoImagen(buffer, rectangulo) {
  const orientada = await aplicarCamaraExifOrientacion(buffer);
  const imagen = rectangulo ? await recorteHastaFotograma(orientada, rectangulo, 0.05) : orientada;
  return sharp(imagen).png().toBuffer();
}

async function prepararCiParaOcr(buffer, rectangulo, lado = 'ciFront') {
  const imagen = await prepararDocumentoImagen(buffer, rectangulo);
  // Una sola versión para Vision y la vista previa. Sin normalización global:
  // evita realzar la microimpresión del fondo.
  const umbral = lado === 'ciFront' ? CI_FRONTAL_UMBRAL : CI_OCR_UMBRAL;
  const base = await sharp(imagen).grayscale().threshold(umbral).png().toBuffer();
  if (lado !== 'ciBack') return base;

  const { width: ancho, height: alto } = await sharp(imagen).metadata();
  if (!ancho || !alto) return base;
  const etiquetaAncho = Math.min(ancho, Math.max(1, Math.round(ancho * CI_REVERSO_ETIQUETA_ANCHO_FRACTION)));
  const etiquetas = await sharp(imagen).
  extract({ left: 0, top: 0, width: etiquetaAncho, height: alto }).
  grayscale().threshold(CI_REVERSO_ETIQUETA_UMBRAL).png().toBuffer();
  return sharp(base).composite([{ input: etiquetas, left: 0, top: 0 }]).png().toBuffer();
}

module.exports = {
  prepararDocumentoImagen,
  recorteAFotograma: recorteHastaFotograma, recorteParaOcr: recorteParaOcr, analizarRecorteRectangulo: analizarRecorteRectangulo, aplicarCamaraExifOrientacion: aplicarCamaraExifOrientacion,
  prepararCiParaOcr: prepararCiParaOcr, CI_OCR_UMBRAL: CI_OCR_UMBRAL, CI_FRONTAL_UMBRAL: CI_FRONTAL_UMBRAL, CI_REVERSO_ETIQUETA_UMBRAL: CI_REVERSO_ETIQUETA_UMBRAL
};
