'use strict';
const { test, after: despues, beforeEach: antesCada } = require('node:test');
const comprobar = require('node:assert/strict');
const lugares = require("../placesServicio");
const originalConsultar = global.fetch;
const originalClave = process.env.GOOGLE_MAPS_API_KEY;
const token = 'places_test_session_12345';
antesCada(() => {
  process.env.GOOGLE_MAPS_API_KEY = 'server-only-test-key';
});
despues(() => {
  global.fetch = originalConsultar;
  if (originalClave === undefined) delete process.env.GOOGLE_MAPS_API_KEY;else
  process.env.GOOGLE_MAPS_API_KEY = originalClave;
});
test('autocomplete envía idioma, límites de La Paz y sesión; no solicita coordenadas por sugerencia', async () => {
  global.fetch = async (url, opciones) => {
    comprobar.equal(url, 'https://places.googleapis.com/v1/places:autocomplete');
    const cuerpo = JSON.parse(opciones.body);
    comprobar.equal(cuerpo.sessionToken, token);
    comprobar.equal(cuerpo.input, 'Plaza Murillo');
    comprobar.equal(cuerpo.languageCode, 'es');
    comprobar.deepEqual(cuerpo.includedRegionCodes, ['bo']);
    comprobar.equal(cuerpo.locationRestriction.rectangle.low.latitude, -16.63);
    comprobar.deepEqual(cuerpo.origin, { latitude: -16.5, longitude: -68.15 });
    comprobar.equal(opciones.headers['X-Goog-Api-Key'], 'server-only-test-key');
    comprobar.ok(!opciones.headers['X-Goog-FieldMask'].includes('location'));
    return {
      ok: true,
      json: async () => ({
        suggestions: [
        {
          placePrediction: {
            placeId: 'ChIJ123',
            text: { text: 'Plaza Murillo, La Paz' }
          }
        },
        { queryPrediction: { text: { text: 'ignored' } } }]

      })
    };
  };
  comprobar.deepEqual(
    await lugares.autocompletar({
      input: ' Plaza Murillo ',
      sessionToken: token,
      latitude: -16.5,
      longitude: -68.15
    }),
    [
    {
      placeId: 'ChIJ123',
      address: 'Plaza Murillo, La Paz',
      mainText: 'Plaza Murillo',
      secondaryText: 'La Paz',
      sessionToken: token
    }]

  );
});
test('detalles resuelve coordenadas usando la misma sesión y campos mínimos', async () => {
  global.fetch = async (url, opciones) => {
    comprobar.equal(new URL(url).searchParams.get('sessionToken'), token);
    comprobar.equal(
      opciones.headers['X-Goog-FieldMask'],
      'id,formattedAddress,location'
    );
    return {
      ok: true,
      json: async () => ({
        id: 'ChIJ123',
        formattedAddress: 'Plaza Murillo',
        location: { latitude: -16.495, longitude: -68.133 }
      })
    };
  };
  const resultado = await lugares.detalles({
    placeId: 'ChIJ123',
    sessionToken: token
  });
  comprobar.equal(resultado.lat, '-16.495');
  comprobar.equal(resultado.lon, '-68.133');
});
test('rechaza entradas inválidas antes de llamar a Google', async () => {
  global.fetch = async () => {
    comprobar.fail('No debe llamar a Google');
  };
  for (const datos of [
  { input: 'a', sessionToken: token },
  { input: 'Plaza', sessionToken: 'bad' },
  { input: 'Plaza', sessionToken: token, latitude: '12', longitude: 0 }])
  {
    await comprobar.rejects(
      lugares.autocompletar(datos),
      (error) => error.status === 400
    );
  }
  await comprobar.rejects(
    lugares.detalles({ placeId: '../config?key=x', sessionToken: token }),
    (error) => error.status === 400
  );
});
test('distingue cero resultados de fallo de API y no expone credenciales', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ suggestions: [] })
  });
  comprobar.deepEqual(
    await lugares.autocompletar({ input: 'Plaza', sessionToken: token }),
    []
  );
  global.fetch = async () => ({ ok: false, status: 403 });
  await comprobar.rejects(
    lugares.autocompletar({ input: 'Plaza', sessionToken: token }),
    (error) =>
    error.status === 502 && !error.message.includes('server-only-test-key')
  );
  global.fetch = async () => {
    throw new Error('network failure');
  };
  await comprobar.rejects(
    lugares.detalles({ placeId: 'ChIJ123', sessionToken: token }),
    (error) => error.status === 503
  );
});
test('sin clave o sin coordenadas no inventa un destino', async () => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  await comprobar.rejects(
    lugares.autocompletar({ input: 'Plaza', sessionToken: token }),
    (error) => error.status === 503
  );
  process.env.GOOGLE_MAPS_API_KEY = 'test';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ formattedAddress: 'Plaza' })
  });
  await comprobar.rejects(
    lugares.detalles({ placeId: 'ChIJ123', sessionToken: token }),
    (error) => error.status === 502
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
          distanceMeters: 1500
        }
      },
      {
        placePrediction: {
          placeId: 'unknown',
          text: { text: 'Farmacia Sin Distancia, La Paz, Bolivia' }
        }
      },
      {
        placePrediction: {
          placeId: 'near',
          text: { text: 'Farmacia Cercana, Calle 1, La Paz, Bolivia' },
          distanceMeters: 0
        }
      }]

    })
  });
  const resultados = await lugares.autocompletar({
    input: 'Farmacia',
    sessionToken: token,
    latitude: -16.5,
    longitude: -68.15
  });
  comprobar.deepEqual(
    resultados.map((r) => r.placeId),
    ['near', 'far', 'unknown']
  );
  comprobar.equal(resultados[0].mainText, 'Farmacia Cercana');
  comprobar.equal(resultados[0].secondaryText, 'Calle 1, La Paz');
  comprobar.ok(resultados.every((r) => !r.address.includes('Bolivia')));
  const sinUbicacion = await lugares.autocompletar({
    input: 'Farmacia',
    sessionToken: token
  });
  comprobar.deepEqual(
    sinUbicacion.map((r) => r.placeId),
    ['far', 'unknown', 'near']
  );
});
