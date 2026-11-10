const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const { randomBytes: aleatorioBytes } = require('crypto');
const { sellar: sellar, unseal: unseal } = require("../identidadSessionCrypto");
const { comprobarDigito: comprobarDigito, inspectMrz: inspectMrz } = require('../ciMrz');
const { compararIdentidadMrz: compararIdentidadMrz, validarIdentidad: validarIdentidad } = require("../identidadValidacion");

test('evidence encryption authenticates both bytes and ownership', () => {
  const anterior = process.env.IDENTITY_STORAGE_KEY;
  process.env.IDENTITY_STORAGE_KEY = aleatorioBytes(32).toString('hex');
  try {
    const datos = { result: { fields: { ciNumber: '1234567' } }, image: 'fixture' };
    const contenido = sellar(datos, 'session:user:ciFront');
    comprobar.deepEqual(unseal(contenido, 'session:user:ciFront'), datos);
    comprobar.throws(() => unseal(contenido, 'session:other-user:ciFront'));
    comprobar.throws(() => unseal(contenido, 'session:user:ciBack'));
    contenido[contenido.length - 1] ^= 1;
    comprobar.throws(() => unseal(contenido, 'session:user:ciFront'));
  } finally {
    if (anterior === undefined) delete process.env.IDENTITY_STORAGE_KEY;else
    process.env.IDENTITY_STORAGE_KEY = anterior;
  }
});
test('missing encryption configuration fails closed', () => {
  const anterior = process.env.IDENTITY_STORAGE_KEY;
  delete process.env.IDENTITY_STORAGE_KEY;
  try {comprobar.throws(() => sellar({}, 'x'), { status: 503 });} finally
  {if (anterior !== undefined) process.env.IDENTITY_STORAGE_KEY = anterior;}
});

function mrzFixture() {
  const documento = '1234567<<';
  const primero = 'IDBOL' + documento + comprobarDigito(documento) + '<'.repeat(15);
  const middle = '900815' + comprobarDigito('900815') + 'M' + '300101' + comprobarDigito('300101') + 'BOL' + '<'.repeat(11);
  const composite = primero.slice(5) + middle.slice(0, 7) + middle.slice(8, 15) + middle.slice(18, 29);
  return [primero, middle + comprobarDigito(composite), 'PEREZ<MAMANI<<JUAN'.padEnd(30, '<')];
}
test('TD1 validates all four check digits', () => {
  const lineas = mrzFixture();
  comprobar.equal(inspectMrz(lineas.join('\n')).status, 'valid');
  for (const [linea, indice] of [[0, 14], [1, 6], [1, 14], [1, 29]]) {
    const cambiado = [...lineas];
    const chars = [...cambiado[linea]];chars[indice] = String((Number(chars[indice]) + 1) % 10);cambiado[linea] = chars.join('');
    comprobar.equal(inspectMrz(cambiado.join('\n')).status, 'invalid');
  }
});
test('missing or unfamiliar MRZ layouts are explicitly unverified', () => {
  comprobar.equal(inspectMrz('DOMICILIO\nCALLE 1').status, 'unavailable');
  comprobar.equal(inspectMrz('IDBOL1234\n9008150').status, 'unsupported');
});
test('server checks MRZ against printed fields and expiry', () => {
  const f = { fields: { ciNumber: '1234567', firstNames: 'JUAN', surnames: 'PEREZ MAMANI', fullName: 'JUAN PEREZ MAMANI', birthDate: '15/08/1990', issueDate: '01/01/2020', expiryDate: '01/01/2030' } };
  const segundo = { fields: { ciNumber: '1234567', fullName: 'PEREZ MAMANI JUAN', birthDate: '15/08/1990', birthPlace: 'LA PAZ', address: 'CALLE SUCRE 123', occupation: 'ESTUDIANTE', maritalStatus: 'SOLTERO' }, rawText: mrzFixture().join('\n') };
  comprobar.equal(validarIdentidad(f, segundo, '2026-10-05').ciNumber, '1234567');
  f.fields.expiryDate = '02/01/2030';
  comprobar.throws(() => validarIdentidad(f, segundo, '2026-10-05'), /vencimiento/);
});

test('MRZ comparison reports a match, mismatch, and unavailable formats accurately', () => {
  const frontal = { fields: {
      ciNumber: '1234567', fullName: 'JUAN PEREZ MAMANI',
      birthDate: '15/08/1990', expiryDate: '01/01/2030'
    } };
  const reverso = { fields: { fullName: 'PEREZ MAMANI JUAN' }, rawText: mrzFixture().join('\n') };
  comprobar.equal(compararIdentidadMrz(frontal, reverso, 'current'), 'match');
  comprobar.equal(compararIdentidadMrz({ fields: { ...frontal.fields, expiryDate: '02/01/2030' } }, reverso, 'current'), 'mismatch');
  comprobar.equal(compararIdentidadMrz(frontal, { ...reverso, fields: { fullName: 'OTRO NOMBRE' } }, 'current'), 'mismatch');
  comprobar.equal(compararIdentidadMrz({ fields: { ...frontal.fields, expiryDate: '' } }, reverso, 'current'), 'incomplete');
  const corrupted = mrzFixture();
  corrupted[0] = corrupted[0].slice(0, 14) + '9' + corrupted[0].slice(15);
  comprobar.equal(compararIdentidadMrz(frontal, { ...reverso, rawText: corrupted.join('\n') }, 'current'), 'invalid');
  comprobar.equal(compararIdentidadMrz(frontal, { ...reverso, rawText: 'IDBOL1234\n9008150' }, 'current'), 'unsupported');
  comprobar.equal(compararIdentidadMrz(frontal, { ...reverso, rawText: 'DOMICILIO CALLE 1' }, 'current'), 'unavailable');
  comprobar.equal(compararIdentidadMrz(frontal, reverso, 'legacy'), 'not_applicable');
});


test('el consentimiento publicado entrega el texto del archivo de su misma versión', () => {
  const {obtenerConsentimientoIdentidad,validarConsentimientoIdentidad}=require('../consentimientos');
  const publicado=obtenerConsentimientoIdentidad();
  const texto=require('fs').readFileSync(require('path').join(__dirname,'../../../consentimientos',publicado.version+'.txt'),'utf8').trim();
  comprobar.equal(publicado.texto,texto);comprobar.ok(texto.length>0);
  comprobar.equal(validarConsentimientoIdentidad({consent:'true',consentVersion:publicado.version}).version,publicado.version);
  comprobar.equal(validarConsentimientoIdentidad({consent:true,consentVersion:publicado.version}).texto,texto);
  comprobar.ok(Object.isFrozen(publicado));
});
test('no se acepta una autorización ausente ni una versión diferente a la mostrada por el servidor',()=>{
 const {validarConsentimientoIdentidad,obtenerConsentimientoIdentidad}=require('../consentimientos');
 for(const consent of [false,'false',undefined,1])comprobar.throws(()=>validarConsentimientoIdentidad({consent,consentVersion:obtenerConsentimientoIdentidad().version}),{status:400});
 for(const version of [undefined,null,'','identity-documents-v0','../../otro',['identity-documents-v1']])comprobar.throws(()=>validarConsentimientoIdentidad({consent:true,consentVersion:version}),{status:409,code:'CONSENT_VERSION_MISMATCH'});
});
