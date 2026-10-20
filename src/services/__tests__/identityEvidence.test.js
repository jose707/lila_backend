const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('crypto');
const { seal, unseal } = require('../identitySessionCrypto');
const { checkDigit, inspectMrz } = require('../ciMrz');
const { validateIdentity } = require('../identityValidation');

test('evidence encryption authenticates both bytes and ownership', () => {
  const previous = process.env.IDENTITY_STORAGE_KEY;
  process.env.IDENTITY_STORAGE_KEY = randomBytes(32).toString('hex');
  try {
    const data = { result: { fields: { ciNumber: '1234567' } }, image: 'fixture' };
    const payload = seal(data, 'session:user:ciFront');
    assert.deepEqual(unseal(payload, 'session:user:ciFront'), data);
    assert.throws(() => unseal(payload, 'session:other-user:ciFront'));
    assert.throws(() => unseal(payload, 'session:user:ciBack'));
    payload[payload.length - 1] ^= 1;
    assert.throws(() => unseal(payload, 'session:user:ciFront'));
  } finally {
    if (previous === undefined) delete process.env.IDENTITY_STORAGE_KEY;
    else process.env.IDENTITY_STORAGE_KEY = previous;
  }
});
test('missing encryption configuration fails closed', () => {
  const previous = process.env.IDENTITY_STORAGE_KEY;
  delete process.env.IDENTITY_STORAGE_KEY;
  try { assert.throws(() => seal({}, 'x'), { status: 503 }); }
  finally { if (previous !== undefined) process.env.IDENTITY_STORAGE_KEY = previous; }
});

function mrzFixture() {
  const document = '1234567<<';
  const first = 'IDBOL' + document + checkDigit(document) + '<'.repeat(15);
  const middle = '900815' + checkDigit('900815') + 'M' + '300101' + checkDigit('300101') + 'BOL' + '<'.repeat(11);
  const composite = first.slice(5) + middle.slice(0, 7) + middle.slice(8, 15) + middle.slice(18, 29);
  return [first, middle + checkDigit(composite), 'PEREZ<MAMANI<<JUAN'.padEnd(30, '<')];
}
test('TD1 validates all four check digits', () => {
  const lines = mrzFixture();
  assert.equal(inspectMrz(lines.join('\n')).status, 'valid');
  for (const [line, index] of [[0, 14], [1, 6], [1, 14], [1, 29]]) {
    const changed = [...lines];
    const chars = [...changed[line]]; chars[index] = String((Number(chars[index]) + 1) % 10); changed[line] = chars.join('');
    assert.equal(inspectMrz(changed.join('\n')).status, 'invalid');
  }
});
test('missing or unfamiliar MRZ layouts are explicitly unverified', () => {
  assert.equal(inspectMrz('DOMICILIO\nCALLE 1').status, 'unavailable');
  assert.equal(inspectMrz('IDBOL1234\n9008150').status, 'unsupported');
});
test('server checks MRZ against printed fields and expiry', () => {
  const f = { fields: { ciNumber: '1234567', firstNames: 'JUAN', surnames: 'PEREZ MAMANI', fullName: 'JUAN PEREZ MAMANI', birthDate: '15/08/1990', issueDate: '01/01/2020', expiryDate: '01/01/2030' } };
  const b = { fields: { ciNumber: '1234567', fullName: 'PEREZ MAMANI JUAN', birthDate: '15/08/1990', birthPlace: 'LA PAZ', address: 'CALLE SUCRE 123', occupation: 'ESTUDIANTE', maritalStatus: 'SOLTERO' }, rawText: mrzFixture().join('\n') };
  assert.equal(validateIdentity(f, b, '2026-10-05').ciNumber, '1234567');
  f.fields.expiryDate = '02/01/2030';
  assert.throws(() => validateIdentity(f, b, '2026-10-05'), /vencimiento/);
});
