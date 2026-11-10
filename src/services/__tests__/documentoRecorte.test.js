const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const sharp = require('sharp');
const {
  analizarRecorteRectangulo: analizarRecorteRectangulo, recorteAFotograma: recorteHastaFotograma, aplicarCamaraExifOrientacion: aplicarCamaraExifOrientacion,
  prepararCiParaOcr: prepararCiParaOcr, CI_OCR_UMBRAL: CI_OCR_UMBRAL, CI_FRONTAL_UMBRAL: CI_FRONTAL_UMBRAL, CI_REVERSO_ETIQUETA_UMBRAL: CI_REVERSO_ETIQUETA_UMBRAL
} = require("../documentoRecorte");

test('parses the same side-specific camera crop fields used by identity upload', () => {
  comprobar.deepEqual(analizarRecorteRectangulo({
    ciFrontCropX: '20', ciFrontCropY: '30', ciFrontCropW: '300', ciFrontCropH: '190',
    ciFrontCropScreenW: '400', ciFrontCropScreenH: '800'
  }, 'ciFront'), { x: 20, y: 30, w: 300, h: 190, screenW: 400, screenH: 800 });
});

test('rejects invalid or out-of-frame camera crop metadata', () => {
  comprobar.equal(analizarRecorteRectangulo({ ciBackCropX: '-1' }, 'ciBack'), null);
  comprobar.equal(analizarRecorteRectangulo({
    ciBackCropX: '350', ciBackCropY: '0', ciBackCropW: '100', ciBackCropH: '100',
    ciBackCropScreenW: '400', ciBackCropScreenH: '800'
  }, 'ciBack'), null);
});

test('crops the camera overlay from a cover-sized photo without turning it grayscale', async () => {
  const foto = await sharp({ create: {
      width: 400, height: 300, channels: 3, background: '#d14b2f'
    } }).png().toBuffer();
  const recortado = await recorteHastaFotograma(foto, {
    screenW: 100, screenH: 200, x: 20, y: 50, w: 60, h: 100
  }, 0);
  const metadatos = await sharp(recortado).metadata();
  comprobar.equal(metadatos.width, 90);
  comprobar.equal(metadatos.height, 150);
  comprobar.equal(metadatos.channels, 3);
});

test('a horizontal document frame produces a horizontal crop from a portrait photo', async () => {
  const foto = await sharp({ create: {
      width: 300, height: 400, channels: 3, background: '#eeeeee'
    } }).png().toBuffer();
  const recortado = await recorteHastaFotograma(foto, {
    screenW: 300, screenH: 400, x: 20, y: 120, w: 260, h: 164
  }, 0.05);
  const metadatos = await sharp(recortado).metadata();
  comprobar.ok(metadatos.width > metadatos.height);
});

test('never infers an extra rotation from the photo aspect ratio', async () => {
  const foto = await sharp({ create: {
      width: 400, height: 300, channels: 3, background: '#123456'
    } }).png().toBuffer();
  const orientado = await aplicarCamaraExifOrientacion(foto);
  const metadatos = await sharp(orientado).metadata();
  comprobar.equal(metadatos.width, 400);
  comprobar.equal(metadatos.height, 300);
});

test('keeps an already portrait camera photo upright', async () => {
  const foto = await sharp({ create: {
      width: 300, height: 400, channels: 3, background: '#123456'
    } }).png().toBuffer();
  const orientado = await aplicarCamaraExifOrientacion(foto);
  const metadatos = await sharp(orientado).metadata();
  comprobar.equal(metadatos.width, 300);
  comprobar.equal(metadatos.height, 400);
});

test('applies only the camera EXIF orientation used by image viewers', async () => {
  const foto = await sharp({ create: {
      width: 20, height: 30, channels: 3, background: '#ffffff'
    } }).composite([{
    input: { create: { width: 20, height: 10, channels: 3, background: '#ff0000' } },
    left: 0, top: 0
  }]).jpeg().withMetadata({ orientation: 3 }).toBuffer();
  const orientado = await aplicarCamaraExifOrientacion(foto);
  const superiorPixel = await sharp(orientado).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer();
  const inferiorPixel = await sharp(orientado).extract({ left: 2, top: 27, width: 1, height: 1 }).raw().toBuffer();
  comprobar.ok(superiorPixel[1] > 200, 'top is white after applying EXIF');
  comprobar.ok(inferiorPixel[0] > 200 && inferiorPixel[1] < 20, 'red edge moves to the bottom');
});

test('CI OCR image is binary: keeps dark and red ink, clears pale microprint', async () => {
  comprobar.equal(CI_OCR_UMBRAL, 128);
  const foto = await sharp({ create: {
      width: 300, height: 100, channels: 3, background: '#ffffff'
    } }).composite([{
    input: Buffer.from('<svg width="300" height="100"><rect x="10" y="20" width="40" height="40" fill="#202020"/><rect x="110" y="20" width="40" height="40" fill="#b42030"/><rect x="210" y="20" width="40" height="40" fill="#bcbcbc"/></svg>')
  }]).png().toBuffer();
  const procesado = await prepararCiParaOcr(foto, null);
  const { data: datos, info: informacion } = await sharp(procesado).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => datos[(y * informacion.width + x) * informacion.channels];
  comprobar.equal(pixel(25, 35), 0, 'black text stays black');
  comprobar.equal(pixel(125, 35), 0, 'red CI number stays black');
  comprobar.equal(pixel(225, 35), 255, 'pale microprint becomes white');
  comprobar.equal(pixel(275, 35), 255, 'background stays white');
  for (let indice = 0; indice < datos.length; indice += informacion.channels) {
    comprobar.ok(datos[indice] === 0 || datos[indice] === 255, 'no gray pixels are sent to OCR');
  }
});

test('CI front and back apply the same threshold to faint labels', async () => {
  comprobar.equal(CI_FRONTAL_UMBRAL, 128);
  comprobar.equal(CI_REVERSO_ETIQUETA_UMBRAL, 128);
  const foto = await sharp({ create: {
      width: 300, height: 100, channels: 3, background: '#ffffff'
    } }).composite([{
    input: Buffer.from('<svg width="300" height="100"><rect x="20" y="20" width="20" height="20" fill="#747474"/><rect x="220" y="20" width="20" height="20" fill="#747474"/></svg>')
  }]).png().toBuffer();
  const frontal = await prepararCiParaOcr(foto, null, 'ciFront');
  const reverso = await prepararCiParaOcr(foto, null, 'ciBack');
  const frontalPixel = await sharp(frontal).extract({ left: 25, top: 25, width: 1, height: 1 }).raw().toBuffer();
  const izquierdaReversoPixel = await sharp(reverso).extract({ left: 25, top: 25, width: 1, height: 1 }).raw().toBuffer();
  const derechaReversoPixel = await sharp(reverso).extract({ left: 225, top: 25, width: 1, height: 1 }).raw().toBuffer();
  comprobar.equal(frontalPixel[0], 0, 'front retains a faint label');
  comprobar.equal(izquierdaReversoPixel[0], 0, 'the back label is restored');
  comprobar.equal(derechaReversoPixel[0], 0, 'the rest of the back uses the same threshold');
});
