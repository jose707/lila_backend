// Pure validation: only pass results produced by the server OCR service.
function isoFecha(valor) {
  const coincidencia = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(valor || ''));
  if (!coincidencia) return null;
  const [, dia, mes, anio] = coincidencia;
  const iso = `${anio}-${mes}-${dia}`;
  const fecha = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === iso ? iso : null;
}

function boliviaHoy() {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const valor = (tipo) => partes.find((part) => part.type === tipo).value;
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

function comprobarAdulto(nacimientoFecha, hoy = boliviaHoy()) {
  const fecha = new Date(`${nacimientoFecha}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(nacimientoFecha || '')) ||
  !Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== nacimientoFecha ||
  nacimientoFecha > hoy) {
    const error = new Error('La fecha de nacimiento no es válida.');
    error.status = 422;
    throw error;
  }
  const [anio, mes, dia] = nacimientoFecha.split('-').map(Number);
  const [realAnio, realMes, realDia] = hoy.split('-').map(Number);
  const antiguedad = realAnio - anio - (realMes < mes || realMes === mes && realDia < dia ? 1 : 0);
  if (antiguedad < 18) {
    const error = new Error('No se permite el registro de menores de 18 años.');
    error.status = 422;
    error.code = 'UNDERAGE';
    throw error;
  }
}

const canonicalNombre = (valor) => String(valor || '').normalize('NFD').
replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/\s+/).filter(Boolean).sort().join(' ');

function compararIdentidadMrz(frontal, reverso, ciFormatear) {
  if (ciFormatear === 'legacy') return 'not_applicable';
  const mrz = require('./ciMrz').inspectMrz(reverso?.rawText);
  if (mrz.status !== 'valid') return mrz.status;
  const f = frontal?.fields || {};
  const segundo = reverso?.fields || {};
  const nacimiento = isoFecha(f.birthDate);
  const vencimiento = isoFecha(f.expiryDate);
  const frontalNombre = f.fullName || [f.firstNames, f.surnames].filter(Boolean).join(' ');
  if (!f.ciNumber || !nacimiento || !vencimiento || !frontalNombre || !segundo.fullName) return 'incomplete';
  const mrzFecha = (iso) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
  return mrz.documentNumber === String(f.ciNumber).trim() &&
  mrz.birth === mrzFecha(nacimiento) && mrz.expiry === mrzFecha(vencimiento) &&
  canonicalNombre(frontalNombre) === canonicalNombre(segundo.fullName) ?
  'match' : 'mismatch';
}

function validarIdentidad(frontal, reverso, hoy = boliviaHoy()) {
  const fallar = (mensaje) => {const error = new Error(mensaje);error.status = 422;throw error;};
  const f = frontal?.fields || {};
  const segundo = reverso?.fields || {};
  const antiguo = f.format === 'legacy' || segundo.format === 'legacy';
  // La edad se verifica antes de exigir profesión u ocupación: esos datos
  // pueden faltar legítimamente en la cédula de un menor. También precede
  // al rechazo de lado cuando la fecha del documento sí pudo leerse.
  const identidadLado = antiguo ? segundo : f;
  const earlyNacimientoFecha = isoFecha(identidadLado.birthDate);
  if (earlyNacimientoFecha && earlyNacimientoFecha <= hoy) comprobarAdulto(earlyNacimientoFecha, hoy);
  for (const lado of [frontal, reverso]) {
    if (!lado || lado.rejected) fallar('Repite la captura: no se reconoce el lado de la cédula.');
  }
  if (antiguo && (f.format !== 'legacy' || segundo.format !== 'legacy')) {
    fallar('Las dos caras no corresponden al mismo formato de cédula. Repite las capturas.');
  }
  const requerido = antiguo ? {
    ciFront: ['ciNumber', 'issueDate', 'expiryDate'],
    ciBack: ['firstNames', 'surnames', 'birthDate', 'birthPlace', 'address', 'occupation', 'maritalStatus']
  } : {
    ciFront: ['ciNumber', 'firstNames', 'surnames', 'birthDate', 'issueDate', 'expiryDate'],
    ciBack: ['birthPlace', 'address', 'occupation', 'maritalStatus']
  };
  const campoNames = {
    ciNumber: 'número de CI', firstNames: 'nombres', surnames: 'apellidos',
    birthDate: 'fecha de nacimiento', issueDate: 'fecha de emisión',
    expiryDate: 'fecha de expiración', birthPlace: 'lugar de nacimiento',
    address: 'domicilio', occupation: 'profesión', maritalStatus: 'estado civil'
  };
  for (const [lado, campos, ladoNombre] of [[f, requerido.ciFront, 'frontal'], [segundo, requerido.ciBack, 'posterior']]) {
    const faltante = campos.filter((clave) => !String(lado?.[clave] || '').trim());
    if (faltante.length) fallar(`No se pudieron leer estos datos del lado ${ladoNombre}: ${faltante.map((clave) => campoNames[clave]).join(', ')}. Repite esa captura con buena luz y el documento completo.`);
  }
  const mrz = require('./ciMrz').inspectMrz(reverso.rawText);
  if (mrz.status === 'invalid') fallar('La zona MRZ tiene dígitos de control incorrectos. Repite la foto posterior.');
  const nacimientoYYMMDD = (valor) => valor.slice(8, 10) + valor.slice(3, 5) + valor.slice(0, 2);
  if (segundo.ciNumber && f.ciNumber !== segundo.ciNumber ||
  !antiguo && segundo.birthDate && nacimientoYYMMDD(f.birthDate) !== nacimientoYYMMDD(segundo.birthDate) ||
  !antiguo && segundo.fullName && canonicalNombre(f.fullName) !== canonicalNombre(segundo.fullName)) {
    fallar('Los datos de ambas caras de la cédula no coinciden.');
  }
  if (!antiguo && mrz.status === 'valid' && (mrz.documentNumber !== f.ciNumber || mrz.birth !== nacimientoYYMMDD(f.birthDate))) fallar('La zona MRZ no coincide con el frente.');
  const nacimientoFecha = isoFecha(identidadLado.birthDate);
  const emisionFecha = isoFecha(f.issueDate);
  const vencimientoFecha = isoFecha(f.expiryDate);
  if (!nacimientoFecha || nacimientoFecha > hoy) fallar('La fecha de nacimiento no es válida.');
  if (f.issueDate && (!emisionFecha || emisionFecha > hoy || emisionFecha < nacimientoFecha)) fallar('La fecha de emisión no es válida.');
  if (f.expiryDate && (!vencimientoFecha || vencimientoFecha < hoy || emisionFecha && vencimientoFecha < emisionFecha)) fallar('La cédula está vencida o su vigencia no es válida.');
  if (!emisionFecha) fallar('No se pudo leer la fecha de emisión. Repite la captura frontal.');
  if (!vencimientoFecha) fallar('No se pudo leer la fecha de expiración. Repite la captura frontal.');
  if (!antiguo && mrz.status === 'valid' && vencimientoFecha && mrz.expiry !== nacimientoYYMMDD(f.expiryDate)) fallar('El vencimiento de la MRZ no coincide con el frente.');
  const apellidoPartes = String(identidadLado.surnames).trim().split(/\s+/);
  return {
    firstNames: identidadLado.firstNames,
    paternalSurname: apellidoPartes[0],
    maternalSurname: apellidoPartes.slice(1).join(' ') || null,
    ciNumber: f.ciNumber,
    birthDate: nacimientoFecha, issueDate: emisionFecha, expiryDate: vencimientoFecha,
    ...Object.fromEntries(['birthPlace', 'address', 'occupation', 'maritalStatus', 'bloodType'].map((clave) => [clave, segundo[clave] || f[clave] || null]))
  };
}

module.exports = { isoFecha: isoFecha, comprobarAdulto: comprobarAdulto, compararIdentidadMrz: compararIdentidadMrz, validarIdentidad: validarIdentidad };
