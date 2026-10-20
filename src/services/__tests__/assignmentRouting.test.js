'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { drivingRoute, drivingRoutePolyline } = require('../assignmentRouting');
const originalFetch = global.fetch;
const originalKey = process.env.GOOGLE_MAPS_API_KEY;
after(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = originalKey;
});
const points = [
  { latitude: -16.5, longitude: -68.15 },
  { latitude: -16.51, longitude: -68.15 },
  { latitude: -16.52, longitude: -68.15 },
];
test('sin clave de rutas no inventa una distancia para cobrar', async () => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  await assert.rejects(
    drivingRoute(points),
    error => error.code === 'ROUTING_UNAVAILABLE',
  );
});
test('suma tramos por carretera y envía paradas en orden', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  global.fetch = async url => {
    assert.equal(new URL(url).searchParams.get('waypoints'), '-16.51,-68.15');
    return {
      ok: true,
      json: async () => ({
        status: 'OK',
        routes: [
          {
            legs: [
              { distance: { value: 1200 }, duration: { value: 120 } },
              { distance: { value: 2100 }, duration: { value: 300 } },
            ],
          },
        ],
      }),
    };
  };
  assert.deepEqual(await drivingRoute(points), {
    distance: 3300,
    duration: 420,
  });
});
test('fallo o ausencia de ruta no produce cotización', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ status: 'ZERO_RESULTS', routes: [] }),
  });
  await assert.rejects(
    drivingRoute(points),
    error => error.code === 'ROUTING_UNAVAILABLE',
  );
  global.fetch = async () => {
    throw new Error('timeout');
  };
  await assert.rejects(
    drivingRoute(points),
    error => error.code === 'ROUTING_UNAVAILABLE',
  );
});

test('traza una sola ruta por carretera que pasa por las paradas y reutiliza su geometría', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  let requests = 0;
  const routePoints = [
    { latitude: -16.501, longitude: -68.151 },
    { latitude: -16.511, longitude: -68.151 },
    { latitude: -16.521, longitude: -68.151 },
  ];
  global.fetch = async url => {
    requests += 1;
    assert.equal(new URL(url).searchParams.get('waypoints'), '-16.511,-68.151');
    return {
      ok: true,
      json: async () => ({
        status: 'OK',
        routes: [{
          legs: [{}, {}],
          overview_polyline: { points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
        }],
      }),
    };
  };
  assert.equal(await drivingRoutePolyline(routePoints), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(await drivingRoutePolyline(routePoints), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(requests, 1);
});

test('no devuelve líneas rectas si Google no entrega geometría', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ status: 'OK', routes: [{ legs: [{}, {}] }] }),
  });
  await assert.rejects(
    drivingRoutePolyline([
      { latitude: -16.502, longitude: -68.152 },
      { latitude: -16.512, longitude: -68.152 },
      { latitude: -16.522, longitude: -68.152 },
    ]),
    error => error.code === 'ROUTING_UNAVAILABLE',
  );
});
