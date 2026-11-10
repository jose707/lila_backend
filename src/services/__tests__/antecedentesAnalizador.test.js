'use strict';

const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const { analizarAntecedentes: analizarAntecedentes, REQUERIDOS_POR_TIPO: REQUERIDOS_POR_TIPO } = require("../servicioOcr");

test('extrae los datos del certificado único digital de antecedentes', () => {
  const campos = analizarAntecedentes([
  '202404231219',
  'ESTADO PLURINACIONAL DE BOLIVIA',
  'POLICIA BOLIVIANA',
  'CERTIFICADO ÚNICO DIGITAL DE ANTECEDENTES POLICIALES',
  'NOMBRES Y APELLIDOS: DIEGO MONTAÑO ILLANES',
  'DOCUMENTO DE IDENTIDAD: 12629477 TIPO: CÉDULA IDENTIDAD',
  'FECHA DE NACIMIENTO: 14/05/2002 NACIONALIDAD: BOLIVIANA',
  'LUGAR DE NACIMIENTO: SANTA CRUZ - ANDRÉS IBÁÑEZ - SCZ',
  'EXPEDIDO EN: SANTA CRUZ ESTADO CIVIL: SOLTERO',
  'PROFESIÓN/OCUPACIÓN: ESTUDIANTE',
  'DOMICILIO: Z. PLAN 3000 B/MECHERO S/N',
  'MOTIVO DEL TRÁMITE: MECANICO GENERAL',
  'DESTINATARIO DEL TRÁMITE: PETREX',
  'ANTECEDENTES: F.E.L.C.V.: NO',
  'FECHA DE EMISIÓN: 23/04/2024 VALIDEZ: 23/05/2024'].
  join('\n'));
  comprobar.equal(campos.certificateNumber, '202404231219');
  comprobar.equal(campos.fullName, 'DIEGO MONTANO ILLANES');
  comprobar.equal(campos.ciNumber, '12629477');
  comprobar.equal(campos.birthDate, '14/05/2002');
  comprobar.equal(campos.procedureReason, 'MECANICO GENERAL');
  comprobar.equal(campos.recipient, 'PETREX');
  comprobar.equal(campos.backgroundUnit, 'F.E.L.C.V.');
  comprobar.equal(campos.backgroundResult, 'NO');
  comprobar.equal(campos.issueDate, '23/04/2024');
  comprobar.equal(campos.validUntil, '23/05/2024');
  comprobar.equal(REQUERIDOS_POR_TIPO.antecedentsPhoto.includes('backgroundResult'), true);
});

test('admite valores en líneas separadas sin inventar antecedentes ni validez', () => {
  const campos = analizarAntecedentes([
  'CERTIFICADO UNICO DIGITAL DE ANTECEDENTES POLICIALES',
  'NOMBRES Y APELLIDOS:', 'DIEGO MONTAÑO ILLANES',
  'DOCUMENTO DE IDENTIDAD:', '12629477',
  'ANTECEDENTES:', 'F.E.L.C.V.', 'NO',
  'FECHA DE EMISIÓN:', '23/04/2024'].
  join('\n'));
  comprobar.equal(campos.fullName, 'DIEGO MONTANO ILLANES');
  comprobar.equal(campos.ciNumber, '12629477');
  comprobar.equal(campos.backgroundResult, 'NO');
  comprobar.equal(campos.issueDate, '23/04/2024');
  comprobar.equal(campos.validUntil, '');
  comprobar.equal(campos.certificateNumber, '');
});

test('antecedentes usa coordenadas para separar columnas y fechas', () => {
  const palabras = [];
  const put = (valor, x, y) => {
    for (const token of valor.split(' ')) {
      palabras.push({ text: token, x, y, w: token.length * 8, h: 16 });
      x += token.length * 8 + 6;
    }
  };
  put('202404231219', 610, 10);
  put('CERTIFICADO ÚNICO DIGITAL', 100, 45);
  put('NOMBRES Y APELLIDOS:', 50, 100);put('DIEGO MONTAÑO ILLANES', 270, 100);
  put('DOCUMENTO DE IDENTIDAD:', 50, 140);put('12629477', 270, 140);
  put('FECHA DE NACIMIENTO:', 50, 180);put('14/05/2002', 270, 180);
  put('NACIONALIDAD:', 430, 180);put('BOLIVIANA', 560, 180);
  put('ANTECEDENTES:', 50, 220);put('F.E.L.C.V.: NO', 270, 220);
  put('FECHA DE EMISIÓN:', 50, 260);put('23/04/2024', 270, 260);
  put('VALIDEZ:', 430, 260);put('23/05/2024', 560, 260);
  const campos = analizarAntecedentes([
  'NOMBRES Y APELLIDOS:', 'DOCUMENTO DE IDENTIDAD:',
  'FECHA DE EMISIÓN: 23/05/2024', 'VALIDEZ: 23/04/2024'].
  join('\n'), { words: palabras });
  comprobar.equal(campos.certificateNumber, '202404231219');
  comprobar.equal(campos.fullName, 'DIEGO MONTANO ILLANES');
  comprobar.equal(campos.ciNumber, '12629477');
  comprobar.equal(campos.birthDate, '14/05/2002');
  comprobar.equal(campos.nationality, 'BOLIVIANA');
  comprobar.equal(campos.backgroundUnit, 'F.E.L.C.V.');
  comprobar.equal(campos.backgroundResult, 'NO');
  comprobar.equal(campos.issueDate, '23/04/2024');
  comprobar.equal(campos.validUntil, '23/05/2024');
});

test('antecedentes lee fechas debajo de sus etiquetas sin cruzar columnas', () => {
  const palabras = [];
  const put = (valor, x, y) => {
    for (const token of valor.split(' ')) {
      palabras.push({ text: token, x, y, w: token.length * 8, h: 16 });
      x += token.length * 8 + 6;
    }
  };
  put('FECHA DE EMISIÓN:', 50, 100);
  put('VALIDEZ:', 400, 100);
  put('23/04/2024', 230, 126);
  put('23/05/2024', 530, 126);
  const campos = analizarAntecedentes('FECHA DE EMISIÓN\nVALIDEZ', { words: palabras });
  comprobar.equal(campos.issueDate, '23/04/2024');
  comprobar.equal(campos.validUntil, '23/05/2024');
});
