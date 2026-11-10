const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const { comprobarDigito: comprobarDigito, inspectMrz: inspectMrz } = require('../ciMrz');
const { analizarMrz: analizarMrz, analizarCi: analizarCi } = require("../servicioOcr");

function bolivianoMrz(prefijo = 'I<BOL') {
  const numero = '1234567<<';
  const primero = `${prefijo}${numero}${comprobarDigito(numero)}${'<'.repeat(15)}`;
  const segundo = `900815${comprobarDigito('900815')}M300101${comprobarDigito('300101')}BOL${'<'.repeat(11)}`;
  const composite = primero.slice(5) + segundo.slice(0, 7) + segundo.slice(8, 15) + segundo.slice(18, 29);
  return [primero, segundo + comprobarDigito(composite), 'PEREZ<MAMANI<<JUAN'.padEnd(30, '<')];
}

test('reconoce el prefijo I<BOL y extrae datos de TD1 aunque el OCR inserte espacios', () => {
  const lineas = bolivianoMrz();
  const spacedTexto = lineas.map((linea) => [...linea].join(' ')).join('\n');

  comprobar.equal(inspectMrz(spacedTexto).status, 'valid');
  comprobar.deepEqual(analizarMrz(spacedTexto), {
    ciNumber: '1234567',
    fullName: 'PEREZ MAMANI JUAN',
    birthDate: '15/08/1990',
    mrz: true
  });
});

test('CI actual limpia símbolos y números del nombre completo del reverso', () => {
  const [primero, segundo] = bolivianoMrz();
  const texto = [primero, segundo, 'PEREZ@<MAMANI<<JUAN#2'].join('\n');
  const resultado = analizarCi(texto, { documentType: 'ciBack', format: 'current' });
  comprobar.equal(resultado.fullName, 'PEREZ MAMANI JUAN');
});

test('CI actual une dos líneas de nacimiento y domicilio sin incorporar padre ni MRZ', () => {
  const texto = [
  'LUGAR DE NACIMIENTO',
  'LA PAZ - MURILLO - NUESTRA SEÑORA DE',
  'LA PAZ',
  'DOMICILIO',
  'AV.PUCARANI Nº60 Z.ALTO LIMA',
  '3RA.SECC.',
  'PADRE:',
  'EMILIO CONDORI QUINO',
  'MADRE',
  'VIRGINIA CHOQUE MAMANI/ CI:4959419',
  'I<BOL13211916<2<<<<<<<<<<<<<<<'].
  join('\n');
  const resultado = analizarCi(texto, { documentType: 'ciBack', format: 'current' });
  comprobar.equal(resultado.birthPlace, 'LA PAZ MURILLO NUESTRA SENORA DE LA PAZ');
  comprobar.equal(resultado.address, 'AV.PUCARANI Nº60 Z.ALTO LIMA 3RA.SECC.');
  comprobar.ok(!resultado.address.includes('PADRE'));
});

test('CI actual no agrega el campo siguiente cuando un valor ocupa una sola línea', () => {
  const texto = 'LUGAR DE NACIMIENTO: LA PAZ\nDOMICILIO: CALLE SUCRE 123\nPADRE: JUAN PEREZ';
  const resultado = analizarCi(texto, { documentType: 'ciBack', format: 'current' });
  comprobar.equal(resultado.birthPlace, 'LA PAZ');
  comprobar.equal(resultado.address, 'CALLE SUCRE 123');
});

test('MRZ real con B0L y guion OCR al inicio del nombre conserva controles válidos', () => {
  const texto = [
  'LUGAR DE NACIMIENTO:',
  'LA PAZ - MURILLO - NUESTRA SEÑORA DE',
  'LA PAZ',
  'DOMICILIO',
  'RESD. EN CATAVI - PUCARANI',
  'OCUPACIÓN: ESTUDIANTE',
  'I<BOL4959419<<9<<<<<<<<<<<<<<<',
  '7805020F3006254B0L<<<<<<<<<<<2',
  '- CHOQUE<MAMANI<<VIRGINIA<<<<<<<'].
  join('\n');
  comprobar.equal(inspectMrz(texto).status, 'valid');
  comprobar.deepEqual(analizarMrz(texto), {
    ciNumber: '4959419', fullName: 'CHOQUE MAMANI VIRGINIA',
    birthDate: '02/05/1978', mrz: true
  });
  const badDigito = texto.replace('4959419<<9', '4959419<<8');
  comprobar.equal(inspectMrz(badDigito).status, 'invalid');
});

test('lee ESTADO CIVAL y recupera separador de apellidos perdido por OCR sin omitir controles MRZ', () => {
  const [primero, segundo, tercero] = bolivianoMrz();
  const texto = [
  'LUGAR DE NACIMIENTO:',
  'LA PAZ - MURILLO - NUESTRA SEÑORA DE',
  'LA PAZ',
  'DOMICILIO.',
  'RESD. EN CATAVI - PUCARANI',
  'OCUPACION.',
  'ESTUDIANTE',
  'ESTADO CIVAL',
  'DIVORCIADA',
  primero,
  segundo.replace('BOL', 'B0L'),
  tercero.replace('PEREZ<MAMANI', 'PEREZ MAMANI')].
  join('\n');

  comprobar.equal(inspectMrz(texto).status, 'valid');
  comprobar.equal(analizarMrz(texto).fullName, 'PEREZ MAMANI JUAN');
  const campos = analizarCi(texto, { documentType: 'ciBack', format: 'current' });
  comprobar.equal(campos.maritalStatus, 'DIVORCIADA');
  comprobar.equal(campos.fullName, 'PEREZ MAMANI JUAN');
  comprobar.equal(campos.birthPlace, 'LA PAZ MURILLO NUESTRA SENORA DE LA PAZ');
  const badPrimero = primero.slice(0, 14) + (primero[14] === '9' ? '8' : '9') + primero.slice(15);
  comprobar.equal(inspectMrz(texto.replace(primero, badPrimero)).status, 'invalid');
});

test('CI actual conserva emisión y expiración etiquetadas aunque las coordenadas confundan ambas', () => {
  const texto = [
  'FECHA DE NACIMIENTO:',
  '02/05/1978',
  'FECHA DE EMISIÓN',
  '25/06/2025',
  'FECHA DE EXPIRACION',
  '25/06/2030'].
  join('\n');
  // Simula una fila de Vision mal asociada: ubica la expiración a la derecha
  // de la etiqueta de emisión, pese a que el texto lineal sí es inequívoco.
  const palabras = [
  ['FECHA', 0, 35], ['DE', 40, 15], ['EMISION', 60, 55], ['25/06/2030', 125, 70]].
  map(([palabra, x, ancho]) => ({ text: palabra, x, y: 0, w: ancho, h: 10 }));

  const resultado = analizarCi(texto, { documentType: 'ciFront', format: 'current', words: palabras });
  comprobar.equal(resultado.issueDate, '25/06/2025');
  comprobar.equal(resultado.expiryDate, '25/06/2030');
});

test('CI actual reconoce FECHA DE EXPIRACY como error OCR de expiración', () => {
  const texto = [
  'ESTADO PLURINACIONAL DE BOLIVIA',
  'SERVICIO GENERAL DE IDENTIFICACIÓN PERSONAL',
  'FECHA DE NACIMIENTO.',
  '02/05/1978',
  'FECHA DE EMISIÓN',
  '25/06/2025',
  'FECHA DE EXPIRACY',
  '25/06/2030'].
  join('\n');

  const resultado = analizarCi(texto, { documentType: 'ciFront', format: 'current' });
  comprobar.equal(resultado.issueDate, '25/06/2025');
  comprobar.equal(resultado.expiryDate, '25/06/2030');
});
