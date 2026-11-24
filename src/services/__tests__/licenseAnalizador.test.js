'use strict';

const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const { analizarLicencia: analizarLicencia, REQUERIDOS_POR_TIPO: REQUERIDOS_POR_TIPO } = require("../servicioOcr");
const { camposRequeridosDocumento } = require('../servicioOcr');
const { comprobarDigito } = require('../ciMrz');
const { camposOcrPendientes } = require('../solicitudDocumentos');
const { requiereCiPropietario, validarCiPropietario, leerCiPropietario } = require('../ciPropietario');

test('el TIC ausente no bloquea la validación documental y el TIC adjunto sí se valida', () => {
  const { validarDatosDocumentales } = require('../documentosCorreccionServicio');
  const identidad = { ciNumber: '12345678', firstNames: 'Ana', paternalSurname: 'Paz', birthDate: '1990-01-01' };
  const metadata = { vehicleType: 'taxi', ocr: {
    licenseFront: { fields: { licenseNumber: '12345678', fullName: 'Ana Paz', birthDate: '01/01/1990',
      issueDate: '01/01/2020', licenseExpiryDate: '01/01/2099' } },
    licenseBack: { fields: { licenseNumber: '12345678' } },
    ruatPhoto: { fields: { vehicleOwnerCi: '12345678', vehiclePlate: 'ABC123', vehicleBrand: 'Marca', vehicleModel: 'Modelo', vehicleYear: '2025' } },
    soatPhoto: { fields: { soatExpiryDate: '01/01/2099', soatUse: 'PUBLICO' } }
  } };
  comprobar.deepEqual(validarDatosDocumentales(metadata, identidad), []);
  metadata.ocr.ticPhoto = { fields: { fullName: 'Otra Persona', licenseNumber: '87654321' } };
  comprobar.ok(validarDatosDocumentales(metadata, identidad).some(error => error.documento === 'ticPhoto'));
  metadata.ocr.ticPhoto.fields = { fullName: 'Ana Paz', licenseNumber: '12345678' };
  comprobar.deepEqual(validarDatosDocumentales(metadata, identidad), []);
});

test('RUAT de otro propietario exige su CI y comprueba ambas caras', () => {
  const identidad = { ciNumber: '12345678' };
  comprobar.equal(requiereCiPropietario({ vehicleOwnerCi: '12 345 678' }, identidad), false);
  const metadata = { ocr: { ruatPhoto: { fields: { vehicleOwnerCi: '87654321' } } } };
  comprobar.equal(requiereCiPropietario(metadata.ocr.ruatPhoto.fields, identidad), true);
  comprobar.equal(validarCiPropietario(metadata, identidad).length, 2);
  const numero = '87654321<', nacimiento = '900101', vencimiento = '300101';
  const primera = ('I<BOL' + numero + comprobarDigito(numero)).padEnd(30, '<');
  const segunda = (nacimiento + comprobarDigito(nacimiento) + 'F' + vencimiento +
    comprobarDigito(vencimiento) + 'BOL').padEnd(29, '<');
  const control = comprobarDigito(primera.slice(5) + segunda.slice(0, 7) + segunda.slice(8, 15) + segunda.slice(18));
  const frente = 'ESTADO PLURINACIONAL DE BOLIVIA\nCEDULA DE IDENTIDAD\nNOMBRES ANA\nAPELLIDOS ROJAS PEREZ\nN° 87654321\nFECHA DE NACIMIENTO 01/01/1990';
  const dorso = [primera, segunda + control, 'ROJAS<PEREZ<<ANA'.padEnd(30, '<')].join('\n');
  metadata.ocr.ownerCiFront = { text: frente, fields: leerCiPropietario(frente, 'ownerCiFront') };
  metadata.ocr.ownerCiBack = { text: dorso, fields: leerCiPropietario(dorso, 'ownerCiBack') };
  comprobar.deepEqual(validarCiPropietario(metadata, identidad), []);
  metadata.ocr.ownerCiFront.fields.ciNumber = '11111111';
  comprobar.ok(validarCiPropietario(metadata, identidad).some(error => error.mensaje.includes('no coincide')));
});

test('licencia reciente: lee el nombre sin rótulo y las fechas con meses abreviados', () => {
  const texto = [
    'LICENCIA PARA', 'CONDUCIR', 'ANA MARIA, ROJAS', 'PEREZ', 'CATEGORÍA:', 'A',
    'GÉNERO: Femenino', 'NACIONALIDAD:', 'Boliviana', 'FECHA DE NACIMIENTO:', '06 / ago / 2000',
    'N° 12345678', 'EMISIÓN: 02 / oct. / 2025', 'VENCIMIENTO: 24 / ene / 2030'
  ].join('\n');
  comprobar.deepEqual(analizarLicencia(texto, { documentType: 'licenseFront' }), {
    licenseNumber: '12345678', fullName: 'ANA MARIA ROJAS PEREZ', nationality: 'BOLIVIANA',
    issueDate: '02/10/2025', licenseExpiryDate: '24/01/2030', birthDate: '06/08/2000', licenseCategory: 'A'
  });
  comprobar.equal(analizarLicencia(texto.replace('MARIA,', 'MARIA'), { documentType: 'licenseFront' }).fullName,
    'ANA MARIA ROJAS PEREZ');
});

test('licencia reciente: lee el número del MRZ y nunca lo toma del teléfono de emergencia', () => {
  const numero = '12345678<';
  const nacimiento = '000806';
  const vencimiento = '300124';
  const primera = ('I<BOL' + numero + comprobarDigito(numero)).padEnd(30, '<');
  const segunda = (nacimiento + comprobarDigito(nacimiento) + 'F' + vencimiento +
    comprobarDigito(vencimiento) + 'BOL').padEnd(29, '<');
  const control = comprobarDigito(primera.slice(5) + segunda.slice(0, 7) + segunda.slice(8, 15) + segunda.slice(18));
  const encabezado = 'LENTES: SI\nAUDÍFONOS: NO\nTELÉFONO DE EMERGENCIA:\n76543210\nA\nVehículo con carga de hasta 2 toneladas.';
  const texto = [encabezado, primera, segunda + control, 'ROJAS<PEREZ<<ANA<MARIA'.padEnd(30, '<')].join('\n');
  const campos = analizarLicencia(texto, { documentType: 'licenseBack' });
  comprobar.equal(campos.licenseNumber, '12345678');
  comprobar.equal(campos.birthDate, '06/08/2000');
  comprobar.equal(campos.licenseExpiryDate, '24/01/2030');
  comprobar.equal(campos.licenseCategory, 'A');
  comprobar.equal(campos.issueDate, '');
  comprobar.deepEqual(camposRequeridosDocumento('licenseBack', texto), ['licenseNumber']);
  comprobar.deepEqual(camposOcrPendientes({ licenseBack: { text: texto, fields: campos } }).licenseBack, []);
  for (const incompleto of [encabezado, texto.replace('12345678', '12345679')]) {
    const fields = analizarLicencia(incompleto, { documentType: 'licenseBack' });
    comprobar.equal(fields.licenseNumber, '');
    comprobar.deepEqual(camposOcrPendientes({ licenseBack: { text: incompleto, fields } }).licenseBack, ['licenseNumber']);
  }
});

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

test('licencia reciente: recupera la emisión partida cerca de una etiqueta desplazada de vencimiento', () => {
  const words = [
    { text: 'EMISIÓN', x: 130, y: 20, w: 55, h: 12 },
    { text: '02 / oct /', x: 130, y: 36, w: 60, h: 12 },
    { text: 'VENCIMIENTO', x: 250, y: 36, w: 95, h: 12 },
    { text: '2025', x: 194, y: 50, w: 35, h: 12 },
    { text: '24 / ene / 2030', x: 250, y: 50, w: 95, h: 12 }
  ];
  const texto = 'EMISIÓN:\n02 / oct /\nVENCIMIENTO:\n24 / ene / 2030\n2025';
  const resultado = analizarLicencia(texto, { documentType: 'licenseFront', words });
  comprobar.equal(resultado.issueDate, '02/10/2025');
  comprobar.equal(resultado.licenseExpiryDate, '24/01/2030');
  comprobar.equal(analizarLicencia('EMIS I0N:\n02 / oct / 2025').issueDate, '02/10/2025');
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
