const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const { analizarCi: analizarCi, validarCi: validarCi } = require("../servicioOcr");
const { validarIdentidad: validarIdentidad } = require("../identidadValidacion");

// Texto ficticio con la distribución de campos de la CI anterior.
const frontalTexto = [
'ESTADO PLURINACIONAL DE BOLIVIA',
'CEDULA DE IDENTIDAD',
'Serie 44333 Seccion 44242',
'No. 7654321',
'Emitida el 28 de Abril de 2024',
'Expira el 28 de Abril de 2034'].
join('\n');

const reversoTexto = [
'EL SERVICIO GENERAL DE IDENTIFICACION PERSONAL',
'CERTIFICA: Que la firma, fotografia',
'Nº 7654321',
'A: ANA MARIA PEREZ MAMANI',
'Nacida el 26 de Diciembre de 1998',
'EN: LA PAZ - MURILLO',
'Estado Civil: SOLTERA',
'Profesion/Ocupacion: ESTUDIANTE',
'Domicilio: CALLE SUCRE 123',
'DOCUMENTOS REGISTRADOS'].
join('\n');

const analizado = () => ({
  front: { fields: analizarCi(frontalTexto, { documentType: 'ciFront' }), rawText: frontalTexto },
  back: { fields: analizarCi(reversoTexto, { documentType: 'ciBack' }), rawText: reversoTexto }
});

test('the previous CI layout reads written dates and identity on the reverse', () => {
  const { front: frontal, back: reverso } = analizado();
  comprobar.equal(validarCi(frontalTexto, 1, 'ciFront').rejected, false);
  comprobar.equal(validarCi(reversoTexto, 0, 'ciBack').rejected, false);
  comprobar.equal(frontal.fields.format, 'legacy');
  comprobar.equal(reverso.fields.format, 'legacy');
  comprobar.equal(frontal.fields.issueDate, '28/04/2024');
  comprobar.equal(frontal.fields.expiryDate, '28/04/2034');
  comprobar.equal(reverso.fields.firstNames, 'ANA MARIA');
  comprobar.equal(reverso.fields.surnames, 'PEREZ MAMANI');
  comprobar.equal(reverso.fields.birthDate, '26/12/1998');
  comprobar.equal(reverso.fields.birthPlace, 'LA PAZ MURILLO');
  comprobar.equal(reverso.fields.occupation, 'ESTUDIANTE');
  comprobar.equal(reverso.fields.maritalStatus, 'SOLTERA');
  comprobar.equal(reverso.fields.address, 'CALLE SUCRE 123');
  const identidad = validarIdentidad(frontal, reverso, '2026-10-16');
  comprobar.equal(identidad.firstNames, 'ANA MARIA');
  comprobar.equal(identidad.paternalSurname, 'PEREZ');
  comprobar.equal(identidad.maternalSurname, 'MAMANI');
  comprobar.equal(identidad.birthDate, '1998-12-26');
  comprobar.equal(identidad.birthPlace, 'LA PAZ MURILLO');
});

test('old CI keeps the printed A: name order when spatial words are reversed', () => {
  const palabras = palabrasEn([
  [20, 'A: PEREZ MAMANI ANA MARIA'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [100, 'En LA PAZ - MURILLO'],
  [140, 'Estado Civil SOLTERA'],
  [180, 'Profesion/Ocupacion ESTUDIANTE'],
  [220, 'Domicilio CALLE SUCRE 123']]
  );
  const reverso = analizarCi(reversoTexto, { documentType: 'ciBack', format: 'legacy', words: palabras });
  comprobar.equal(reverso.firstNames, 'ANA MARIA');
  comprobar.equal(reverso.surnames, 'PEREZ MAMANI');
});

test('old CI does not save the institutional heading as a domicile', () => {
  const texto = reversoTexto.replace('Domicilio: CALLE SUCRE 123',
  'Domicilio:\nSERVICIO GENERAL DE IDENTIFICACION PERSONAL');
  const reverso = analizarCi(texto, { documentType: 'ciBack', format: 'legacy' });
  comprobar.equal(reverso.address, '');
  comprobar.throws(() => validarIdentidad(analizado().front, { fields: reverso, rawText: texto }, '2026-10-16'),
  /domicilio/);
});

test('previous CI rejects mismatched sides, document numbers and missing fields', () => {
  const { front: frontal, back: reverso } = analizado();
  reverso.fields.ciNumber = '1234567';
  comprobar.throws(() => validarIdentidad(frontal, reverso, '2026-10-16'), { status: 422 });
  reverso.fields.ciNumber = frontal.fields.ciNumber;
  reverso.fields.occupation = '';
  comprobar.throws(() => validarIdentidad(frontal, reverso, '2026-10-16'), { status: 422 });
  reverso.fields.occupation = 'ESTUDIANTE';
  reverso.fields.format = 'current';
  comprobar.throws(() => validarIdentidad(frontal, reverso, '2026-10-16'), { status: 422 });
  reverso.fields.format = 'legacy';
  frontal.fields.expiryDate = '28/04/2023';
  comprobar.throws(() => validarIdentidad(frontal, reverso, '2026-10-16'), { status: 422 });
});

test('the reverse MRZ selects the format even when OCR misses legacy header words', () => {
  const ruidosoReverso = reversoTexto.
  replace('CERTIFICA: Que la firma, fotografia\n', '').
  replace('A: ANA MARIA PEREZ MAMANI\nNacida el', 'A: ANA MARIA PEREZ MAMANI Nacida el');
  const reverso = analizarCi(ruidosoReverso, { documentType: 'ciBack' });
  const frontal = analizarCi(frontalTexto, { documentType: 'ciFront', format: reverso.format });
  comprobar.equal(reverso.format, 'legacy');
  comprobar.equal(frontal.format, 'legacy');
  comprobar.equal(reverso.firstNames, 'ANA MARIA');
  comprobar.equal(reverso.surnames, 'PEREZ MAMANI');
  comprobar.equal(reverso.birthDate, '26/12/1998');
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO');
});

test('the previous CI requires the place after EN and the other reverse fields', () => {
  const { front: frontal, back: reverso } = analizado();
  reverso.fields.birthPlace = '';
  comprobar.throws(() => validarIdentidad(frontal, reverso, '2026-10-16'), /lugar de nacimiento/);
  reverso.fields.birthPlace = 'LA PAZ MURILLO';
  reverso.fields.address = '';
  comprobar.throws(() => validarIdentidad(frontal, reverso, '2026-10-16'), /domicilio/);
});

test('the previous CI reads an isolated EN label below the birth date', () => {
  const texto = reversoTexto.replace('EN: LA PAZ - MURILLO', 'EN\nLA PAZ - MURILLO');
  const reverso = analizarCi(texto, { documentType: 'ciBack' });
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO');
});

test('older-model CI reads an unpadded written birth date for age verification', () => {
  const texto = reversoTexto.replace('Nacida el 26 de Diciembre de 1998', 'Nacida el 5 FEBRERO 2010');
  const reverso = analizarCi(texto, { documentType: 'ciBack', format: 'legacy' });
  comprobar.equal(reverso.birthDate, '05/02/2010');
  const frontal = analizarCi(frontalTexto, { documentType: 'ciFront', format: 'legacy' });
  comprobar.throws(() => validarIdentidad({ fields: frontal }, { fields: reverso }, '2026-10-23'), {
    code: 'UNDERAGE', message: 'No se permite el registro de menores de 18 años.'
  });
});

test('the previous CI reads A and EN when Vision joins or splits their lines', () => {
  const texto = reversoTexto.
  replace('A: ANA MARIA PEREZ MAMANI', 'A:\nANA MARIA PEREZ MAMANI').
  replace('Nacida el 26 de Diciembre de 1998\nEN: LA PAZ - MURILLO',
  'Nacida el 26 de Diciembre de 1998 EN LA PAZ - MURILLO');
  const reverso = analizarCi(texto, { documentType: 'ciBack' });
  comprobar.equal(reverso.firstNames, 'ANA MARIA');
  comprobar.equal(reverso.surnames, 'PEREZ MAMANI');
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO');
});

test('the previous CI reads the name after the certification phrase ending in A:', () => {
  const texto = reversoTexto.replace(
    'A: ANA MARIA PEREZ MAMANI',
    'CERTIFICA QUE LA FIRMA Y FOTOGRAFIA PERTENECEN A:\nANA MARIA PEREZ MAMANI'
  );
  const reverso = analizarCi(texto, { documentType: 'ciBack' });
  comprobar.equal(reverso.firstNames, 'ANA MARIA');
  comprobar.equal(reverso.surnames, 'PEREZ MAMANI');
});

test('the previous CI joins a name split into two OCR lines after A:', () => {
  const texto = reversoTexto.replace(
    'A: ANA MARIA PEREZ MAMANI',
    'PERTENECEN A:\nANA MARIA\nPEREZ MAMANI'
  );
  const reverso = analizarCi(texto, { documentType: 'ciBack' });
  comprobar.equal(reverso.firstNames, 'ANA MARIA');
  comprobar.equal(reverso.surnames, 'PEREZ MAMANI');
});

test('the previous CI prefers a complete raw name over a truncated spatial name', () => {
  const palabras = palabrasEn([
  [20, 'A: ANA MARIA PEREZ'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [100, 'EN: LA PAZ - MURILLO'],
  [140, 'Estado Civil SOLTERA'],
  [180, 'Profesion/Ocupacion ESTUDIANTE'],
  [220, 'Domicilio CALLE SUCRE 123']]
  );
  const reverso = analizarCi(reversoTexto, { documentType: 'ciBack', format: 'legacy', words: palabras });
  comprobar.equal(reverso.firstNames, 'ANA MARIA');
  comprobar.equal(reverso.surnames, 'PEREZ MAMANI');
});

test('old CI rejects a watermark fragment in place of the maternal surname', () => {
  const brutoTexto = reversoTexto.replace('A: ANA MARIA PEREZ MAMANI',
  'AURINACIONAL DE BOLIVIA ANA MARIA PEREZ MAMANI');
  const palabras = palabrasEn([
  [20, 'A: ANA MARIA PEREZ ALDEBOLA'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [100, 'EN: LA PAZ - MURILLO'],
  [140, 'Estado Civil SOLTERA']]
  );
  const reverso = analizarCi(brutoTexto, { documentType: 'ciBack', format: 'legacy', words: palabras });
  comprobar.equal(reverso.firstNames, 'ANA MARIA');
  comprobar.equal(reverso.paternalSurname, 'PEREZ');
  comprobar.equal(reverso.maternalSurname, 'MAMANI');

  const brutoConStrayFragment = reversoTexto.replace('A: ANA MARIA PEREZ MAMANI',
  'A: ANA MARIA PEREZ MAMANI\nALDEBOLA');
  comprobar.equal(analizarCi(brutoConStrayFragment, {
    documentType: 'ciBack', format: 'legacy'
  }).maternalSurname, 'MAMANI');
});

test('the previous CI joins a surname on the next OCR line before splitting names', () => {
  const texto = reversoTexto.replace('A: ANA MARIA PEREZ MAMANI',
  'A: ANA MARIA PEREZ\nMAMANI');
  const reverso = analizarCi(texto, { documentType: 'ciBack', format: 'legacy' });
  comprobar.equal(reverso.firstNames, 'ANA MARIA');
  comprobar.equal(reverso.surnames, 'PEREZ MAMANI');
});

test('the previous CI does not infer a place when EN is missing', () => {
  const texto = reversoTexto.replace('EN: LA PAZ - MURILLO\n', '');
  const reverso = analizarCi(texto, { documentType: 'ciBack' });
  comprobar.equal(reverso.birthPlace, '');
});

test('old CI recovers a unique birthplace line when OCR omits En amid watermark', () => {
  const texto = [
  'AURINACIONAL DE BOLIVIA ANA MARIA PEREZ MAMANI',
  'ALDUBOLIVIAESTADOPLURINACIONAL',
  'ADOPLURINACIONALDEBOLIVIAESTADOPLURINACION',
  'ALDEBOLIVIAESTADOPLURINACIONALDEBOLIVIAES',
  'SIONAL EBOLA',
  'Nacida el 26 de Diciembre de 1998',
  'EBOLIVIAESTADOPLURINACIONALDEBOLIV',
  'LA PAZ - MURILLO - EL ALTO ESTADOPLURINACIONALDED',
  'Estado Civil SOLTERA',
  'Profesion/Ocupacion ESTUDIANTE',
  'Domicilio CALLE SUCRE 123'].
  join('\n');
  const palabras = palabrasEn([
  [20, 'A: ANA MARIA PEREZ'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [140, 'Estado Civil SOLTERA']]
  );
  const reverso = analizarCi(texto, { documentType: 'ciBack', format: 'legacy', words: palabras });
  comprobar.equal(reverso.firstNames, 'ANA MARIA');
  comprobar.equal(reverso.surnames, 'PEREZ MAMANI');
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO EL ALTO');
});

test('old CI does not guess birthplace from two unlabeled geographic lines', () => {
  const texto = reversoTexto.replace('EN: LA PAZ - MURILLO',
  'LA PAZ - MURILLO - EL ALTO\nSANTA CRUZ - ANDRES IBAÑEZ - SANTA CRUZ');
  comprobar.equal(analizarCi(texto, { documentType: 'ciBack', format: 'legacy' }).birthPlace, '');
});

test('legacy front recovers two complete dates when Vision misses their labels', () => {
  const ruidosoFrontal = frontalTexto.
  replace('Emitida el 28 de Abril de 2024', 'Emtda\nel 28 de\nAbril del 2024').
  replace('Expira el 28 de Abril de 2034', 'Expra\nel 28 de\nAbril de 2034');
  const parsed = analizarCi(ruidosoFrontal, { documentType: 'ciFront', format: 'legacy' });
  comprobar.equal(parsed.issueDate, '28/04/2024');
  comprobar.equal(parsed.expiryDate, '28/04/2034');
});

test('legacy front does not assign dates when three dates are present', () => {
  const ambiguous = frontalTexto.
  replace('Emitida el', 'Emtda').
  replace('Expira el', 'Expra') + '\nOtro dato 28 de Abril de 2028';
  const parsed = analizarCi(ambiguous, { documentType: 'ciFront', format: 'legacy' });
  comprobar.equal(parsed.issueDate, '');
  comprobar.equal(parsed.expiryDate, '');
});

test('legacy front recovers a unique eight-digit CI when OCR omits No.', () => {
  const texto = frontalTexto.
  replace('No. 7654321', 'Serie impresa 2367094\n13277399');
  const frontal = analizarCi(texto, { documentType: 'ciFront', format: 'legacy' });
  comprobar.equal(frontal.ciNumber, '13277399');
});

test('legacy front reads No. even when watermark letters join the CI digits', () => {
  const texto = frontalTexto.replace('No. 7654321', 'No. 87654321ACION');
  for (const opciones of [
  { documentType: 'ciFront', format: 'legacy' },
  { documentType: 'ciFront', format: 'legacy', words: palabrasEn([
    [20, 'CEDULA DE IDENTIDAD'],
    [60, 'Serie 44333 Seccion 44242'],
    [100, 'No. 87654321ACION'],
    [140, 'Emitida el 28 de Abril de 2024'],
    [180, 'Expira el 28 de Abril de 2034']]
    ) }])
  {
    comprobar.equal(analizarCi(texto, opciones).ciNumber, '87654321');
  }
});

test('legacy front does not truncate a ten-digit OCR run after No.', () => {
  const texto = frontalTexto.replace('No. 7654321', 'No. 8765432101ACION');
  comprobar.equal(analizarCi(texto, { documentType: 'ciFront', format: 'legacy' }).ciNumber, '');
});

function palabrasEn(lineas) {
  return lineas.flatMap(([y, linea]) => {
    let x = 30;
    return linea.split(' ').map((token) => {
      const palabra = { text: token, x, y, w: Math.max(10, token.length * 9), h: 18 };
      x += palabra.w + 7;
      return palabra;
    });
  });
}

test('old CI removes only leading BOLC watermark from a street address', () => {
  const lineas = [
  [20, 'A: ANA MARIA PEREZ MAMANI'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [100, 'En LA PAZ MURILLO'],
  [140, 'Estado Civil SOLTERA'],
  [180, 'Profesion Ocupacion ESTUDIANTE'],
  [220, 'Domicilio BOLC C LOS PINOS N 1085 Z CENTRAL - EL ALTO']];

  const texto = lineas.map(([, linea]) => linea).join('\n');
  const reverso = analizarCi(texto, {
    documentType: 'ciBack', format: 'legacy', words: palabrasEn(lineas)
  });
  comprobar.equal(reverso.address, 'C LOS PINOS N 1085 Z CENTRAL - EL ALTO');

  const legitimate = analizarCi(texto.replace('BOLC C LOS PINOS N 1085 Z CENTRAL - EL ALTO',
  'CALLE BOLC 25'), { documentType: 'ciBack', format: 'legacy' });
  comprobar.equal(legitimate.address, 'CALLE BOLC 25');
});

test('old CI removes trailing BA watermark only after EL ALTO', () => {
  const lineas = [
  [20, 'A: ANA MARIA PEREZ MAMANI'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [100, 'En LA PAZ MURILLO'],
  [140, 'Estado Civil SOLTERA'],
  [180, 'Profesion Ocupacion ESTUDIANTE'],
  [220, 'Domicilio C LOS PINOS N 1085 Z CENTRAL- EL ALTO BA']];

  const analizar = (origen) => analizarCi(origen.map(([, linea]) => linea).join('\n'), {
    documentType: 'ciBack', format: 'legacy', words: palabrasEn(origen)
  });
  comprobar.equal(analizar(lineas).address, 'C LOS PINOS N 1085 Z CENTRAL- EL ALTO');

  const legitimate = lineas.map(([y, linea]) => [y, linea.replace('EL ALTO BA', 'EL ALTO BAJO')]);
  comprobar.equal(analizar(legitimate).address, 'C LOS PINOS N 1085 Z CENTRAL- EL ALTO BAJO');
});

test('old CI prefers a complete raw address when it extends the spatial prefix', () => {
  const palabras = palabrasEn([
  [20, 'A: ANA MARIA PEREZ MAMANI'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [100, 'En LA PAZ MURILLO'],
  [140, 'Estado Civil SOLTERA'],
  [180, 'Profesion Ocupacion ESTUDIANTE'],
  [220, 'Domicilio C.3 AV LOS PINOS'],
  [260, 'DOCUMENTOS REGISTRADOS']]
  );
  const brutoTexto = reversoTexto.replace('Domicilio: CALLE SUCRE 123',
  'Domicilio C. 3 AV. LOS PINOS # 60 Z. CENTRAL 3RA SECCION');
  const opciones = { documentType: 'ciBack', format: 'legacy', words: palabras };
  comprobar.equal(analizarCi(brutoTexto, opciones).address,
  'C. 3 AV. LOS PINOS # 60 Z. CENTRAL 3RA SECCION');

  const conflicting = brutoTexto.replace('Domicilio C. 3 AV. LOS PINOS # 60 Z. CENTRAL 3RA SECCION',
  'Domicilio AV. OTRA 99');
  comprobar.equal(analizarCi(conflicting, opciones).address, 'C.3 AV LOS PINOS');
});

test('old CI does not append an isolated registry number to a complete address', () => {
  const direccionLinea = 'Domicilio C/LOS PINOS N° 1085 Z/ CENTRAL - EL ALTO';
  const brutoTexto = [
  'A: ANA MARIA PEREZ MAMANI',
  'Nacida el 19 de Abril de 2001',
  'En LA PAZ - MURILLO - EL ALTO',
  'Estado Civil SOLTERA',
  'Profesion/Ocupacion ESTUDIANTE',
  direccionLinea,
  '2 574 317 08-L3',
  '11',
  'DOCUMENTOS REGISTRADOS'].
  join('\n');
  const palabras = palabrasEn([
  [20, 'A: ANA MARIA PEREZ MAMANI'],
  [60, 'Nacida el 19 de Abril de 2001'],
  [100, 'En LA PAZ - MURILLO - EL ALTO'],
  [140, 'Estado Civil SOLTERA'],
  [180, 'Profesion Ocupacion ESTUDIANTE'],
  [220, 'Domicilio C LOS PINOS N 1085 Z CENTRAL - EL ALTO 11']]
  );
  const opciones = { documentType: 'ciBack', format: 'legacy', words: palabras };
  comprobar.equal(analizarCi(brutoTexto, opciones).address, 'C LOS PINOS N 1085 Z CENTRAL - EL ALTO');
  comprobar.equal(analizarCi(brutoTexto.replace(direccionLinea, `${direccionLinea} 11`), opciones).address,
  'C LOS PINOS N 1085 Z CENTRAL - EL ALTO 11');
});

test('old CI ignores spatial values taken from adjacent fields and the official signature', () => {
  const brutoTexto = [
  'EL SERVICIO GENERAL DE IDENTIFICACION PERSONAL',
  'CERTIFICA: Que la firma, fotografia',
  'A:',
  'e impresion pertenece',
  'ANA MARIA PEREZ MAMANI',
  'Nacida el 26 de Diciembre de 1998',
  'En',
  'LA PAZ - MURILLO - EL ALTO',
  'Estado Civil SOLTERA',
  'Profesion/Ocupacion ESTUDIANTE',
  'Domicilio C.3 AV. LOS PINOS # 60 Z. CENTRAL 3RA SECCION',
  'DIRECTORA GENERAL EJECUTIVA A2.',
  'DOCUMENTOS REGISTRADOS'].
  join('\n');
  const palabras = palabrasEn([
  [20, 'A: ANA MARIA PEREZ MAMANI'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [100, 'En LA PAZ - MURILLO - EL ALTO'],
  [140, 'Estado Civil SOLTERA ESTUDIANTE'],
  [180, 'Profesion Ocupacion ALTO LIMA RA SECCION'],
  [220, 'Domicilio DIRECTORA GENERAL EJECUTIVA A2']]
  );
  const reverso = analizarCi(brutoTexto, { documentType: 'ciBack', format: 'legacy', words: palabras });
  comprobar.equal(reverso.maritalStatus, 'SOLTERA');
  comprobar.equal(reverso.occupation, 'ESTUDIANTE');
  comprobar.equal(reverso.address, 'C.3 AV. LOS PINOS # 60 Z. CENTRAL 3RA SECCION');
});

test('old CI ignores a stray letter after the marital status', () => {
  const lineas = [
  [20, 'A: ANA MARIA PEREZ MAMANI'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [100, 'En LA PAZ MURILLO'],
  [140, 'Estado Civil SOLTERA S'],
  [180, 'Profesion Ocupacion ESTUDIANTE'],
  [220, 'Domicilio CALLE SUCRE 123']];

  const texto = lineas.map(([, linea]) => linea).join('\n');
  for (const opciones of [
  { documentType: 'ciBack', format: 'legacy' },
  { documentType: 'ciBack', format: 'legacy', words: palabrasEn(lineas) }])
  {
    comprobar.equal(analizarCi(texto, opciones).maritalStatus, 'SOLTERA');
  }
});

function rotatedClockwise(palabras) {
  return palabras.map((palabra) => {
    const upright = [
    { x: palabra.x, y: palabra.y },
    { x: palabra.x + palabra.w, y: palabra.y },
    { x: palabra.x + palabra.w, y: palabra.y + palabra.h },
    { x: palabra.x, y: palabra.y + palabra.h }];

    const vertices = upright.map((punto) => ({ x: 900 - punto.y, y: punto.x }));
    const xs = vertices.map((punto) => punto.x);
    const ys = vertices.map((punto) => punto.y);
    return {
      text: palabra.text, vertices,
      x: Math.min(...xs), y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys)
    };
  });
}

function uprightBordePalabras(linea) {
  return palabrasEn([[120, linea]]).map((palabra) => ({
    ...palabra,
    vertices: [
    { x: palabra.x, y: palabra.y },
    { x: palabra.x + palabra.w, y: palabra.y },
    { x: palabra.x + palabra.w, y: palabra.y + palabra.h },
    { x: palabra.x, y: palabra.y + palabra.h }]

  }));
}

test('old CI uses rotated word coordinates for number and written dates', () => {
  const palabras = palabrasEn([
  [20, 'CEDULA DE IDENTIDAD'],
  [60, 'Serie 44333 Seccion 44242'],
  [100, 'No. 13277399'],
  [140, 'Emitida el 28 de Abril de 2022'],
  [180, 'Expira el 28 de Abril de 2032']]
  );
  const brutoTexto = 'CEDULA DE IDENTIDAD\nSerie 44333 Seccion 44242\n2367094\nNo. 13277399\nExpira el 28 de Abril de 2032\nEmitida el 28 de Abril de 2022';
  const frontal = analizarCi(brutoTexto, { documentType: 'ciFront', words: rotatedClockwise(palabras) });
  comprobar.equal(frontal.ciNumber, '13277399');
  comprobar.equal(frontal.issueDate, '28/04/2022');
  comprobar.equal(frontal.expiryDate, '28/04/2032');
});

test('old CI reverse reads identity fields from physical rows', () => {
  const palabras = palabrasEn([
  [20, 'EL SERVICIO GENERAL DE IDENTIFICACION PERSONAL'],
  [60, 'A: JOSE DANIEL CONDORI CHOQUE'],
  [100, 'Nacido el 26 de Diciembre de 1998'],
  [140, 'En LA PAZ - MURILLO - EL ALTO'],
  [180, 'Estado Civil SOLTERO'],
  [220, 'Profesion Ocupacion ESTUDIANTE'],
  [260, 'Domicilio C. 3 AV. PUCARANI # 60 Z. ALTO LIMA 3RA SECCION'],
  [300, 'DOCUMENTOS REGISTRADOS']]
  );
  const brutoTexto = 'DOMICILIO\nDOCUMENTOS REGISTRADOS\nEL SERVICIO GENERAL DE IDENTIFICACION PERSONAL\nA: JOSE DANIEL CONDORI CHOQUE\nNacido el 26 de Diciembre de 1998\nEn LA PAZ - MURILLO - EL ALTO\nEstado Civil SOLTERO\nProfesion Ocupacion ESTUDIANTE';
  const reverso = analizarCi(brutoTexto, { documentType: 'ciBack', words: rotatedClockwise(palabras) });
  comprobar.equal(reverso.fullName, 'JOSE DANIEL CONDORI CHOQUE');
  comprobar.equal(reverso.birthDate, '26/12/1998');
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO EL ALTO');
  comprobar.equal(reverso.maritalStatus, 'SOLTERO');
  comprobar.equal(reverso.occupation, 'ESTUDIANTE');
  comprobar.equal(reverso.address, 'C. 3 AV. PUCARANI # 60 Z. ALTO LIMA 3RA SECCION');
});

test('old CI reverse rejects PERSONAL as an address and keeps the textual address', () => {
  const palabras = palabrasEn([[20, 'Domicilio PERSONAL']]);
  const texto = 'Domicilio C. 3 AV. PUCARANI # 60 Z. ALTO LIMA 3RA SECCION';
  const reverso = analizarCi(texto, { documentType: 'ciBack', format: 'legacy', words: palabras });
  comprobar.equal(reverso.address, 'C. 3 AV. PUCARANI # 60 Z. ALTO LIMA 3RA SECCION');

  const sinDireccion = analizarCi('Domicilio\nPERSONAL', { documentType: 'ciBack', format: 'legacy', words: palabras });
  comprobar.equal(sinDireccion.address, '');
});

test('old CI reverse ignores dense horizontal microprint over birth fields', () => {
  const principal = palabrasEn([
  [20, 'A: JOSE DANIEL CONDORI CHOQUE'],
  [60, 'Nacido el 26 de Diciembre de 1998'],
  [100, 'En LA PAZ - MURILLO - EL ALTO'],
  [140, 'Estado Civil SOLTERO'],
  [180, 'Profesion Ocupacion ESTUDIANTE'],
  [220, 'Domicilio C. 3 AV. PUCARANI']]
  );
  const microprint = palabrasEn(Array.from({ length: 15 }, (_, indice) => [
  24 + indice * 14,
  'ESTADO PLURINACIONAL DE BOLIVIA ESTADO PLURINACIONAL DE BOLIVIA']
  )).map((palabra) => ({ ...palabra, h: 6, w: Math.max(4, palabra.text.length * 4) }));
  const reverso = analizarCi('ESTADO PLURINACIONAL DE BOLIVIA', {
    documentType: 'ciBack', words: [...microprint, ...principal]
  });
  comprobar.equal(reverso.fullName, 'JOSE DANIEL CONDORI CHOQUE');
  comprobar.equal(reverso.birthDate, '26/12/1998');
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO EL ALTO');
});

test('old CI reverse recovers values when Vision fuses microprint with name and place', () => {
  const ruidosoLineas = [
  'EL SERVICIO GENERAL DE IDENTIFICACION PERSONAL',
  'CERTIFICA QUE LA FIRMA FOTOGRAFIA',
  'AURINACIONAL DE BOLIVIAE ANA MARIA PEREZ MAMANI EBOLIVIAESTADOPL',
  'ADOPLURINACIONALDEBOLIVIAESTADOPLURINACION',
  'BOLIVIAESTADOPLURINACIONALDEBOL',
  'Nacida el 26 de Diciembre de 1998',
  'ALDEBOLIVIAESTADOPLURINACIO',
  'En RINACIONALDEBOLIVIAESTADOPLULA PAZ - MURILLO - EL ALTO',
  'Estado Civil SOLTERA',
  'Profesion/Ocupacion ESTUDIANTE',
  'Domicilio CALLE SUCRE 123'];

  for (const opciones of [
  { documentType: 'ciBack', format: 'legacy' },
  { documentType: 'ciBack', format: 'legacy',
    words: palabrasEn(ruidosoLineas.map((linea, indice) => [20 + indice * 40, linea])) }])
  {
    const reverso = analizarCi(ruidosoLineas.join('\n'), opciones);
    comprobar.equal(reverso.firstNames, 'ANA MARIA');
    comprobar.equal(reverso.surnames, 'PEREZ MAMANI');
    comprobar.equal(reverso.birthDate, '26/12/1998');
    comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO EL ALTO');
  }
});

test('old CI uses the En line from raw OCR when word geometry omits it', () => {
  const brutoTexto = [
  'A: ANA MARIA PEREZ MAMANI',
  'Nacida el 26 de Diciembre de 1998',
  'En RINACIONALDEBOLIVIAESTADOPLULA PAZ - MURILLO - EL ALTO',
  'Estado Civil SOLTERA',
  'Profesion / Ocupacion ESTUDIANTE',
  'Domicilio CALLE SUCRE 123'].
  join('\n');
  const palabras = palabrasEn([
  [20, 'A: ANA MARIA PEREZ MAMANI'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [140, 'Estado Civil SOLTERA'],
  [180, 'Profesion / Ocupacion ESTUDIANTE'],
  [220, 'Domicilio CALLE SUCRE 123']]
  );
  const reverso = analizarCi(brutoTexto, { documentType: 'ciBack', format: 'legacy', words: palabras });
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO EL ALTO');
  comprobar.equal(reverso.occupation, 'ESTUDIANTE');
});

test('old CI keeps a small En label but excludes smaller background lettering', () => {
  const principal = palabrasEn([
  [20, 'A: ANA MARIA PEREZ MAMANI'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [100, 'En LA PAZ MURILLO'],
  [140, 'Estado Civil SOLTERA'],
  [180, 'Profesion Ocupacion ESTUDIANTE']]
  );
  const en = principal.find((palabra) => palabra.text === 'En');
  en.h = 7;
  const microprint = palabrasEn([[104, 'URINA']]).
  map((palabra) => ({ ...palabra, x: 70, h: 10 }));
  const reverso = analizarCi('', {
    documentType: 'ciBack', format: 'legacy', words: [...microprint, ...principal]
  });
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO');
});

test('old CI reads birthplace far to the right of En despite fused background', () => {
  const principal = palabrasEn([
  [20, 'A: ANA MARIA PEREZ MAMANI'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [100, 'En'],
  [92, 'LA PAZ - MURILLO - EL ALTO'],
  [140, 'Estado Civil SOLTERA']]
  );
  for (const palabra of principal.filter((word) => word.y === 92)) palabra.x += 480;
  const watermark = { text: 'RINACIONALDEBOLIVIAESTADOPLU', x: 170, y: 96, w: 275, h: 18 };
  const reverso = analizarCi('', {
    documentType: 'ciBack', format: 'legacy', words: [...principal, watermark]
  });
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO EL ALTO');
});

test('old CI skips background lines between En and distant birthplace in raw OCR', () => {
  const brutoTexto = [
  'A: ANA MARIA PEREZ MAMANI',
  'Nacida el 26 de Diciembre de 1998',
  'En',
  'ESTADOPLURINACIONALDEBOLIVIAESTADO',
  'DOPLURINACIONALDEBOLIVIA',
  'LA PAZ - MURILLO - EL ALTO',
  'Estado Civil SOLTERA'].
  join('\n');
  const palabras = palabrasEn([
  [20, 'A: ANA MARIA PEREZ MAMANI'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [100, 'En'],
  [140, 'Estado Civil SOLTERA']]
  );
  const reverso = analizarCi(brutoTexto, { documentType: 'ciBack', format: 'legacy', words: palabras });
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO EL ALTO');
});

test('old CI removes watermark words before locating spatial labels', () => {
  const palabras = palabrasEn([
  [20, 'A: ANA MARIA PEREZ MAMANI'],
  [60, 'Nacida el 26 de Diciembre de 1998'],
  [100, 'En LA PAZ MURILLO'],
  [140, 'Estado Civil SOLTERA'],
  [180, 'Profesion RINACIONALDEBOLIVIAESTADOPLU Ocupacion ESTUDIANTE']]
  );
  const reverso = analizarCi('', { documentType: 'ciBack', format: 'legacy', words: palabras });
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO');
  comprobar.equal(reverso.maritalStatus, 'SOLTERA');
  comprobar.equal(reverso.occupation, 'ESTUDIANTE');
});

test('old CI keeps Estado Civil when watermark is adjacent in OCR word order', () => {
  const brutoTexto = [
  'A: ANA MARIA PEREZ MAMANI',
  'Nacida el 26 de Diciembre de 1998',
  'En LA PAZ MURILLO',
  'ESTADOPLURINACIONALDEBOLIVIA Estado Civil SOLTERA',
  'Profesion Ocupacion ESTUDIANTE'].
  join('\n');
  const palabras = palabrasEn(brutoTexto.split('\n').map((linea, indice) => [20 + indice * 40, linea]));
  const reverso = analizarCi(brutoTexto, { documentType: 'ciBack', format: 'legacy', words: palabras });
  comprobar.equal(reverso.maritalStatus, 'SOLTERA');
});

test('old CI discards short watermark fragments before name and birthplace', () => {
  const lineas = [
  'ESTADOP ANA MARIA PEREZ MAMANI',
  'Nacida el 26 de Diciembre de 1998',
  'En ERINACIONAL DE LA PAZ - MURILLO - EL ALTO',
  'Estado Civil SOLTERA',
  'Profesion Ocupacion ESTUDIANTE',
  'Domicilio CALLE SUCRE 123'];

  for (const opciones of [
  { documentType: 'ciBack', format: 'legacy' },
  { documentType: 'ciBack', format: 'legacy',
    words: palabrasEn(lineas.map((linea, indice) => [20 + indice * 40, linea])) }])
  {
    const reverso = analizarCi(lineas.join('\n'), opciones);
    comprobar.equal(reverso.fullName, 'ANA MARIA PEREZ MAMANI');
    comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO EL ALTO');
  }
});

test('old CI reverse reads A: and En when Vision separates labels and values', () => {
  const palabras = palabrasEn([
  [20, 'EL SERVICIO GENERAL DE IDENTIFICACION PERSONAL'],
  [60, 'A:'],
  [82, 'JOSE DANIEL'],
  [104, 'CONDORI CHOQUE'],
  [145, 'Nacido'],
  [167, 'el 26 de Diciembre de 1998'],
  [210, 'En:'],
  [232, 'LA PAZ - MURILLO'],
  [254, 'EL ALTO'],
  [295, 'Estado Civil SOLTERO'],
  [335, 'Profesion/Ocupacion ESTUDIANTE'],
  [375, 'Domicilio C. 3 AV. PUCARANI # 60']]
  );
  const brutoTexto = 'EL SERVICIO GENERAL DE IDENTIFICACION PERSONAL\nA:\nJOSE DANIEL\nCONDORI CHOQUE\nNacido\nel 26 de Diciembre de 1998\nEn:\nLA PAZ - MURILLO\nEL ALTO\nEstado Civil SOLTERO\nProfesion/Ocupacion ESTUDIANTE\nDomicilio C. 3 AV. PUCARANI # 60';
  const reverso = analizarCi(brutoTexto, { documentType: 'ciBack', words: rotatedClockwise(palabras) });
  comprobar.equal(reverso.firstNames, 'JOSE DANIEL');
  comprobar.equal(reverso.surnames, 'CONDORI CHOQUE');
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO EL ALTO');
  comprobar.equal(reverso.occupation, 'ESTUDIANTE');
});

test('old CI reads En by position even when OCR inserts many rows after birth', () => {
  const palabras = palabrasEn([
  [20, 'A: JOSE DANIEL CONDORI CHOQUE'],
  [60, 'Nacido el 26 de Diciembre de 1998'],
  [90, 'texto decorativo'],
  [112, 'texto decorativo'],
  [134, 'texto decorativo'],
  [156, 'texto decorativo'],
  [180, 'En: LA PAZ - MURILLO - EL ALTO'],
  [220, 'Estado Civil SOLTERO']]
  );
  const brutoTexto = 'A: JOSE DANIEL CONDORI CHOQUE\nNacido el 26 de Diciembre de 1998\nEstado Civil SOLTERO\nEn: LA PAZ - MURILLO - EL ALTO';
  const reverso = analizarCi(brutoTexto, { documentType: 'ciBack', words: rotatedClockwise(palabras) });
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO EL ALTO');
});

test('old CI finds a place on the same physical band when its baseline differs from En', () => {
  const palabras = palabrasEn([
  [20, 'A: JOSE DANIEL CONDORI CHOQUE'],
  [60, 'Nacido el 26 de Diciembre de 1998'],
  [100, 'En:'],
  [88, 'LA PAZ MURILLO EL ALTO'],
  [145, 'Estado Civil SOLTERO']]
  );
  for (const palabra of palabras.filter((word) => word.y === 88)) palabra.x += 110;
  const brutoTexto = 'A: JOSE DANIEL CONDORI CHOQUE\nNacido el 26 de Diciembre de 1998\nEstado Civil SOLTERO\nEn:\nLA PAZ MURILLO EL ALTO';
  const reverso = analizarCi(brutoTexto, { documentType: 'ciBack', words: rotatedClockwise(palabras) });
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO EL ALTO');
});

test('old CI recovers the unique birthplace band if OCR misses the small En label', () => {
  const palabras = palabrasEn([
  [20, 'A: JOSE DANIEL CONDORI CHOQUE'],
  [60, 'Nacido el 26 de Diciembre de 1998'],
  [100, 'LA PAZ - MURILLO - EL ALTO'],
  [140, 'Estado Civil SOLTERO'],
  [180, 'Profesion Ocupacion ESTUDIANTE']]
  );
  const brutoTexto = 'A: JOSE DANIEL CONDORI CHOQUE\nNacido el 26 de Diciembre de 1998\nEstado Civil SOLTERO\nLA PAZ - MURILLO - EL ALTO';
  const reverso = analizarCi(brutoTexto, { documentType: 'ciBack', words: rotatedClockwise(palabras) });
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO EL ALTO');
});

test('old CI ignores vertical border text when reading name and birthplace', () => {
  const principal = palabrasEn([
  [20, 'A: JOSE DANIEL CONDORI CHOQUE'],
  [60, 'Nacido el 26 de Diciembre de 1998'],
  [100, 'En LA PAZ MURILLO EL ALTO'],
  [140, 'Estado Civil SOLTERO'],
  [180, 'Profesion Ocupacion ESTUDIANTE'],
  [220, 'Domicilio CALLE SUCRE 123']]
  );
  const vertical = uprightBordePalabras('ESTADO PLURINACIONAL DE BOLIVIA');
  const brutoTexto = 'En Estado Plurinacional de Bolivia\nA: JOSE DANIEL CONDORI CHOQUE\nNacido el 26 de Diciembre de 1998\nEstado Civil SOLTERO';
  const reverso = analizarCi(brutoTexto, {
    documentType: 'ciBack', words: [...vertical, ...rotatedClockwise(principal)]
  });
  comprobar.equal(reverso.fullName, 'JOSE DANIEL CONDORI CHOQUE');
  comprobar.equal(reverso.birthPlace, 'LA PAZ MURILLO EL ALTO');
});

test('old CI never accepts vertical boilerplate as birthplace', () => {
  const principal = palabrasEn([
  [20, 'A: JOSE DANIEL CONDORI CHOQUE'],
  [60, 'Nacido el 26 de Diciembre de 1998'],
  [100, 'En:'],
  [140, 'Estado Civil SOLTERO']]
  );
  const reverso = analizarCi('En Estado Plurinacional de Bolivia', {
    documentType: 'ciBack', words: [
    ...uprightBordePalabras('ESTADO PLURINACIONAL DE BOLIVIA'),
    ...rotatedClockwise(principal)]

  });
  comprobar.equal(reverso.birthPlace, '');
});
