'use strict';
const fs = require('fs');
const path = require('path');

// Una versión publicada conserva su archivo. Los cambios requieren una versión nueva.
const VERSION_IDENTIDAD = 'identity-documents-v1';
const texto = fs.readFileSync(path.join(__dirname, '../../consentimientos', VERSION_IDENTIDAD + '.txt'), 'utf8').trim();
if (!texto) throw new Error('El consentimiento de identidad no contiene texto.');
const consentimientoIdentidad = Object.freeze({ version: VERSION_IDENTIDAD, texto });

function obtenerConsentimientoIdentidad() {
  return consentimientoIdentidad;
}

function validarConsentimientoIdentidad(body) {
  if (body?.consent !== true && body?.consent !== 'true') {
    throw Object.assign(new Error('Debes autorizar el tratamiento de los documentos para verificar tu identidad.'), { status: 400 });
  }
  if (body.consentVersion !== VERSION_IDENTIDAD) {
    throw Object.assign(new Error('Consulta y acepta la versión vigente del consentimiento de identidad.'), { status: 409, code: 'CONSENT_VERSION_MISMATCH' });
  }
  return consentimientoIdentidad;
}

module.exports = { obtenerConsentimientoIdentidad, validarConsentimientoIdentidad };
