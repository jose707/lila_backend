'use strict';

const { test, after: despues } = require('node:test');
const comprobar = require('node:assert/strict');
const Viaje = require("../../models/Viaje");
const Conductor = require("../../models/Conductor");
const ConductorUbicacion = require('../../models/ConductorUbicacion');
const originalUbicacion = ConductorUbicacion.findByPk;
const { obtenerViajeRuta: obtenerViajeRuta } = require("../viajeRutaControlador");

const originalBuscarViaje = Viaje.findByPk;
const originalBuscarConductor = Conductor.findOne;
const originalConsultar = global.fetch;
const originalClave = process.env.GOOGLE_MAPS_API_KEY;

despues(() => {
  ConductorUbicacion.findByPk = originalUbicacion;
  Viaje.findByPk = originalBuscarViaje;
  Conductor.findOne = originalBuscarConductor;
  global.fetch = originalConsultar;
  if (originalClave === undefined) delete process.env.GOOGLE_MAPS_API_KEY;else
  process.env.GOOGLE_MAPS_API_KEY = originalClave;
});

const respuesta = () => ({
  code: 200,
  status(codigo) {this.code = codigo;return this;},
  json(cuerpo) {this.body = cuerpo;return this;}
});

test('traza la ruta del pasajero con las paradas en orden', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  Viaje.findByPk = async () => ({
    passengerId: 'pasajero',
    driverId: 'driver-record',
    pickupLocation: { coordinates: [-68.10, -16.50] },
    dropoffLocation: { coordinates: [-68.13, -16.53] },
    waypoints: [
    { sequence: 2, location: { coordinates: [-68.12, -16.52] } },
    { sequence: 1, location: { coordinates: [-68.11, -16.51] } }]

  });
  Conductor.findOne = async () => {throw new Error('No debe consultar al conductor');};
  global.fetch = async (url) => {
    comprobar.equal(new URL(url).searchParams.get('waypoints'), '-16.51,-68.11|-16.52,-68.12');
    return {
      ok: true,
      json: async () => ({
        status: 'OK',
        routes: [{ legs: [{}, {}, {}], overview_polyline: { points: 'encoded-road-route' } }]
      })
    };
  };
  const res = respuesta();
  await obtenerViajeRuta({ params: { rideId: 'ride-1' }, user: { id: 'pasajero' } }, res);
  comprobar.equal(res.code, 200);
  comprobar.deepEqual(res.body, { polyline: 'encoded-road-route' });
});

test('rechaza el acceso de usuarios ajenos al viaje', async () => {
  Conductor.findOne = async () => null;
  global.fetch = async () => {throw new Error('No debe consultar Google');};
  const res = respuesta();
  await obtenerViajeRuta({ params: { rideId: 'ride-1' }, user: { id: 'outsider' } }, res);
  comprobar.equal(res.code, 403);
});

test('permite al conductor asignado consultar el mismo recorrido', async () => {
  Conductor.findOne = async ({ where: condiciones }) => {
    comprobar.deepEqual(condiciones, { id: 'driver-record', userId: 'driver-user' });
    return { id: 'driver-record' };
  };
  const res = respuesta();
  await obtenerViajeRuta({ params: { rideId: 'ride-1' }, user: { id: 'driver-user' } }, res);
  comprobar.equal(res.code, 200);
  comprobar.deepEqual(res.body, { polyline: 'encoded-road-route' });
});

test('recalcula desde el GPS reciente y omite paradas visitadas', async () => {
  Viaje.findByPk = async () => ({
    passengerId: 'pasajero', driverId: 'driver-record', status: 'en_curso',
    pickupLocation: { coordinates: [-68.1, -16.5] },
    dropoffLocation: { coordinates: [-68.2, -16.6] },
    waypoints: [
      { sequence: 1, arrived_at: new Date(), location: { coordinates: [-68.11, -16.51] } },
      { sequence: 2, location: { coordinates: [-68.15, -16.55] } }
    ]
  });
  ConductorUbicacion.findByPk = async () => ({
    location: { coordinates: [-68.14, -16.54] }, location_recorded_at: new Date()
  });
  global.fetch = async (url) => {
    const params = new URL(url).searchParams;
    comprobar.equal(params.get('origin'), '-16.54,-68.14');
    comprobar.equal(params.get('waypoints'), '-16.55,-68.15');
    return { ok: true, json: async () => ({ status: 'OK', routes: [
      { legs: [{}, {}], overview_polyline: { points: 'rerouted' } }
    ] }) };
  };
  const res = respuesta();
  await obtenerViajeRuta({ params: { rideId: 'ride-1' }, query: { recalcular: '1' }, user: { id: 'pasajero' } }, res);
  comprobar.equal(res.code, 200);
  comprobar.equal(res.body.polyline, 'rerouted');
});

test('rechaza recalcular con una ubicación antigua', async () => {
  ConductorUbicacion.findByPk = async () => ({
    location: { coordinates: [-68.14, -16.54] }, location_recorded_at: new Date(Date.now() - 120000)
  });
  global.fetch = async () => { throw new Error('No debe consultar Google'); };
  const res = respuesta();
  await obtenerViajeRuta({ params: { rideId: 'ride-1' }, query: { recalcular: '1' }, user: { id: 'pasajero' } }, res);
  comprobar.equal(res.code, 409);
});
