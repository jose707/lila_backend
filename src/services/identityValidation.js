// Pure validation: only pass results produced by the server OCR service.
function isoDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || ''));
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

function validateIdentity(front, back, today = new Date().toISOString().slice(0, 10)) {
  const fail = message => { const error = new Error(message); error.status = 422; throw error; };
  for (const side of [front, back]) {
    if (!side || side.rejected) fail('Repite la captura: no se reconoce el lado de la cédula.');
  }
  const f = front.fields;
  const b = back.fields || {};
  const legacy = f.format === 'legacy' || b.format === 'legacy';
  if (legacy && (f.format !== 'legacy' || b.format !== 'legacy')) {
    fail('Las dos caras no corresponden al mismo formato de cédula. Repite las capturas.');
  }
  const required = legacy ? {
    ciFront: ['ciNumber', 'issueDate', 'expiryDate'],
    ciBack: ['firstNames', 'surnames', 'birthDate', 'birthPlace', 'address', 'occupation', 'maritalStatus'],
  } : {
    ciFront: ['ciNumber', 'firstNames', 'surnames', 'birthDate', 'issueDate', 'expiryDate'],
    ciBack: ['birthPlace', 'address', 'occupation', 'maritalStatus'],
  };
  const fieldNames = {
    ciNumber: 'número de CI', firstNames: 'nombres', surnames: 'apellidos',
    birthDate: 'fecha de nacimiento', issueDate: 'fecha de emisión',
    expiryDate: 'fecha de expiración', birthPlace: 'lugar de nacimiento',
    address: 'domicilio', occupation: 'profesión', maritalStatus: 'estado civil',
  };
  for (const [side, fields, sideName] of [[f, required.ciFront, 'frontal'], [b, required.ciBack, 'posterior']]) {
    const missing = fields.filter(key => !String(side?.[key] || '').trim());
    if (missing.length) fail(`No se pudieron leer estos datos del lado ${sideName}: ${missing.map(key => fieldNames[key]).join(', ')}. Repite esa captura con buena luz y el documento completo.`);
  }
  const mrz = require('./ciMrz').inspectMrz(back.rawText);
  if (mrz.status === 'invalid') fail('La zona MRZ tiene dígitos de control incorrectos. Repite la foto posterior.');
  const name = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/\s+/).filter(Boolean).sort().join(' ');
  const birthYYMMDD = value => value.slice(8, 10) + value.slice(3, 5) + value.slice(0, 2);
  if ((b.ciNumber && f.ciNumber !== b.ciNumber) ||
      (!legacy && b.birthDate && birthYYMMDD(f.birthDate) !== birthYYMMDD(b.birthDate)) ||
      (!legacy && b.fullName && name(f.fullName) !== name(b.fullName))) {
    fail('Los datos de ambas caras de la cédula no coinciden.');
  }
  if (!legacy && mrz.status === 'valid' && (mrz.documentNumber !== f.ciNumber || mrz.birth !== birthYYMMDD(f.birthDate))) fail('La zona MRZ no coincide con el frente.');
  const identitySide = legacy ? b : f;
  const birthDate = isoDate(identitySide.birthDate);
  const issueDate = isoDate(f.issueDate);
  const expiryDate = isoDate(f.expiryDate);
  if (!birthDate || birthDate > today) fail('La fecha de nacimiento no es válida.');
  if (f.issueDate && (!issueDate || issueDate > today || issueDate < birthDate)) fail('La fecha de emisión no es válida.');
  if (f.expiryDate && (!expiryDate || expiryDate < today || (issueDate && expiryDate < issueDate))) fail('La cédula está vencida o su vigencia no es válida.');
  if (!issueDate) fail('No se pudo leer la fecha de emisión. Repite la captura frontal.');
  if (!expiryDate) fail('No se pudo leer la fecha de expiración. Repite la captura frontal.');
  if (!legacy && mrz.status === 'valid' && expiryDate && mrz.expiry !== birthYYMMDD(f.expiryDate)) fail('El vencimiento de la MRZ no coincide con el frente.');
  const surnameParts = String(identitySide.surnames).trim().split(/\s+/);
  return {
    firstNames: identitySide.firstNames,
    paternalSurname: surnameParts[0],
    maternalSurname: surnameParts.slice(1).join(' ') || null,
    ciNumber: f.ciNumber,
    birthDate, issueDate, expiryDate,
    ...Object.fromEntries(['birthPlace', 'address', 'occupation', 'maritalStatus', 'bloodType'].map(key => [key, b[key] || f[key] || null])),
  };
}

module.exports = { isoDate, validateIdentity };
