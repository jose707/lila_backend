'use strict';
const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const {
  validarPunto: validarPunto,
  RADIO_METROS: RADIO_METROS
} = require("../rapidaAsignacionPolicy");

test('radio máximo de 3 km', () => {
  comprobar.equal(RADIO_METROS, 3000);
});
test('coordenadas: permite cero, rechaza NaN, texto y fuera de rango', () => {
  comprobar.ok(validarPunto({ latitude: 0, longitude: 0, address: 'Origen' }));
  for (const latitud of [NaN, Infinity, 91, '10', null]) {
    comprobar.ok(!validarPunto({ latitude: latitud, longitude: 0, address: 'Origen' }));
  }
});
