'use strict';

const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const { analizarFacturaElectricidad: analizarFacturaElectricidad, REQUERIDOS_POR_TIPO: REQUERIDOS_POR_TIPO } = require("../servicioOcr");

test('lee DIRECCIÓN y MES solo de Datos del consumidor en DELAPAZ', () => {
  const campos = analizarFacturaElectricidad([
  'DELAPAZ AVISO DE COBRANZA',
  'DATOS DEL CONSUMIDOR',
  'NOMBRE: CHOQUE MAMANI VIRGINIA',
  'NIT/CI: 4959419 N° CONSUMIDOR: 539338-4',
  'DIRECCIÓN: ALP, A LIMA, 3RA SEC, CLL. 3°60 Nro: 0 Piso: 0',
  'CODIGO - CIUDAD/LOCALIDAD: 2 ACTIVIDAD: VIVIENDA',
  'MES: OCTUBRE-2026 CATEGORÍA: D2-PD-BT',
  'FECHA DE LECTURA: ANTERIOR 15-SEP-26 ACTUAL 15-OCT-26',
  'DETALLE DE IMPORTES',
  'HISTÓRICO 9/2026 158',
  'Mes: Sep-26'].
  join('\n'));
  comprobar.equal(campos.serviceAddress, 'ALP, A LIMA, 3RA SEC, CLL. 3°60');
  comprobar.equal(campos.billingMonth, '2026-10');
  comprobar.deepEqual(REQUERIDOS_POR_TIPO.domicileProof, ['serviceAddress', 'billingMonth']);
});

test('no toma el MES del historial ni del talón si falta Datos del consumidor', () => {
  const campos = analizarFacturaElectricidad('HISTORICO 10/2026\nCODIGO DE COBRANZA\nMes: Oct-26');
  comprobar.deepEqual(campos, { serviceAddress: '', billingMonth: '' });
});

test('usa coordenadas del bloque superior aunque el texto OCR mezcle meses', () => {
  const palabras = [];
  const put = (valor, x, y) => {
    for (const token of valor.split(' ')) {
      palabras.push({ text: token, x, y, w: token.length * 9, h: 18 });
      x += token.length * 9 + 7;
    }
  };
  put('DATOS DEL CONSUMIDOR', 100, 40);
  put('DIRECCIÓN:', 100, 100);put('ALP, A LIMA, 3RA SEC, CLL. 3°60', 310, 100);
  put('Nro:', 900, 100);put('0', 980, 100);
  put('MES:', 100, 150);put('OCTUBRE-2026', 310, 150);
  put('CATEGORÍA:', 800, 150);put('D2-PD-BT', 1010, 150);
  put('FECHA DE LECTURA', 100, 200);
  put('HISTÓRICO MES: SEP-26', 100, 600);
  const campos = analizarFacturaElectricidad([
  'DATOS DEL CONSUMIDOR', 'DIRECCIÓN:', 'MES: SEPTIEMBRE-2026',
  'FECHA DE LECTURA', 'Mes: Oct-26'].
  join('\n'), { words: palabras });
  comprobar.equal(campos.serviceAddress, 'ALP, A LIMA, 3RA SEC, CLL. 3°60');
  comprobar.equal(campos.billingMonth, '2026-10');
});
