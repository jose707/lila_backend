'use strict';

const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const { compararLicenciaLados, resolverEmisionLicencia, emisionLicenciaFutura } = require("../licenseValidacion");

const frontal = () => ({ licenseNumber: '12345678', issueDate: '11/10/2022', licenseExpiryDate: '11/10/2027' });
const reverso = () => ({ licenseNumber: '12345678', issueDate: '2022-10-11', licenseExpiryDate: '2027-10-11' });

test('rechaza emisión futura en cualquiera de las caras y acepta hoy o antes', () => {
  const ahora = new Date('2026-11-09T16:00:00Z');
  comprobar.equal(emisionLicenciaFutura({ issueDate: '2026-11-10' }, reverso(), ahora), true);
  comprobar.equal(emisionLicenciaFutura(frontal(), { issueDate: '10/11/2026' }, ahora), true);
  comprobar.equal(emisionLicenciaFutura({ issueDate: '09/11/2026' }, reverso(), ahora), false);
  comprobar.equal(emisionLicenciaFutura(frontal(), {}, ahora), false);
});

test('la emisión futura se calcula según el día de Bolivia', () => {
  comprobar.equal(emisionLicenciaFutura({ issueDate: '2026-11-10' }, {}, new Date('2026-11-10T03:59:59Z')), true);
  comprobar.equal(emisionLicenciaFutura({ issueDate: '2026-11-10' }, {}, new Date('2026-11-10T04:00:00Z')), false);
});

test('compara únicamente el número de licencia aunque las fechas difieran o falten', () => {
  comprobar.deepEqual(compararLicenciaLados(frontal(), reverso()), { complete: true, matches: true });
  comprobar.deepEqual(compararLicenciaLados(frontal(), { licenseNumber: '12 345-678' }), { complete: true, matches: true });
  comprobar.equal(compararLicenciaLados(frontal(), { ...reverso(), issueDate: '2023-10-11', licenseExpiryDate: '2030-01-01' }).matches, true);
});

test('usa la emisión del reverso solo si falta en el frente y coinciden los números', () => {
  const sinEmision = { ...frontal(), issueDate: '' };
  comprobar.equal(resolverEmisionLicencia(sinEmision, reverso()), '2022-10-11');
  comprobar.equal(resolverEmisionLicencia(sinEmision, { ...reverso(), licenseNumber: '87654321' }), '');
  comprobar.equal(resolverEmisionLicencia(sinEmision, { ...reverso(), issueDate: '' }), '');
});

test('no acepta números ausentes, sin dígitos o distintos', () => {
  for (const licenseNumber of ['', undefined, null, 'ABC', '99']) {
    comprobar.equal(compararLicenciaLados(frontal(), { licenseNumber }).matches, false);
    comprobar.equal(compararLicenciaLados({ licenseNumber }, reverso()).matches, false);
  }
  comprobar.deepEqual(compararLicenciaLados(), { complete: false, matches: false });
  comprobar.deepEqual(compararLicenciaLados(frontal(), { licenseNumber: '99' }), { complete: true, matches: false });
});
