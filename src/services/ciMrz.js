// ICAO Doc 9303 part 5, standard TD1 (three lines of 30 characters).
// Unknown layouts are routed to review, never silently treated as checked.
function checkDigit(text) {
  return String([...text].reduce((sum, char, i) => {
    const value = char === '<' ? 0 : /\d/.test(char) ? Number(char) : char.charCodeAt(0) - 55;
    return sum + value * [7, 3, 1][i % 3];
  }, 0) % 10);
}

function inspectMrz(text) {
  const lines = String(text || '').toUpperCase().split(/\r?\n/).map(line => line.replace(/\s/g, ''));
  const index = lines.findIndex(line => /^I[<A-Z]BOL/.test(line));
  if (index < 0) return { status: 'unavailable' };
  const [first, second, third] = lines.slice(index, index + 3);
  if (![first, second, third].every(line => /^[A-Z0-9<]{30}$/.test(line || '')) || first[14] === '<') return { status: 'unsupported' };
  const checks = [
    [first.slice(5, 14), first[14]],
    [second.slice(0, 6), second[6]],
    [second.slice(8, 14), second[14]],
    [first.slice(5) + second.slice(0, 7) + second.slice(8, 15) + second.slice(18, 29), second[29]],
  ];
  if (checks.some(([value, digit]) => !/^\d$/.test(digit) || checkDigit(value) !== digit)) return { status: 'invalid' };
  if (!/^\d{6}$/.test(second.slice(0, 6))) return { status: 'invalid' };
  return { status: 'valid', documentNumber: first.slice(5, 14).replace(/<+$/, ''), birth: second.slice(0, 6), expiry: second.slice(8, 14) };
}

module.exports = { checkDigit, inspectMrz };
