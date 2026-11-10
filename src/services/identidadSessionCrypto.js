const { Buffer } = require('buffer');
const crypto = require('crypto');

function almacenamientoClave() {
  const valor = process.env.IDENTITY_STORAGE_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(valor)) {
    const error = new Error('El servicio de identidad requiere configurar su clave de almacenamiento.');
    error.status = 503;
    throw error;
  }
  return Buffer.from(valor, 'hex');
}

function sellar(valor, vinculacion) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', almacenamientoClave(), iv);
  cipher.setAAD(Buffer.from(vinculacion));
  const cifrado = Buffer.concat([cipher.update(JSON.stringify(valor), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), cifrado]);
}

function unseal(contenido, vinculacion) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', almacenamientoClave(), contenido.subarray(0, 12));
  decipher.setAAD(Buffer.from(vinculacion));
  decipher.setAuthTag(contenido.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(contenido.subarray(28)), decipher.final()]).toString('utf8'));
}

module.exports = { almacenamientoClave: almacenamientoClave, sellar: sellar, unseal };
