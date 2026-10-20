const { Buffer } = require('buffer');
const crypto = require('crypto');

function storageKey() {
  const value = process.env.IDENTITY_STORAGE_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    const error = new Error('El servicio de identidad requiere configurar su clave de almacenamiento.');
    error.status = 503;
    throw error;
  }
  return Buffer.from(value, 'hex');
}

function seal(value, binding) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', storageKey(), iv);
  cipher.setAAD(Buffer.from(binding));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function unseal(payload, binding) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', storageKey(), payload.subarray(0, 12));
  decipher.setAAD(Buffer.from(binding));
  decipher.setAuthTag(payload.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8'));
}

module.exports = { storageKey, seal, unseal };
