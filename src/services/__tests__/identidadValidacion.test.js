const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const { isoFecha: isoFecha, comprobarAdulto: comprobarAdulto, validarIdentidad: validarIdentidad } = require("../identidadValidacion");
const frontal = () => ({ fields: {
    ciNumber: '1234567', fullName: 'JUAN PEREZ MAMANI', firstNames: 'JUAN', surnames: 'PEREZ MAMANI',
    paternalSurname: 'PEREZ', maternalSurname: 'MAMANI', birthDate: '15/08/1990',
    issueDate: '01/01/2020', expiryDate: '01/01/2030'
  } });
const reverso = () => ({ fields: { fullName: 'PEREZ MAMANI JUAN', ciNumber: '1234567', birthDate: '15/08/1990', address: 'CALLE 123', birthPlace: 'LA PAZ', occupation: 'INGENIERO', maritalStatus: 'SOLTERO' } });
test('calendar dates include leap-year validation', () => {
  comprobar.equal(isoFecha('31/02/2024'), null);
  comprobar.equal(isoFecha('29/02/2023'), null);
  comprobar.equal(isoFecha('29/02/2024'), '2024-02-29');
});
test('merges posterior data and normalizes dates', () => {
  const resultado = validarIdentidad(frontal(), reverso(), '2026-10-05');
  comprobar.equal(resultado.address, 'CALLE 123');
  comprobar.equal(resultado.birthDate, '1990-08-15');
});
for (const clave of ['ciNumber', 'firstNames', 'surnames', 'birthDate', 'issueDate', 'expiryDate']) {
  test(`requires front ${clave}`, () => {
    const f = frontal();f.fields[clave] = '';
    comprobar.throws(() => validarIdentidad(f, reverso()), { status: 422 });
  });
}
for (const clave of ['birthPlace', 'address', 'occupation', 'maritalStatus']) {
  test(`requires back ${clave}`, () => {
    const segundo = reverso();segundo.fields[clave] = '';
    comprobar.throws(() => validarIdentidad(frontal(), segundo), { status: 422 });
  });
}
test('rejects expired documents, future issuance and rejected captures', () => {
  const f = frontal();f.fields.expiryDate = '01/01/2025';
  comprobar.throws(() => validarIdentidad(f, reverso(), '2026-10-05'));
  f.fields.expiryDate = '01/01/2030';f.fields.issueDate = '01/01/2027';
  comprobar.throws(() => validarIdentidad(f, reverso(), '2026-10-05'));
  comprobar.throws(() => validarIdentidad({ ...frontal(), rejected: true }, reverso()));
});
test('splits database surname columns without storing a duplicate raw value', () => {
  const f = frontal();f.fields.surnames = 'PEREZ MAMANI QUISPE';
  const resultado = validarIdentidad(f, reverso());
  comprobar.equal(resultado.paternalSurname, 'PEREZ');
  comprobar.equal(resultado.maternalSurname, 'MAMANI QUISPE');
  comprobar.equal('rawSurnames' in resultado, false);
});
test('missing expiry requires review instead of treating it as indefinite', () => {
  const f = frontal();delete f.fields.expiryDate;
  comprobar.throws(() => validarIdentidad(f, reverso()), { status: 422 });
});
test('rejects an underage current CI before missing occupation', () => {
  const f = frontal();
  const segundo = reverso();
  f.fields.birthDate = '24/10/2008';
  segundo.fields.birthDate = '24/10/2008';
  segundo.fields.occupation = '';
  comprobar.throws(() => validarIdentidad(f, segundo, '2026-10-23'), {
    status: 422, code: 'UNDERAGE', message: 'No se permite el registro de menores de 18 años.'
  });
});
test('uses the reverse birth date for an older-model CI', () => {
  const f = frontal();
  const segundo = reverso();
  f.fields.format = 'legacy';
  segundo.fields.format = 'legacy';
  segundo.fields.birthDate = '24/10/2008';
  segundo.fields.occupation = '';
  comprobar.throws(() => validarIdentidad(f, segundo, '2026-10-23'), { status: 422, code: 'UNDERAGE' });
});
test('older-model CI reports underage before a side rejection when reverse date is readable', () => {
  const f = frontal();
  const segundo = reverso();
  f.fields.format = 'legacy';
  segundo.fields.format = 'legacy';
  segundo.fields.birthDate = '05/02/2010';
  segundo.fields.occupation = '';
  segundo.rejected = true;
  comprobar.throws(() => validarIdentidad(f, segundo, '2026-10-23'), {
    status: 422, code: 'UNDERAGE', message: 'No se permite el registro de menores de 18 años.'
  });
});
test('allows someone exactly 18 and still requires adult occupation', () => {
  comprobar.doesNotThrow(() => comprobarAdulto('2008-10-23', '2026-10-23'));
  comprobar.throws(() => comprobarAdulto('2008-10-24', '2026-10-23'), { code: 'UNDERAGE' });
  const f = frontal();
  const segundo = reverso();
  f.fields.birthDate = '23/10/2008';
  segundo.fields.birthDate = '23/10/2008';
  segundo.fields.occupation = '';
  comprobar.throws(() => validarIdentidad(f, segundo, '2026-10-23'), {
    status: 422,
    message: /No se pudieron leer estos datos del lado posterior: profesión/
  });
});
