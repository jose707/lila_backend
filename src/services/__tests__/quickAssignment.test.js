'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  pickupSurcharge,
  validatePoint,
  RADIUS_METERS,
} = require('../quickAssignmentPolicy');

test('radio máximo de 3 km y suplemento con primer km incluido y tope', () => {
  assert.equal(RADIUS_METERS, 3000);
  assert.equal(pickupSurcharge(0), 0);
  assert.equal(pickupSurcharge(1000), 0);
  assert.equal(pickupSurcharge(1500), 1);
  assert.equal(pickupSurcharge(2000), 2);
  assert.equal(pickupSurcharge(3000), 4);
  assert.equal(pickupSurcharge(6500), 4);
  assert.throws(() => pickupSurcharge(NaN));
});
test('coordenadas: permite cero, rechaza NaN, texto y fuera de rango', () => {
  assert.ok(validatePoint({ latitude: 0, longitude: 0, address: 'Origen' }));
  for (const latitude of [NaN, Infinity, 91, '10', null]) {
    assert.ok(!validatePoint({ latitude, longitude: 0, address: 'Origen' }));
  }
});
