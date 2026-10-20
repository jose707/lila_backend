const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkDigit, inspectMrz } = require('../ciMrz');
const { parseMRZ } = require('../ocrService');

function bolivianMrz(prefix = 'I<BOL') {
  const number = '1234567<<';
  const first = `${prefix}${number}${checkDigit(number)}${'<'.repeat(15)}`;
  const second = `900815${checkDigit('900815')}M300101${checkDigit('300101')}BOL${'<'.repeat(11)}`;
  const composite = first.slice(5) + second.slice(0, 7) + second.slice(8, 15) + second.slice(18, 29);
  return [first, second + checkDigit(composite), 'PEREZ<MAMANI<<JUAN'.padEnd(30, '<')];
}

test('reconoce el prefijo I<BOL y extrae datos de TD1 aunque el OCR inserte espacios', () => {
  const lines = bolivianMrz();
  const spacedText = lines.map(line => [...line].join(' ')).join('\n');

  assert.equal(inspectMrz(spacedText).status, 'valid');
  assert.deepEqual(parseMRZ(spacedText), {
    ciNumber: '1234567',
    fullName: 'PEREZ MAMANI JUAN',
    birthDate: '15/08/1990',
    mrz: true,
  });
});
