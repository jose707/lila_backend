const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCI, validateCI } = require('../ocrService');
const { validateIdentity } = require('../identityValidation');

// Texto ficticio con la distribución de campos de la CI anterior.
const frontText = [
  'ESTADO PLURINACIONAL DE BOLIVIA',
  'CEDULA DE IDENTIDAD',
  'Serie 44333 Seccion 44242',
  'No. 7654321',
  'Emitida el 28 de Abril de 2024',
  'Expira el 28 de Abril de 2034',
].join('\n');

const backText = [
  'EL SERVICIO GENERAL DE IDENTIFICACION PERSONAL',
  'CERTIFICA: Que la firma, fotografia',
  'Nº 7654321',
  'A: ANA MARIA PEREZ MAMANI',
  'Nacida el 26 de Diciembre de 1998',
  'EN: LA PAZ - MURILLO',
  'Estado Civil: SOLTERA',
  'Profesion/Ocupacion: ESTUDIANTE',
  'Domicilio: CALLE SUCRE 123',
  'DOCUMENTOS REGISTRADOS',
].join('\n');

const parsed = () => ({
  front: { fields: parseCI(frontText, { documentType: 'ciFront' }), rawText: frontText },
  back: { fields: parseCI(backText, { documentType: 'ciBack' }), rawText: backText },
});

test('the previous CI layout reads written dates and identity on the reverse', () => {
  const { front, back } = parsed();
  assert.equal(validateCI(frontText, 1, 'ciFront').rejected, false);
  assert.equal(validateCI(backText, 0, 'ciBack').rejected, false);
  assert.equal(front.fields.format, 'legacy');
  assert.equal(back.fields.format, 'legacy');
  assert.equal(front.fields.issueDate, '28/04/2024');
  assert.equal(front.fields.expiryDate, '28/04/2034');
  assert.equal(back.fields.firstNames, 'ANA MARIA');
  assert.equal(back.fields.surnames, 'PEREZ MAMANI');
  assert.equal(back.fields.birthDate, '26/12/1998');
  assert.equal(back.fields.birthPlace, 'LA PAZ MURILLO');
  assert.equal(back.fields.occupation, 'ESTUDIANTE');
  assert.equal(back.fields.maritalStatus, 'SOLTERA');
  assert.equal(back.fields.address, 'CALLE SUCRE 123');
  const identity = validateIdentity(front, back, '2026-10-16');
  assert.equal(identity.firstNames, 'ANA MARIA');
  assert.equal(identity.paternalSurname, 'PEREZ');
  assert.equal(identity.maternalSurname, 'MAMANI');
  assert.equal(identity.birthDate, '1998-12-26');
  assert.equal(identity.birthPlace, 'LA PAZ MURILLO');
});

test('previous CI rejects mismatched sides, document numbers and missing fields', () => {
  const { front, back } = parsed();
  back.fields.ciNumber = '1234567';
  assert.throws(() => validateIdentity(front, back, '2026-10-16'), { status: 422 });
  back.fields.ciNumber = front.fields.ciNumber;
  back.fields.occupation = '';
  assert.throws(() => validateIdentity(front, back, '2026-10-16'), { status: 422 });
  back.fields.occupation = 'ESTUDIANTE';
  back.fields.format = 'current';
  assert.throws(() => validateIdentity(front, back, '2026-10-16'), { status: 422 });
  back.fields.format = 'legacy';
  front.fields.expiryDate = '28/04/2023';
  assert.throws(() => validateIdentity(front, back, '2026-10-16'), { status: 422 });
});

test('the reverse MRZ selects the format even when OCR misses legacy header words', () => {
  const noisyBack = backText
    .replace('CERTIFICA: Que la firma, fotografia\n', '')
    .replace('A: ANA MARIA PEREZ MAMANI\nNacida el', 'A: ANA MARIA PEREZ MAMANI Nacida el');
  const back = parseCI(noisyBack, { documentType: 'ciBack' });
  const front = parseCI(frontText, { documentType: 'ciFront', format: back.format });
  assert.equal(back.format, 'legacy');
  assert.equal(front.format, 'legacy');
  assert.equal(back.firstNames, 'ANA MARIA');
  assert.equal(back.surnames, 'PEREZ MAMANI');
  assert.equal(back.birthDate, '26/12/1998');
  assert.equal(back.birthPlace, 'LA PAZ MURILLO');
});

test('the previous CI requires the place after EN and the other reverse fields', () => {
  const { front, back } = parsed();
  back.fields.birthPlace = '';
  assert.throws(() => validateIdentity(front, back, '2026-10-16'), /lugar de nacimiento/);
  back.fields.birthPlace = 'LA PAZ MURILLO';
  back.fields.address = '';
  assert.throws(() => validateIdentity(front, back, '2026-10-16'), /domicilio/);
});

test('the previous CI reads an isolated EN label below the birth date', () => {
  const text = backText.replace('EN: LA PAZ - MURILLO', 'EN\nLA PAZ - MURILLO');
  const back = parseCI(text, { documentType: 'ciBack' });
  assert.equal(back.birthPlace, 'LA PAZ MURILLO');
});

test('the previous CI reads A and EN when Vision joins or splits their lines', () => {
  const text = backText
    .replace('A: ANA MARIA PEREZ MAMANI', 'A:\nANA MARIA PEREZ MAMANI')
    .replace('Nacida el 26 de Diciembre de 1998\nEN: LA PAZ - MURILLO',
      'Nacida el 26 de Diciembre de 1998 EN LA PAZ - MURILLO');
  const back = parseCI(text, { documentType: 'ciBack' });
  assert.equal(back.firstNames, 'ANA MARIA');
  assert.equal(back.surnames, 'PEREZ MAMANI');
  assert.equal(back.birthPlace, 'LA PAZ MURILLO');
});

test('the previous CI reads the name after the certification phrase ending in A:', () => {
  const text = backText.replace(
    'A: ANA MARIA PEREZ MAMANI',
    'CERTIFICA QUE LA FIRMA Y FOTOGRAFIA PERTENECEN A:\nANA MARIA PEREZ MAMANI',
  );
  const back = parseCI(text, { documentType: 'ciBack' });
  assert.equal(back.firstNames, 'ANA MARIA');
  assert.equal(back.surnames, 'PEREZ MAMANI');
});

test('the previous CI joins a name split into two OCR lines after A:', () => {
  const text = backText.replace(
    'A: ANA MARIA PEREZ MAMANI',
    'PERTENECEN A:\nANA MARIA\nPEREZ MAMANI',
  );
  const back = parseCI(text, { documentType: 'ciBack' });
  assert.equal(back.firstNames, 'ANA MARIA');
  assert.equal(back.surnames, 'PEREZ MAMANI');
});

test('the previous CI does not infer a place when EN is missing', () => {
  const text = backText.replace('EN: LA PAZ - MURILLO\n', '');
  const back = parseCI(text, { documentType: 'ciBack' });
  assert.equal(back.birthPlace, '');
});

test('legacy front recovers two complete dates when Vision misses their labels', () => {
  const noisyFront = frontText
    .replace('Emitida el 28 de Abril de 2024', 'Emtda\nel 28 de\nAbril del 2024')
    .replace('Expira el 28 de Abril de 2034', 'Expra\nel 28 de\nAbril de 2034');
  const parsed = parseCI(noisyFront, { documentType: 'ciFront', format: 'legacy' });
  assert.equal(parsed.issueDate, '28/04/2024');
  assert.equal(parsed.expiryDate, '28/04/2034');
});

test('legacy front does not assign dates when three dates are present', () => {
  const ambiguous = frontText
    .replace('Emitida el', 'Emtda')
    .replace('Expira el', 'Expra') + '\nOtro dato 28 de Abril de 2028';
  const parsed = parseCI(ambiguous, { documentType: 'ciFront', format: 'legacy' });
  assert.equal(parsed.issueDate, '');
  assert.equal(parsed.expiryDate, '');
});
