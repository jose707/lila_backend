'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTic, REQUIRED_BY_TYPE } = require('../ocrService');

test('extrae nombre y licencia de una TIC con campos separados', () => {
  const fields = parseTic([
    'TARJETA DE IDENTIFICACIÓN DEL CONDUCTOR',
    'Nombres: Juan Carlos',
    'Apellidos: Chuquimia Rodriguez',
    'Licencia: 4236877',
    'Categoría: A B C M',
  ].join('\n'));

  assert.equal(fields.fullName, 'JUAN CARLOS CHUQUIMIA RODRIGUEZ');
  assert.equal(fields.licenseNumber, '4236877');
  assert.deepEqual(REQUIRED_BY_TYPE.ticPhoto, ['fullName', 'licenseNumber']);
});

test('no inventa datos ausentes en la TIC', () => {
  assert.deepEqual(parseTic('TARJETA DE IDENTIFICACIÓN DEL CONDUCTOR'), {
    fullName: '',
    licenseNumber: '',
  });
});
