'use strict';

const RADIO_METROS = 3000;
const RESERVA_SEGUNDOS = 20;
const UBICACION_MAXIMO_ANTIGUEDAD_SEGUNDOS = 60;
const ACTIVO_ESTADOS = ['aceptado', 'llegado', 'en_curso'];
const fallar = (estado, mensaje, codigo) =>
Object.assign(new Error(mensaje), { status: estado, code: codigo });

function validarPunto(punto) {
  return (
    punto &&
    typeof punto.latitude === 'number' &&
    typeof punto.longitude === 'number' &&
    Number.isFinite(punto.latitude) &&
    Number.isFinite(punto.longitude) &&
    Math.abs(punto.latitude) <= 90 &&
    Math.abs(punto.longitude) <= 180 &&
    typeof punto.address === 'string' &&
    punto.address.trim().length > 0);

}

module.exports = {
  RADIO_METROS: RADIO_METROS,
  RESERVA_SEGUNDOS: RESERVA_SEGUNDOS,
  UBICACION_MAXIMO_ANTIGUEDAD_SEGUNDOS: UBICACION_MAXIMO_ANTIGUEDAD_SEGUNDOS,
  ACTIVO_ESTADOS: ACTIVO_ESTADOS,
  fallar: fallar,
  validarPunto: validarPunto
};
