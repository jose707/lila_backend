'use strict';

const normalizadoFecha = (valor) => {
  const texto = String(valor || '').trim();
  const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  if (local) return `${local[3]}-${local[2]}-${local[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : '';
};

function resolverEmisionLicencia(frontal = {}, reverso = {}) {
  const emisionFrontal = String(frontal.issueDate || '').trim();
  if (emisionFrontal) return normalizadoFecha(emisionFrontal);
  const numero = String(frontal.licenseNumber || '').replace(/\D/g, '');
  return numero && numero === String(reverso.licenseNumber || '').replace(/\D/g, '') ?
    normalizadoFecha(reverso.issueDate) : '';
}

function compararLicenciaLados(frontal = {}, reverso = {}) {
  const numeroFrontal = String(frontal.licenseNumber || '').replace(/\D/g, '');
  const numeroReverso = String(reverso.licenseNumber || '').replace(/\D/g, '');
  const complete = Boolean(numeroFrontal && numeroReverso);
  return {
    complete,
    matches: complete && numeroFrontal === numeroReverso
  };
}

function emisionLicenciaFutura(frontal = {}, reverso = {}, ahora = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(ahora).map(({ type, value }) => [type, value]));
  const hoy = `${partes.year}-${partes.month}-${partes.day}`;
  return [frontal, reverso].some(lado => {
    const fecha = normalizadoFecha(lado.issueDate);
    return Boolean(fecha && fecha > hoy);
  });
}

module.exports = { compararLicenciaLados, resolverEmisionLicencia, emisionLicenciaFutura };
