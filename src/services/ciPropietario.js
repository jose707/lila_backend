const TIPOS_CI_PROPIETARIO = ['ownerCiFront', 'ownerCiBack'];
const numeroCi = valor => String(valor || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const requiereCiPropietario = (ruat, identidad) => {
  const propietario = numeroCi(ruat?.vehicleOwnerCi);
  return Boolean(propietario && propietario !== numeroCi(identidad?.ciNumber));
};

function leerCiPropietario(texto, tipo) {
  const ocr = require('./servicioOcr');
  return ocr.analizarCi(texto, {
    documentType: tipo === 'ownerCiFront' ? 'ciFront' : 'ciBack',
    format: ocr.clasificarCI(texto, 0).hasMRZ ? 'current' : undefined
  });
}

function validarCiPropietario(metadata, identidad) {
  const ocr = metadata.ocr || {};
  if (!requiereCiPropietario(ocr.ruatPhoto?.fields, identidad)) return [];
  const propietario = numeroCi(ocr.ruatPhoto.fields.vehicleOwnerCi);
  const errores = [];
  const agregar = mensaje => TIPOS_CI_PROPIETARIO.forEach(documento => errores.push({ documento, mensaje }));
  const frontal = ocr.ownerCiFront;
  const reverso = ocr.ownerCiBack;
  if (!frontal?.text || !reverso?.text) {
    agregar('El vehículo está a nombre de otra persona. Se requieren ambas caras del CI del propietario.');
    return errores;
  }
  const servicio = require('./servicioOcr');
  if (numeroCi(frontal.fields?.ciNumber) !== propietario) agregar('El CI del propietario no coincide con el propietario del RUAT.');
  if (servicio.validarCi(frontal.text, 0, 'ciFront').rejected) {
    agregar('Revisa el anverso del CI del propietario.');
  }
  const clasificacion = servicio.clasificarCI(reverso.text, 0);
  if (servicio.validarCi(reverso.text, 0, 'ciBack').rejected) agregar('No se reconoce el reverso del CI del propietario.');
  if (clasificacion.hasMRZ) {
    const mrz = require('./ciMrz').inspectMrz(reverso.text);
    if (mrz.status !== 'valid' || numeroCi(mrz.documentNumber) !== propietario) {
      agregar('La MRZ del CI del propietario debe ser válida y coincidir con el propietario del RUAT.');
    }
  }
  return errores;
}

module.exports = { TIPOS_CI_PROPIETARIO, requiereCiPropietario, leerCiPropietario, validarCiPropietario };
