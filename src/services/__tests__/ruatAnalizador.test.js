'use strict';

const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const { analizarRuat: analizarRuat } = require("../servicioOcr");

test('RUAT municipal: separa modelo comercial del año y extrae datos técnicos y propietario', () => {
  const campos = analizarRuat([
  'CERTIFICADO DE REGISTRO DE PROPIEDAD - VEHICULO AUTOMOTOR (CRPVA)',
  'GOBIERNO MUNICIPAL',
  'COCHABAMBA',
  'Fecha Registro Propiedad: 15/10/2011 Fecha Emisión: 24/10/2011',
  'CRPVA: 2THKAH7S PLACA: 1931TAB',
  'A. DATOS IDENTIFICACION',
  'Clase: CAMIONETA Modelo: 2003',
  'Marca: TOYOTA Numero Motor: 2RZ2396904',
  'Tipo Vehiculo: HILUX Numero Chasis: JTFLD26I30007712',
  'Servicio: PARTICULAR',
  'C. DATOS TECNICOS',
  'Cilindrada: 2438 cc. Tipo Carroceria: OTROS',
  'Numero Puertas: 4 Tipo Motor: INYECCION',
  'Color: ROJO',
  'Numero Plazas: 5 Combustible: GAS NATURAL',
  'II. IDENTIFICACION PROPIETARIO',
  'D. DATOS PROPIETARIO',
  'Propietario: ELIZABETH TORREZ DE MOREIRA Tipo Contribuyente: NATURAL',
  'Documento Identidad: CI 3757307 CO',
  'III. OBSERVACIONES',
  'NINGUNA'].
  join('\n'));

  comprobar.equal(campos.vehiclePlate, '1931TAB');
  comprobar.equal(campos.vehicleBrand, 'TOYOTA');
  comprobar.equal(campos.vehicleModel, 'HILUX');
  comprobar.equal(campos.vehicleYear, '2003');
  comprobar.equal(campos.vehicleClass, 'CAMIONETA');
  comprobar.equal(campos.vehicleColor, 'ROJO');
  comprobar.equal(campos.vehiclePassengerCapacity, '5');
  comprobar.equal(campos.registrationMunicipality, 'COCHABAMBA');
  comprobar.equal(campos.crpvaNumber, '2THKAH7S');
  comprobar.equal(campos.ruatIssueDate, '24/10/2011');
  comprobar.equal(campos.ownershipStartDate, '15/10/2011');
  comprobar.equal(campos.doorCount, '4');
  comprobar.equal(campos.serviceType, 'PARTICULAR');
  comprobar.equal(campos.chassisNumber, 'JTFLD26I30007712');
  comprobar.equal(campos.engineNumber, '2RZ2396904');
  comprobar.equal(campos.fuelType, 'GAS NATURAL');
  comprobar.equal(campos.engineDisplacement, '2438 CC.');
  comprobar.equal(campos.engineType, 'INYECCION');
  comprobar.equal(campos.vehicleOwnerName, 'ELIZABETH TORREZ DE MOREIRA');
  comprobar.equal(campos.vehicleOwnerCi, '3757307CO');
  comprobar.equal(campos.legalObservations, 'NINGUNA');
});

test('RUAT incompleto: no inventa el año ni la capacidad a partir de otras fechas', () => {
  const campos = analizarRuat('Fecha Registro Propiedad: 15/10/2011\nPLACA: 1931TAB');
  comprobar.equal(campos.vehicleYear, '');
  comprobar.equal(campos.vehiclePassengerCapacity, '');
});

test('RUAT fotografiado: recupera valores cuando Vision separa etiquetas y columnas', () => {
  const campos = analizarRuat([
  '9:47 PM', 'ruat 2.pdf', '894', 'PARA REALIZAR CONSULTAS:',
  'Tos HILUX', 'Motor 2R22936904', 'Chals JTFDL626130007712',
  'C ROJO', 'Sarici PARTICULAR', '1931TAB', 'Clase CAMONETA',
  'Marx TOYOTA', 'CRPVA ITHKARTS',
  'CERTIFICADO DE REGISTRO DE PROPIEDAD VEHÍCULO AUTOMOTOR (CRPVA)',
  'GOBIERNO MUNICIPAL', 'COCHABAMBA',
  'Fecha inicio Propiedad: 15/10/2011', 'Fecha Emision: 24/10/2011',
  'A. DATOS IDENTIFICACION', 'Glase', 'Marca', 'Tipo Vehiculo:',
  'Subtipo Vehículo:', 'B. DATOS GENERALES', 'Tipo Póliza',
  'C. DATOS TECNICOS', 'Cilindrada:',
  'CRPVA:', '2THKAH7S', 'PLACA:', '1931TAB',
  'CAMIONETA', 'TOYOTA', 'HILUX', 'STD',
  'Modelo:', 'Número Motor', 'Número Chasis', '2003', 'Servicio:',
  'POLIZA IMPORTACION', '2RZ2936904', 'JTFDL626130007712', 'PARTICULAR',
  '2438 cc.', 'Número Puertas', '4', 'Color', '1 Tn.', 'ROJO',
  'Número Plazas', 'Combustible', '5', 'GAS NATURAL',
  'Tipo Carrocería:', 'Tipo Motor:', 'OTROS', 'INYECCION',
  'II. IDENTIFICACIÓN PROPIETARIO', 'D. DATOS PROPIETARIO',
  'Propietario', 'Documento Identidad:', 'NATURAL', 'PMC',
  'ANA PEREZ DE FLORES', 'CI 1234567 LP',
  'III. OBSERVACIONES', 'NINGUNA'].
  join('\n'));

  comprobar.deepEqual({
    plate: campos.vehiclePlate,
    brand: campos.vehicleBrand,
    model: campos.vehicleModel,
    year: campos.vehicleYear,
    color: campos.vehicleColor,
    class: campos.vehicleClass,
    seats: campos.vehiclePassengerCapacity,
    owner: campos.vehicleOwnerName,
    ownerCi: campos.vehicleOwnerCi,
    crpva: campos.crpvaNumber,
    engine: campos.engineNumber,
    chassis: campos.chassisNumber,
    fuel: campos.fuelType,
    engineType: campos.engineType,
    service: campos.serviceType
  }, {
    plate: '1931TAB', brand: 'TOYOTA', model: 'HILUX', year: '2003',
    color: 'ROJO', class: 'CAMIONETA', seats: '5',
    owner: 'ANA PEREZ DE FLORES', ownerCi: '1234567LP',
    crpva: '2THKAH7S', engine: '2RZ2936904', chassis: 'JTFDL626130007712',
    fuel: 'GAS NATURAL', engineType: 'INYECCION', service: 'PARTICULAR'
  });
});

test('RUAT: Subtipo Vehículo no es el modelo y PMC no es el CI', () => {
  const campos = analizarRuat([
  'CI 9999999 LP',
  'A. DATOS IDENTIFICACION',
  'Tipo Vehículo:',
  'Subtipo Vehiculo',
  'HILUX',
  'STD',
  'Modelo:',
  '2003',
  'NATURAL PMC',
  '3757307016',
  'II. IDENTIFICACIÓN PROPIETARIO',
  'D. DATOS PROPIETARIO',
  'Propietario',
  'Documento Identidad:',
  'ANA PEREZ DE FLORES',
  'CI 1234567 CB'].
  join('\n'));

  comprobar.equal(campos.vehicleModel, 'HILUX');
  comprobar.equal(campos.vehicleYear, '2003');
  comprobar.equal(campos.vehicleOwnerName, 'ANA PEREZ DE FLORES');
  comprobar.equal(campos.vehicleOwnerCi, '1234567CB');
});

test('RUAT usa posiciones para vincular etiquetas y valores aunque el texto OCR mezcle columnas', () => {
  const palabras = [];
  const put = (valor, x, y) => {
    for (const token of valor.split(' ')) {
      palabras.push({ text: token, x, y, w: token.length * 10, h: 20 });
      x += token.length * 10 + 8;
    }
  };
  put('PLACA', 100, 60);put('1931TAB', 210, 60);
  put('CRPVA', 650, 60);put('2THKAH7S', 770, 60);
  put('MARCA', 100, 120);put('TOYOTA', 210, 120);
  put('NUMERO MOTOR', 650, 120);put('2RZ2396904', 850, 120);
  put('TIPO VEHICULO', 100, 180);put('HILUX', 300, 180);
  put('SUBTIPO VEHICULO', 650, 180);put('STD', 900, 180);
  put('MODELO', 100, 240);put('2003', 210, 240);
  put('COLOR', 100, 300);put('ROJO', 210, 300);
  put('PROPIETARIO', 100, 360);put('ANA PEREZ DE FLORES', 300, 360);
  put('DOCUMENTO IDENTIDAD', 100, 420);put('CI 1234567 CB', 380, 420);
  put('PMC', 700, 420);put('3757307016', 780, 420);
  const texto = [
  'MARCA:', 'NUMERO MOTOR', 'MODELO:', 'SUBTIPO VEHICULO',
  'DOCUMENTO IDENTIDAD: PMC 3757307016'].
  join('\n');
  const campos = analizarRuat(texto, { words: palabras });
  comprobar.equal(campos.vehiclePlate, '1931TAB');
  comprobar.equal(campos.crpvaNumber, '2THKAH7S');
  comprobar.equal(campos.vehicleBrand, 'TOYOTA');
  comprobar.equal(campos.engineNumber, '2RZ2396904');
  comprobar.equal(campos.vehicleModel, 'HILUX');
  comprobar.equal(campos.vehicleYear, '2003');
  comprobar.equal(campos.vehicleColor, 'ROJO');
  comprobar.equal(campos.vehicleOwnerName, 'ANA PEREZ DE FLORES');
  comprobar.equal(campos.vehicleOwnerCi, '1234567CB');
});

test('RUAT espacial acepta un valor debajo de su etiqueta sin tomar la siguiente columna', () => {
  const palabras = [
  { text: 'TIPO', x: 100, y: 100, w: 40, h: 20 },
  { text: 'VEHICULO', x: 148, y: 100, w: 80, h: 20 },
  { text: 'SUBTIPO', x: 600, y: 100, w: 70, h: 20 },
  { text: 'VEHICULO', x: 678, y: 100, w: 80, h: 20 },
  { text: 'HILUX', x: 260, y: 130, w: 55, h: 20 },
  { text: 'STD', x: 790, y: 130, w: 35, h: 20 },
  { text: 'COLOR', x: 1000, y: 130, w: 50, h: 20 }];

  const campos = analizarRuat('TIPO VEHICULO\nSUBTIPO VEHICULO', { words: palabras });
  comprobar.equal(campos.vehicleModel, 'HILUX');
});

test('RUAT no toma una fecha como propietario cuando Vision lee las columnas fuera de orden', () => {
  const texto = [
  'D. DATOS PROPIETARIO',
  'Propietario:',
  '12/12/2007',
  '2007',
  '2438 cc.',
  ...Array.from({ length: 22 }, (_, indice) => String(indice + 1)),
  'Documento Identidad:',
  'ELIZABETH TORREZ de MOREIRA',
  'CI 3757307 CO',
  'PMC:',
  '3757307016',
  'III. OBSERVACIONES',
  'NINGUNA'].
  join('\n');
  const campos = analizarRuat(texto);
  comprobar.equal(campos.vehicleOwnerName, 'ELIZABETH TORREZ DE MOREIRA');
  comprobar.equal(campos.vehicleOwnerCi, '3757307CO');
});

test('RUAT deja propietario y CI vacíos si solo hay fecha y PMC', () => {
  const campos = analizarRuat([
  'D. DATOS PROPIETARIO', 'Propietario:', '12/12/2007',
  'Documento Identidad:', 'PMC: 3757307016',
  'III. OBSERVACIONES'].
  join('\n'));
  comprobar.equal(campos.vehicleOwnerName, '');
  comprobar.equal(campos.vehicleOwnerCi, '');
});
