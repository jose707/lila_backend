'use strict';

const https = require('https');
const http = require('http');

// Face Liveness also returns the reference frame used for the profile photo.
const MAXIMO_RESPUESTA_BYTES = 6 * 1024 * 1024;

function configuracion() {
  const rutaApi = process.env.FACE_LIVENESS_LAMBDA_URL;
  const secreto = process.env.FACE_LIVENESS_SHARED_SECRET;
  if (!rutaApi || !secreto) {
    const error = new Error('La verificación facial no está configurada.');
    error.status = 503;
    throw error;
  }
  let analizado;
  try {analizado = new URL(rutaApi);} catch {
    const error = new Error('La URL del servicio biométrico no es válida.');
    error.status = 503;
    throw error;
  }
  if (analizado.protocol !== 'https:') {
    const error = new Error('El servicio biométrico debe usar HTTPS.');
    error.status = 503;
    throw error;
  }
  return { endpoint: analizado, secret: secreto };
}

function invokeLambda(contenido) {
  const { endpoint: rutaApi, secret: secreto } = configuracion();
  const cuerpo = Buffer.from(JSON.stringify(contenido));
  const transport = rutaApi.protocol === 'https:' ? https : http;
  return new Promise((resolver, rechazar) => {
    const solicitud = transport.request(rutaApi, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': cuerpo.length,
        'x-linealila-service-key': secreto
      },
      timeout: 30000
    }, (respuesta) => {
      const fragmentos = [];
      let tamano = 0;
      respuesta.on('data', (fragmento) => {
        tamano += fragmento.length;
        if (tamano > MAXIMO_RESPUESTA_BYTES) {
          solicitud.destroy(new Error('Respuesta biométrica demasiado grande.'));
          return;
        }
        fragmentos.push(fragmento);
      });
      respuesta.on('end', () => {
        let datos;
        try {datos = JSON.parse(Buffer.concat(fragmentos).toString('utf8'));} catch {
          return rechazar(new Error('Respuesta inválida del servicio biométrico.'));
        }
        if (respuesta.statusCode < 200 || respuesta.statusCode >= 300) {
          const error = new Error(datos.error || 'El servicio biométrico no pudo completar la solicitud.');
          error.status = respuesta.statusCode === 429 ? 429 : 502;
          return rechazar(error);
        }
        resolver(datos);
      });
    });
    solicitud.on('timeout', () => solicitud.destroy(Object.assign(new Error('Tiempo de espera agotado al contactar el servicio biométrico.'), { status: 504 })));
    solicitud.on('error', (error) => rechazar(error.status ? error : Object.assign(error, { status: 502 })));
    solicitud.end(cuerpo);
  });
}

module.exports = { invokeLambda };
