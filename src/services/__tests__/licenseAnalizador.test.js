'use strict';

const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const { analizarLicencia: analizarLicencia, REQUERIDOS_POR_TIPO: REQUERIDOS_POR_TIPO } = require("../servicioOcr");

test('licencia: anverso con nombre en dos líneas, fechas juntas y categoría sin etiqueta', () => {
  const campos = analizarLicencia([
  'ESTADO PLURINACIONAL DE BOLIVIA LICENCIA PARA CONDUCIR',
  'Nombres, Apellidos',
  'JUAN CARLOS PEREZ',
  'MAMANI',
  'Sexo M',
  'Nacionalidad BOLIVIANO',
  'Nro. de licencia',
  '12345678',
  'Emisión',
  'Vencimiento',
  '11/10/2022 11/10/2027',
  'Fecha de nacimiento',
  '26/12/1998',
  'A'].
  join('\n'));

  comprobar.equal(campos.licenseNumber, '12345678');
  comprobar.equal(campos.fullName, 'JUAN CARLOS PEREZ MAMANI');
  comprobar.equal(campos.nationality, 'BOLIVIANO');
  comprobar.equal(campos.issueDate, '11/10/2022');
  comprobar.equal(campos.licenseExpiryDate, '11/10/2027');
  comprobar.equal(campos.birthDate, '26/12/1998');
  comprobar.equal(campos.licenseCategory, 'A');
});

test('licencia: conserva el segundo apellido cuando Vision inserta una coma en la primera línea', () => {
  const campos = analizarLicencia([
  'Nombres, Apellidos',
  'JOSE DANIEL, CONDORI',
  'CHOQUE',
  'Segip',
  '12345678',
  'Sexo M'].
  join('\n'));

  comprobar.equal(campos.fullName, 'JOSE DANIEL CONDORI CHOQUE');
});

test('licencia: elimina SEGIP intercalado y separa emisión de vencimiento', () => {
  const campos = analizarLicencia([
    'Nombres, Apellidos', 'JOSE DANIEL SEGIP CONDORI', 'CHOQUE',
    'Emisión', 'Vencimiento', '11/10/2022', '11/10/2027',
    'Fecha de nacimiento', '26/12/1998'
  ].join('\n'));
  comprobar.equal(campos.fullName, 'JOSE DANIEL CONDORI CHOQUE');
  comprobar.equal(campos.issueDate, '11/10/2022');
  comprobar.equal(campos.licenseExpiryDate, '11/10/2027');
});

test('licencia: reconoce la etiqueta Emisión sin la palabra fecha', () => {
  for (const texto of ['Emisión: 11/10/2022', 'Emisión\n11/10/2022']) {
    comprobar.equal(analizarLicencia(texto).issueDate, '11/10/2022');
  }
});

test('licencia frontal recupera emisión de su columna cuando el texto desordena las fechas', () => {
  const words = [
    { text: 'Emisión', x: 20, y: 10, w: 55, h: 12 },
    { text: 'Vencimiento', x: 160, y: 10, w: 85, h: 12 },
    { text: '11/10/2022', x: 20, y: 28, w: 80, h: 12 },
    { text: '11/10/2027', x: 160, y: 28, w: 80, h: 12 }
  ];
  const resultado = analizarLicencia('Emisión\nNacionalidad\nVencimiento: 11/10/2027', {
    documentType: 'licenseFront', words
  });
  comprobar.equal(resultado.issueDate, '11/10/2022');
  comprobar.equal(resultado.licenseExpiryDate, '11/10/2027');
});

test('licencia frontal reúne los fragmentos de emisión sin tomar el vencimiento', () => {
  const words = [
    { text: 'Emisi0n', x: 20, y: 10, w: 55, h: 12 },
    { text: 'Vencimiento', x: 160, y: 10, w: 85, h: 12 },
    { text: '11/10/', x: 20, y: 28, w: 43, h: 12 },
    { text: '2022', x: 66, y: 28, w: 30, h: 12 },
    { text: '11/10/2027', x: 160, y: 28, w: 80, h: 12 }
  ];
  const texto = 'Emisi0n Vencimiento\n11/10/ 2022 11/10/2027';
  const resultado = analizarLicencia(texto, { documentType: 'licenseFront', words });
  comprobar.equal(resultado.issueDate, '11/10/2022');
  comprobar.equal(resultado.licenseExpiryDate, '11/10/2027');
});

test('licencia: reverso con número y categoría sin etiqueta; ignora datos accesorios', () => {
  const campos = analizarLicencia([
  '12345678',
  'Lentes',
  'Si',
  'Grupo S.',
  'O RH (+)',
  'Audífonos',
  'No',
  'A',
  'EMISIÓN',
  '11/10/2022',
  'VENCIMIENTO',
  '11/10/2027'].
  join('\n'));

  comprobar.equal(campos.licenseNumber, '12345678');
  comprobar.equal(campos.issueDate, '11/10/2022');
  comprobar.equal(campos.licenseExpiryDate, '11/10/2027');
  comprobar.equal(campos.licenseCategory, 'A');
  comprobar.equal(Object.hasOwn(campos, 'glasses'), false);
  comprobar.equal(Object.hasOwn(campos, 'hearingAid'), false);
  comprobar.equal(Object.hasOwn(campos, 'bloodType'), false);
  comprobar.deepEqual(REQUERIDOS_POR_TIPO.licenseBack, [
  'licenseNumber', 'issueDate', 'licenseExpiryDate', 'licenseCategory']
  );
});
