'use strict';

const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const { analizarSoat: analizarSoat } = require("../servicioOcr");

test('lee la roseta digital SOAT UNIVIDA del formato de referencia', () => {
  const campos = analizarSoat([
  'UNIVIDA S.A.',
  'N° de Roseta: 2007915969',
  'SOAT 2026',
  'DEPARTAMENTO: COCHABAMBA',
  'Datos del Vehículo',
  '• Placa: 1931TAB',
  '• Tipo: CAMIONETA',
  '• Uso: PARTICULAR',
  'Vigencia del SOAT:',
  'Del 01/01/2026',
  'Hasta 31/12/2026'].
  join('\n'));
  comprobar.deepEqual(campos, {
    soatRosetteNumber: '2007915969',
    soatYear: '2026',
    soatDepartment: 'COCHABAMBA',
    soatPlate: '1931TAB',
    soatVehicleType: 'CAMIONETA',
    soatUse: 'PARTICULAR',
    soatStartDate: '01/01/2026',
    soatExpiryDate: '31/12/2026'
  });
});

test('acepta valores OCR en la línea siguiente y no confunde inicio con vencimiento', () => {
  const campos = analizarSoat([
  'Nº de Roseta:', '2007915969',
  'SOAT', '2026',
  'Departamento:', 'COCHABAMBA',
  'Placa:', '1931TAB',
  'Tipo:', 'CAMIONETA',
  'Uso:', 'PARTICULAR',
  'Vigencia del SOAT:',
  'Del', '01/01/2026',
  'Hasta', '31/12/2026'].
  join('\n'));
  comprobar.equal(campos.soatRosetteNumber, '2007915969');
  comprobar.equal(campos.soatYear, '2026');
  comprobar.equal(campos.soatStartDate, '01/01/2026');
  comprobar.equal(campos.soatExpiryDate, '31/12/2026');
});

test('no inventa vencimiento a partir de la fecha de inicio', () => {
  const campos = analizarSoat('SOAT 2026\nVigencia del SOAT:\nDel 01/01/2026');
  comprobar.equal(campos.soatStartDate, '01/01/2026');
  comprobar.equal(campos.soatExpiryDate, '');
});

test('un comprobante antiguo no se reconoce como roseta digital', () => {
  const campos = analizarSoat([
  'COMPROBANTE DE COMPRA SOAT',
  'Número de factura: 2007915969',
  'Placa: 1931TAB',
  'Uso: PARTICULAR',
  'Vigencia desde: 01/01/2026',
  'Vencimiento: 31/12/2026'].
  join('\n'));
  comprobar.equal(campos.soatRosetteNumber, '');
  comprobar.equal(campos.soatYear, '');
  comprobar.equal(campos.soatStartDate, '');
  comprobar.equal(campos.soatExpiryDate, '');
});

test('SOAT usa coordenadas para separar valores de columnas y fechas', () => {
  const palabras = [];
  const put = (valor, x, y) => {
    for (const token of valor.split(' ')) {
      palabras.push({ text: token, x, y, w: token.length * 9, h: 18 });
      x += token.length * 9 + 7;
    }
  };
  put('N° de Roseta: 2007915969', 50, 40);
  put('SOAT 2026', 50, 90);
  put('DEPARTAMENTO: COCHABAMBA', 50, 140);
  put('Placa: 1931TAB', 50, 190);
  put('Tipo: CAMIONETA', 400, 190);
  put('Uso: PARTICULAR', 50, 240);
  put('Del 01/01/2026', 50, 290);
  put('Hasta 31/12/2026', 400, 290);
  const campos = analizarSoat('Placa: CAMIONETA\nDel 31/12/2026\nHasta 01/01/2026', { words: palabras });
  comprobar.equal(campos.soatRosetteNumber, '2007915969');
  comprobar.equal(campos.soatYear, '2026');
  comprobar.equal(campos.soatDepartment, 'COCHABAMBA');
  comprobar.equal(campos.soatPlate, '1931TAB');
  comprobar.equal(campos.soatVehicleType, 'CAMIONETA');
  comprobar.equal(campos.soatUse, 'PARTICULAR');
  comprobar.equal(campos.soatStartDate, '01/01/2026');
  comprobar.equal(campos.soatExpiryDate, '31/12/2026');
});
