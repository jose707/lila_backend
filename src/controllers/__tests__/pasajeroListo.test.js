'use strict';

const { test, afterEach } = require('node:test');
const comprobar = require('node:assert/strict');
const Viaje = require('../../models/Viaje');
const socket = require('../../socket');
const eventos = [];
const obtenerIoOriginal = socket.obtenerIo;
socket.obtenerIo = () => ({ to: sala => ({ emit: (evento, datos) => eventos.push({ sala, evento, datos }) }) });
const { pasajeroListo } = require('../viajeControlador');
socket.obtenerIo = obtenerIoOriginal;

const actualizarOriginal = Viaje.update;
const buscarOriginal = Viaje.findByPk;
afterEach(() => {
  Viaje.update = actualizarOriginal;
  Viaje.findByPk = buscarOriginal;
  eventos.length = 0;
});

// Simula la actualización condicional de una fila sin usar datos de usuarios.
function preparar(estado = 'llegado', fecha = null, existe = true) {
  const fila = { id: 'viaje-fi04', status: estado, passengerReadyAt: fecha };
  Viaje.update = async (valores, { where }) => {
    comprobar.deepEqual(where, { id: fila.id, status: 'llegado', passengerReadyAt: null });
    if (!existe || fila.status !== where.status || fila.passengerReadyAt !== null) return [0];
    fila.passengerReadyAt = valores.passengerReadyAt;
    return [1];
  };
  Viaje.findByPk = async () => existe ? { ...fila } : null;
  return fila;
}

async function confirmar() {
  const respuesta = {
    codigo: null,
    status(codigo) { this.codigo = codigo; return this; },
    json(cuerpo) { this.cuerpo = cuerpo; return this; }
  };
  await pasajeroListo({ params: { rideId: 'viaje-fi04' } }, respuesta);
  return respuesta;
}

test('FI-04: primera confirmación guarda la fecha y notifica una vez', async () => {
  const fila = preparar();
  const respuesta = await confirmar();
  comprobar.equal(respuesta.codigo, 200);
  comprobar.ok(fila.passengerReadyAt instanceof Date);
  comprobar.equal(eventos.length, 1);
  comprobar.equal(eventos[0].datos.status, 'passenger_ready');
});

test('FI-04: reintento tras perder la respuesta conserva la primera fecha', async () => {
  const fila = preparar();
  await confirmar(); // El servidor confirmó; el cliente pierde esta respuesta.
  const primeraFecha = fila.passengerReadyAt.toISOString();
  const respuesta = await confirmar();
  comprobar.equal(respuesta.codigo, 200);
  comprobar.equal(respuesta.cuerpo.ride.passengerReadyAt.toISOString(), primeraFecha);
  comprobar.equal(eventos.length, 1);
});

test('FI-04: dos confirmaciones simultáneas conservan una sola fecha y notificación', async () => {
  preparar();
  const respuestas = await Promise.all([confirmar(), confirmar()]);
  comprobar.deepEqual(respuestas.map(r => r.codigo), [200, 200]);
  comprobar.equal(respuestas[0].cuerpo.ride.passengerReadyAt.getTime(), respuestas[1].cuerpo.ride.passengerReadyAt.getTime());
  comprobar.equal(eventos.length, 1);
});

test('FI-04: reintento confirmado devuelve éxito aunque el viaje ya esté en curso', async () => {
  const fecha = new Date('2026-11-21T10:30:00Z');
  preparar('en_curso', fecha);
  const respuesta = await confirmar();
  comprobar.equal(respuesta.codigo, 200);
  comprobar.equal(respuesta.cuerpo.ride.passengerReadyAt, fecha);
  comprobar.equal(eventos.length, 0);
});

test('FI-04: rechaza una primera confirmación en un estado no permitido', async () => {
  const fila = preparar('aceptado');
  const respuesta = await confirmar();
  comprobar.equal(respuesta.codigo, 400);
  comprobar.equal(fila.passengerReadyAt, null);
  comprobar.equal(eventos.length, 0);
});

test('FI-04: devuelve 404 cuando el viaje no existe', async () => {
  preparar('llegado', null, false);
  comprobar.equal((await confirmar()).codigo, 404);
});
