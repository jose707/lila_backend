'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Ride = require('../../models/Ride');
const Driver = require('../../models/Driver');
const { getRideRoute } = require('../rideRouteController');

const originalFindRide = Ride.findByPk;
const originalFindDriver = Driver.findOne;
const originalFetch = global.fetch;
const originalKey = process.env.GOOGLE_MAPS_API_KEY;

after(() => {
  Ride.findByPk = originalFindRide;
  Driver.findOne = originalFindDriver;
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = originalKey;
});

const response = () => ({
  code: 200,
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});

test('traza la ruta del pasajero con las paradas en orden', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  Ride.findByPk = async () => ({
    passengerId: 'passenger',
    driverId: 'driver-record',
    pickupLocation: { coordinates: [-68.10, -16.50] },
    dropoffLocation: { coordinates: [-68.13, -16.53] },
    waypoints: [
      { sequence: 2, location: { coordinates: [-68.12, -16.52] } },
      { sequence: 1, location: { coordinates: [-68.11, -16.51] } },
    ],
  });
  Driver.findOne = async () => { throw new Error('No debe consultar al conductor'); };
  global.fetch = async url => {
    assert.equal(new URL(url).searchParams.get('waypoints'), '-16.51,-68.11|-16.52,-68.12');
    return {
      ok: true,
      json: async () => ({
        status: 'OK',
        routes: [{ legs: [{}, {}, {}], overview_polyline: { points: 'encoded-road-route' } }],
      }),
    };
  };
  const res = response();
  await getRideRoute({ params: { rideId: 'ride-1' }, user: { id: 'passenger' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { polyline: 'encoded-road-route' });
});

test('rechaza el acceso de usuarios ajenos al viaje', async () => {
  Driver.findOne = async () => null;
  global.fetch = async () => { throw new Error('No debe consultar Google'); };
  const res = response();
  await getRideRoute({ params: { rideId: 'ride-1' }, user: { id: 'outsider' } }, res);
  assert.equal(res.code, 403);
});

test('permite al conductor asignado consultar el mismo recorrido', async () => {
  Driver.findOne = async ({ where }) => {
    assert.deepEqual(where, { id: 'driver-record', userId: 'driver-user' });
    return { id: 'driver-record' };
  };
  const res = response();
  await getRideRoute({ params: { rideId: 'ride-1' }, user: { id: 'driver-user' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { polyline: 'encoded-road-route' });
});
