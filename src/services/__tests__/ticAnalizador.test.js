'use strict';

const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const { analizarTic: analizarTic, REQUERIDOS_POR_TIPO: REQUERIDOS_POR_TIPO } = require("../servicioOcr");

test('extrae nombre y licencia de una TIC con campos separados', () => {
  const campos = analizarTic([
  'TARJETA DE IDENTIFICACIÓN DEL CONDUCTOR',
  'Nombres: Juan Carlos',
  'Apellidos: Chuquimia Rodriguez',
  'Licencia: 4236877',
  'Categoría: A B C M'].
  join('\n'));

  comprobar.equal(campos.fullName, 'JUAN CARLOS CHUQUIMIA RODRIGUEZ');
  comprobar.equal(campos.licenseNumber, '4236877');
  comprobar.deepEqual(REQUERIDOS_POR_TIPO.ticPhoto, ['ticNumber', 'fullName', 'licenseNumber']);
});

test('no inventa datos ausentes en la TIC', () => {
  comprobar.deepEqual(analizarTic('TARJETA DE IDENTIFICACIÓN DEL CONDUCTOR'), {
    ticNumber: '',
    issuingPlace: '',
    firstNames: '',
    surnames: '',
    fullName: '',
    licenseNumber: ''
  });
});

test('TIC del formato de referencia: código, lugar, nombre y licencia; no inventa categoría', () => {
  const campos = analizarTic([
  'CCR3546993',
  'Oruro',
  'TARJETA DE IDENTIFICACIÓN DEL CONDUCTOR',
  'Nombres: Christian',
  'Apellidos: Challapa Rodriguez',
  'Tipo de Sangre: O RH +',
  'Licencia: 3546993',
  'Categoría: A B C M'].
  join('\n'));
  comprobar.equal(campos.ticNumber, 'CCR3546993');
  comprobar.equal(campos.issuingPlace, 'ORURO');
  comprobar.equal(campos.firstNames, 'CHRISTIAN');
  comprobar.equal(campos.surnames, 'CHALLAPA RODRIGUEZ');
  comprobar.equal(campos.fullName, 'CHRISTIAN CHALLAPA RODRIGUEZ');
  comprobar.equal(campos.licenseNumber, '3546993');
  comprobar.equal(Object.hasOwn(campos, 'category'), false);
  comprobar.equal(Object.hasOwn(campos, 'bloodType'), false);
});

test('TIC usa coordenadas para separar etiqueta y valor aunque el texto mezcle filas', () => {
  const palabras = [];
  const put = (valor, x, y) => {
    for (const token of valor.split(' ')) {
      palabras.push({ text: token, x, y, w: token.length * 10, h: 20 });
      x += token.length * 10 + 8;
    }
  };
  put('CCR3546993', 580, 20);
  put('Oruro', 1300, 20);
  put('TARJETA DE IDENTIFICACIÓN DEL CONDUCTOR', 100, 90);
  put('Nombres:', 500, 190);put('Christian', 750, 190);
  put('Apellidos:', 500, 250);put('Challapa Rodriguez', 750, 250);
  put('Licencia:', 500, 310);put('3546993', 750, 310);
  const campos = analizarTic('Nombres:\nApellidos:\nLicencia: 9999999', { words: palabras });
  comprobar.equal(campos.ticNumber, 'CCR3546993');
  comprobar.equal(campos.issuingPlace, 'ORURO');
  comprobar.equal(campos.firstNames, 'CHRISTIAN');
  comprobar.equal(campos.surnames, 'CHALLAPA RODRIGUEZ');
  comprobar.equal(campos.fullName, 'CHRISTIAN CHALLAPA RODRIGUEZ');
  comprobar.equal(campos.licenseNumber, '3546993');
});

test('TIC con nombre completo no interpreta APELLIDOS como etiqueta independiente', () => {
  const tokens = 'NOMBRES Y APELLIDOS: CHRISTIAN CHALLAPA RODRIGUEZ'.split(' ');
  let x = 50;
  const palabras = tokens.map((token) => {
    const palabra = { text: token, x, y: 100, w: token.length * 9, h: 18 };
    x += palabra.w + 7;
    return palabra;
  });
  const campos = analizarTic('TARJETA DE IDENTIFICACIÓN DEL CONDUCTOR', { words: palabras });
  comprobar.equal(campos.fullName, 'CHRISTIAN CHALLAPA RODRIGUEZ');
  comprobar.equal(campos.surnames, '');
});
