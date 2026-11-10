const fs = require('fs');
const sharp = require('sharp');
const path = require('path');
const { analizarRecorteRectangulo, recorteAFotograma } = require('./documentoRecorte');

const CONDUCTOR_OCR_DOCUMENTS = new Set([
'licenseFront', 'licenseBack', 'ticPhoto', 'ruatPhoto', 'soatPhoto', 'antecedentsPhoto',
'domicileProof']
);
const OCR_CONTRAST = 1.5;

// Se aplica una sola vez al recibir el documento; OCR y revisión leen el archivo guardado.
async function prepararConductorOcrImagen(archivoRuta, tipo, recorte) {
  if (!CONDUCTOR_OCR_DOCUMENTS.has(tipo)) throw new Error('Tipo de documento no admitido para OCR.');
  let imagen = sharp(await fs.promises.readFile(archivoRuta), { limitInputPixels: 24000000 }).rotate();
  if (recorte) {
    const orientada = await imagen.toBuffer();
    imagen = sharp(await recorteAFotograma(orientada, recorte, 0.05));
  }
  return imagen.
  resize({ width: 4000, height: 4000, fit: 'inside', withoutEnlargement: true })
  // RGB contrast centered on mid-gray; keep color and fine print.
  .linear(OCR_CONTRAST, (1 - OCR_CONTRAST) * 127.5).
  jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
}

async function guardarImagenesConductor(archivos, cuerpo = {}) {
  for (const tipo of CONDUCTOR_OCR_DOCUMENTS) {
    for (const archivo of archivos?.[tipo] || []) {
      const origen = archivo.path || path.join(__dirname, '../uploads/drivers', archivo.filename);
      const imagen = await prepararConductorOcrImagen(origen, tipo, analizarRecorteRectangulo(cuerpo, tipo));
      const destino = origen + '.jpg';
      await fs.promises.writeFile(destino, imagen, { flag: 'wx' });
      await fs.promises.unlink(origen);
      archivo.path = destino;
      archivo.filename = path.basename(destino);
      archivo.mimetype = 'image/jpeg';
      archivo.size = imagen.length;
    }
  }
}

module.exports = { guardarImagenesConductor, CONDUCTOR_OCR_DOCUMENTOS: CONDUCTOR_OCR_DOCUMENTS, prepararConductorOcrImagen: prepararConductorOcrImagen };
