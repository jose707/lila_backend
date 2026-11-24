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

test('PU-06: valida coordenadas completas y sus límites', () => {
  const punto = { latitude: -16.5, longitude: -68.15, address: 'Origen' };
  comprobar.ok(validarPunto(punto));
  comprobar.ok(!validarPunto({ latitude: punto.latitude, address: punto.address }));
  for (const invalido of [
    { ...punto, latitude: 91 }, { ...punto, latitude: -91 },
    { ...punto, longitude: 181 }, { ...punto, longitude: -181 }
  ]) comprobar.ok(!validarPunto(invalido));
  comprobar.ok(validarPunto({ ...punto, latitude: 90, longitude: 180 }));
});
