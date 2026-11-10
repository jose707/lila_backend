const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const ruta = require('node:path');
const sharp = require('sharp');
const { guardarImagenesConductor, prepararConductorOcrImagen: prepararConductorOcrImagen } = require("../conductorOcrImage");

async function conImagen(ancho, alto, gris, comprobar) {
  const directory = await fs.mkdtemp(ruta.join(os.tmpdir(), 'linealila-ocr-'));
  const archivo = ruta.join(directory, 'document.png');
  try {
    const entrada = await sharp({ create: {
        width: ancho, height: alto, channels: 3,
        background: { r: gris, g: gris, b: gris }
      } }).png().toBuffer();
    await fs.writeFile(archivo, entrada);
    await comprobar(archivo, entrada);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('license OCR preserves capture orientation and has more contrast', async () => {
  await conImagen(100, 160, 64, async (archivo) => {
    const resultado = await prepararConductorOcrImagen(archivo, 'licenseFront');
    const metadatos = await sharp(resultado).metadata();
    comprobar.equal(metadatos.width, 100);
    comprobar.equal(metadatos.height, 160);
    const pixel = await sharp(resultado).raw().toBuffer();
    comprobar.ok(pixel[0] < 64, 'dark ink should become darker');
  });
});

test('driver OCR applies the saved camera frame with the same five percent margin', async () => {
  await conImagen(200, 200, 100, async (archivo) => {
    const resultado = await prepararConductorOcrImagen(archivo, 'licenseFront', {
      x: 50, y: 60, w: 100, h: 80, screenW: 200, screenH: 200
    });
    const metadatos = await sharp(resultado).metadata();
    comprobar.equal(metadatos.width, 110);
    comprobar.equal(metadatos.height, 88);
  });
});

test('RUAT OCR preserves capture orientation', async () => {
  await conImagen(160, 100, 200, async (archivo) => {
    const resultado = await prepararConductorOcrImagen(archivo, 'ruatPhoto');
    const metadatos = await sharp(resultado).metadata();
    comprobar.equal(metadatos.width, 160);
    comprobar.equal(metadatos.height, 100);
    const pixel = await sharp(resultado).raw().toBuffer();
    comprobar.ok(pixel[0] > 200, 'bright paper should become brighter');
  });
});

test('antecedents OCR uses the same image as the admin preview', async () => {
  await conImagen(100, 140, 200, async (archivo) => {
    const resultado = await prepararConductorOcrImagen(archivo, 'antecedentsPhoto');
    const metadatos = await sharp(resultado).metadata();
    comprobar.equal(metadatos.width, 100);
    comprobar.equal(metadatos.height, 140);
  });
});

test('electricity bill OCR preserves the portrait capture for the admin preview', async () => {
  await conImagen(100, 140, 200, async (archivo) => {
    const resultado = await prepararConductorOcrImagen(archivo, 'domicileProof');
    const metadatos = await sharp(resultado).metadata();
    comprobar.equal(metadatos.width, 100);
    comprobar.equal(metadatos.height, 140);
  });
});


test('guarda el recorte definitivo y actualiza nombre, MIME y tamaño sin tocar fotos de vehículo', async () => {
  await conImagen(200,200,100,async (archivo,original) => {
    const foto = {path:archivo,filename:'document.png',mimetype:'image/png',size:original.length};
    const car = {filename:'auto.png'};
    await guardarImagenesConductor({licenseFront:[foto],carFront:[car]}, {
      licenseFrontCropX:50,licenseFrontCropY:60,licenseFrontCropW:100,licenseFrontCropH:80,
      licenseFrontCropScreenW:200,licenseFrontCropScreenH:200
    });
    const guardada = await fs.readFile(foto.path);
    const meta = await sharp(guardada).metadata();
    comprobar.equal(meta.width,110);comprobar.equal(meta.height,88);
    comprobar.equal(meta.format,'jpeg');comprobar.equal(foto.mimetype,'image/jpeg');
    comprobar.equal(foto.size,guardada.length);comprobar.equal(foto.filename,'document.png.jpg');
    await comprobar.rejects(fs.access(archivo),{code:'ENOENT'});
    comprobar.deepEqual(car,{filename:'auto.png'});
    const vista = await fs.readFile(foto.path);
    comprobar.deepEqual(vista,guardada,'lecturas posteriores no vuelven a recortar ni contrastar');
  });
});

test('la evidencia CI conserva color y recorte antes del tratamiento OCR', async () => {
  const {prepararDocumentoImagen,prepararCiParaOcr}=require('../documentoRecorte');
  const original=await sharp({create:{width:200,height:200,channels:3,background:'#c82850'}}).png().toBuffer();
  const rect={x:50,y:60,w:100,h:80,screenW:200,screenH:200};
  const evidencia=await prepararDocumentoImagen(original,rect);
  const meta=await sharp(evidencia).metadata();
  comprobar.equal(meta.width,110);comprobar.equal(meta.height,88);
  const pixel=await sharp(evidencia).raw().toBuffer();comprobar.ok(pixel[0]>pixel[1]);
  comprobar.deepEqual(await prepararCiParaOcr(original,rect),await prepararCiParaOcr(evidencia,null));
});
