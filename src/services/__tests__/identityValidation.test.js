const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isoDate, validateIdentity } = require('../identityValidation');
const front = () => ({ fields: {
  ciNumber: '1234567', fullName: 'JUAN PEREZ MAMANI', firstNames: 'JUAN', surnames: 'PEREZ MAMANI',
  paternalSurname: 'PEREZ', maternalSurname: 'MAMANI', birthDate: '15/08/1990',
  issueDate: '01/01/2020', expiryDate: '01/01/2030',
} });
const back = () => ({ fields: { fullName: 'PEREZ MAMANI JUAN', ciNumber: '1234567', birthDate: '15/08/1990', address: 'CALLE 123', birthPlace: 'LA PAZ', occupation: 'INGENIERO', maritalStatus: 'SOLTERO' } });
test('calendar dates include leap-year validation', () => {
  assert.equal(isoDate('31/02/2024'), null);
  assert.equal(isoDate('29/02/2023'), null);
  assert.equal(isoDate('29/02/2024'), '2024-02-29');
});
test('merges posterior data and normalizes dates', () => {
  const result = validateIdentity(front(), back(), '2026-10-05');
  assert.equal(result.address, 'CALLE 123');
  assert.equal(result.birthDate, '1990-08-15');
});
for (const key of ['ciNumber', 'firstNames', 'surnames', 'birthDate', 'issueDate', 'expiryDate']) {
  test(`requires front ${key}`, () => {
    const f = front(); f.fields[key] = '';
    assert.throws(() => validateIdentity(f, back()), { status: 422 });
  });
}
for (const key of ['birthPlace', 'address', 'occupation', 'maritalStatus']) {
  test(`requires back ${key}`, () => {
    const b = back(); b.fields[key] = '';
    assert.throws(() => validateIdentity(front(), b), { status: 422 });
  });
}
test('rejects expired documents, future issuance and rejected captures', () => {
  const f = front(); f.fields.expiryDate = '01/01/2025';
  assert.throws(() => validateIdentity(f, back(), '2026-10-05'));
  f.fields.expiryDate = '01/01/2030'; f.fields.issueDate = '01/01/2027';
  assert.throws(() => validateIdentity(f, back(), '2026-10-05'));
  assert.throws(() => validateIdentity({ ...front(), rejected: true }, back()));
});
test('splits database surname columns without storing a duplicate raw value', () => {
  const f = front(); f.fields.surnames = 'PEREZ MAMANI QUISPE';
  const result = validateIdentity(f, back());
  assert.equal(result.paternalSurname, 'PEREZ');
  assert.equal(result.maternalSurname, 'MAMANI QUISPE');
  assert.equal('rawSurnames' in result, false);
});
test('missing expiry requires review instead of treating it as indefinite', () => {
  const f = front(); delete f.fields.expiryDate;
  assert.throws(() => validateIdentity(f, back()), { status: 422 });
});
