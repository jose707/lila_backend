'use strict';

const https = require('https');
const http = require('http');

// Face Liveness also returns the reference frame used for the profile photo.
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;

function configuration() {
  const endpoint = process.env.FACE_LIVENESS_LAMBDA_URL;
  const secret = process.env.FACE_LIVENESS_SHARED_SECRET;
  if (!endpoint || !secret) {
    const error = new Error('La verificación facial no está configurada.');
    error.status = 503;
    throw error;
  }
  let parsed;
  try { parsed = new URL(endpoint); } catch {
    const error = new Error('La URL del servicio biométrico no es válida.');
    error.status = 503;
    throw error;
  }
  if (parsed.protocol !== 'https:') {
    const error = new Error('El servicio biométrico debe usar HTTPS.');
    error.status = 503;
    throw error;
  }
  return { endpoint: parsed, secret };
}

function invokeLambda(payload) {
  const { endpoint, secret } = configuration();
  const body = Buffer.from(JSON.stringify(payload));
  const transport = endpoint.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-linealila-service-key': secret,
      },
      timeout: 30000,
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('Respuesta biométrica demasiado grande.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
          return reject(new Error('Respuesta inválida del servicio biométrico.'));
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(data.error || 'El servicio biométrico no pudo completar la solicitud.');
          error.status = response.statusCode === 429 ? 429 : 502;
          return reject(error);
        }
        resolve(data);
      });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('Tiempo de espera agotado al contactar el servicio biométrico.'), { status: 504 })));
    request.on('error', error => reject(error.status ? error : Object.assign(error, { status: 502 })));
    request.end(body);
  });
}

module.exports = { invokeLambda };
