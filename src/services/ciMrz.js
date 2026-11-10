// ICAO Doc 9303 part 5, standard TD1 (three lines of 30 characters).
// Unknown layouts are routed to review, never silently treated as checked.
function comprobarDigito(texto) {
  return String([...texto].reduce((suma, caracter, indice) => {
    const valor = caracter === '<' ? 0 : /\d/.test(caracter) ? Number(caracter) : caracter.charCodeAt(0) - 55;
    return suma + valor * [7, 3, 1][indice % 3];
  }, 0) % 10);
}

function normalizarMrzLineas(texto) {
  const brutoLineas = String(texto || '').toUpperCase().split(/\r?\n/);
  const lineas = brutoLineas.map((linea) => linea.replace(/\s/g, ''));
  const indice = lineas.findIndex((linea) => /^I[<A-Z]B[0O]L/.test(linea) ||
  linea.includes('IDBOL') || linea.includes('I<BOL'));
  if (indice < 0) return { lines: lineas, index: indice };
  // Correcciones limitadas a posiciones alfabéticas fijas. Nunca se alteran
  // número de CI, fechas ni dígitos de control para hacer pasar una MRZ inválida.
  lineas[indice] = lineas[indice].replace(/^I([<A-Z])B0L/, 'I$1BOL');
  const segundo = lineas[indice + 1] || '';
  if (segundo.length === 30 && segundo.slice(15, 18) === 'B0L') {
    lineas[indice + 1] = segundo.slice(0, 15) + 'BOL' + segundo.slice(18);
  }
  const nombreLinea = (brutoLineas[indice + 2] || '').trim().replace(/^-\s*/, '');
  let tercero = nombreLinea.replace(/\s/g, '');
  // Vision puede leer el separador < entre dos apellidos como un espacio.
  // Reparar solo esa forma exacta y solo si recupera los 30 caracteres TD1.
  if (tercero.length === 29 && /^[A-Z]+\s+[A-Z]+<<[A-Z<]+$/.test(nombreLinea)) {
    tercero = nombreLinea.replace(/^([A-Z]+)\s+([A-Z]+<<)/, '$1<$2').replace(/\s/g, '');
  }
  if (/^[A-Z0-9<]{30}$/.test(tercero)) lineas[indice + 2] = tercero;
  return { lines: lineas, index: indice };
}

function inspectMrz(texto) {
  const { lines: lineas, index: indice } = normalizarMrzLineas(texto);
  if (indice < 0) return { status: 'unavailable' };
  const [primero, segundo, tercero] = lineas.slice(indice, indice + 3);
  if (![primero, segundo, tercero].every((linea) => /^[A-Z0-9<]{30}$/.test(linea || '')) ||
  primero[14] === '<' || !/^[A-Z]{3}$/.test(segundo.slice(15, 18))) return { status: 'unsupported' };
  const checks = [
  [primero.slice(5, 14), primero[14]],
  [segundo.slice(0, 6), segundo[6]],
  [segundo.slice(8, 14), segundo[14]],
  [primero.slice(5) + segundo.slice(0, 7) + segundo.slice(8, 15) + segundo.slice(18, 29), segundo[29]]];

  if (checks.some(([valor, digito]) => !/^\d$/.test(digito) || comprobarDigito(valor) !== digito)) return { status: 'invalid' };
  if (!/^\d{6}$/.test(segundo.slice(0, 6))) return { status: 'invalid' };
  return { status: 'valid', documentNumber: primero.slice(5, 14).replace(/<+$/, ''), birth: segundo.slice(0, 6), expiry: segundo.slice(8, 14) };
}

module.exports = { comprobarDigito: comprobarDigito, inspectMrz, normalizarMrzLineas: normalizarMrzLineas };
