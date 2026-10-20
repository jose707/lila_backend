'use strict';
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const places = require('../placesService');
const originalFetch = global.fetch;
const originalKey = process.env.GOOGLE_MAPS_API_KEY;
const token = 'places_test_session_12345';
beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = 'server-only-test-key';
});
after(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = originalKey;
});
test('autocomplete envía idioma, límites de La Paz y sesión; no solicita coordenadas por sugerencia', async () => {
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://places.googleapis.com/v1/places:autocomplete');
    const body = JSON.parse(options.body);
    assert.equal(body.sessionToken, token);
    assert.equal(body.input, 'Plaza Murillo');
    assert.equal(body.languageCode, 'es');
    assert.deepEqual(body.includedRegionCodes, ['bo']);
    assert.equal(body.locationRestriction.rectangle.low.latitude, -16.63);
    assert.deepEqual(body.origin, { latitude: -16.5, longitude: -68.15 });
    assert.equal(options.headers['X-Goog-Api-Key'], 'server-only-test-key');
    assert.ok(!options.headers['X-Goog-FieldMask'].includes('location'));
    return {
      ok: true,
      json: async () => ({
        suggestions: [
          {
            placePrediction: {
              placeId: 'ChIJ123',
              text: { text: 'Plaza Murillo, La Paz' },
            },
          },
          { queryPrediction: { text: { text: 'ignored' } } },
        ],
      }),
    };
  };
  assert.deepEqual(
    await places.autocomplete({
      input: ' Plaza Murillo ',
      sessionToken: token,
      latitude: -16.5,
      longitude: -68.15,
    }),
    [
      {
        placeId: 'ChIJ123',
        address: 'Plaza Murillo, La Paz',
        mainText: 'Plaza Murillo',
        secondaryText: 'La Paz',
        sessionToken: token,
      },
    ],
  );
});
test('detalles resuelve coordenadas usando la misma sesión y campos mínimos', async () => {
  global.fetch = async (url, options) => {
    assert.equal(new URL(url).searchParams.get('sessionToken'), token);
    assert.equal(
      options.headers['X-Goog-FieldMask'],
      'id,formattedAddress,location',
    );
    return {
      ok: true,
      json: async () => ({
        id: 'ChIJ123',
        formattedAddress: 'Plaza Murillo',
        location: { latitude: -16.495, longitude: -68.133 },
      }),
    };
  };
  const result = await places.details({
    placeId: 'ChIJ123',
    sessionToken: token,
  });
  assert.equal(result.lat, '-16.495');
  assert.equal(result.lon, '-68.133');
});
test('rechaza entradas inválidas antes de llamar a Google', async () => {
  global.fetch = async () => {
    assert.fail('No debe llamar a Google');
  };
  for (const data of [
    { input: 'a', sessionToken: token },
    { input: 'Plaza', sessionToken: 'bad' },
    { input: 'Plaza', sessionToken: token, latitude: '12', longitude: 0 },
  ]) {
    await assert.rejects(
      places.autocomplete(data),
      error => error.status === 400,
    );
  }
  await assert.rejects(
    places.details({ placeId: '../config?key=x', sessionToken: token }),
    error => error.status === 400,
  );
});
test('distingue cero resultados de fallo de API y no expone credenciales', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ suggestions: [] }),
  });
  assert.deepEqual(
    await places.autocomplete({ input: 'Plaza', sessionToken: token }),
    [],
  );
  global.fetch = async () => ({ ok: false, status: 403 });
  await assert.rejects(
    places.autocomplete({ input: 'Plaza', sessionToken: token }),
    error =>
      error.status === 502 && !error.message.includes('server-only-test-key'),
  );
  global.fetch = async () => {
    throw new Error('network failure');
  };
  await assert.rejects(
    places.details({ placeId: 'ChIJ123', sessionToken: token }),
    error => error.status === 503,
  );
});
test('sin clave o sin coordenadas no inventa un destino', async () => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  await assert.rejects(
    places.autocomplete({ input: 'Plaza', sessionToken: token }),
    error => error.status === 503,
  );
  process.env.GOOGLE_MAPS_API_KEY = 'test';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ formattedAddress: 'Plaza' }),
  });
  await assert.rejects(
    places.details({ placeId: 'ChIJ123', sessionToken: token }),
    error => error.status === 502,
  );
});

test('ordena sugerencias por cercanía y separa la dirección sin el país', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      suggestions: [
        {
          placePrediction: {
            placeId: 'far',
            text: { text: 'Farmacia Central, Avenida Arce, La Paz, Bolivia' },
            distanceMeters: 1500,
          },
        },
        {
          placePrediction: {
            placeId: 'unknown',
            text: { text: 'Farmacia Sin Distancia, La Paz, Bolivia' },
          },
        },
        {
          placePrediction: {
            placeId: 'near',
            text: { text: 'Farmacia Cercana, Calle 1, La Paz, Bolivia' },
            distanceMeters: 0,
          },
        },
      ],
    }),
  });
  const results = await places.autocomplete({
    input: 'Farmacia',
    sessionToken: token,
    latitude: -16.5,
    longitude: -68.15,
  });
  assert.deepEqual(
    results.map(r => r.placeId),
    ['near', 'far', 'unknown'],
  );
  assert.equal(results[0].mainText, 'Farmacia Cercana');
  assert.equal(results[0].secondaryText, 'Calle 1, La Paz');
  assert.ok(results.every(r => !r.address.includes('Bolivia')));
  const withoutLocation = await places.autocomplete({
    input: 'Farmacia',
    sessionToken: token,
  });
  assert.deepEqual(
    withoutLocation.map(r => r.placeId),
    ['far', 'unknown', 'near'],
  );
});
