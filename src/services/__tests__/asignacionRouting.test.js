'use strict';
const { test, after: despues } = require('node:test');
const comprobar = require('node:assert/strict');
const { conduccionRuta: conduccionRuta, conduccionRutaPolilinea: conduccionRutaPolilinea } = require("../asignacionRouting");
const originalConsultar = global.fetch;
const originalClave = process.env.GOOGLE_MAPS_API_KEY;
despues(() => {
  global.fetch = originalConsultar;
  if (originalClave === undefined) delete process.env.GOOGLE_MAPS_API_KEY;else
  process.env.GOOGLE_MAPS_API_KEY = originalClave;
});
const puntos = [
{ latitude: -16.5, longitude: -68.15 },
{ latitude: -16.51, longitude: -68.15 },
{ latitude: -16.52, longitude: -68.15 }];

test('sin clave de rutas no inventa una distancia para cobrar', async () => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  await comprobar.rejects(
    conduccionRuta(puntos),
    (error) => error.code === 'ROUTING_UNAVAILABLE'
  );
});
test('suma tramos por carretera y envía paradas en orden', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  global.fetch = async (url) => {
    comprobar.equal(new URL(url).searchParams.get('waypoints'), '-16.51,-68.15');
    return {
      ok: true,
      json: async () => ({
        status: 'OK',
        routes: [
        {
          legs: [
          { distance: { value: 1200 }, duration: { value: 120 } },
          { distance: { value: 2100 }, duration: { value: 300 } }]

        }]

      })
    };
  };
  comprobar.deepEqual(await conduccionRuta(puntos), {
    distance: 3300,
    duration: 420
  });
});
test('fallo o ausencia de ruta no produce cotización', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ status: 'ZERO_RESULTS', routes: [] })
  });
  await comprobar.rejects(
    conduccionRuta(puntos),
    (error) => error.code === 'ROUTING_UNAVAILABLE'
  );
  global.fetch = async () => {
    throw new Error('timeout');
  };
  await comprobar.rejects(
    conduccionRuta(puntos),
    (error) => error.code === 'ROUTING_UNAVAILABLE'
  );
});

test('traza una sola ruta por carretera que pasa por las paradas y reutiliza su geometría', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  let solicitudes = 0;
  const rutaPuntos = [
  { latitude: -16.501, longitude: -68.151 },
  { latitude: -16.511, longitude: -68.151 },
  { latitude: -16.521, longitude: -68.151 }];

  global.fetch = async (url) => {
    solicitudes += 1;
    comprobar.equal(new URL(url).searchParams.get('waypoints'), '-16.511,-68.151');
    return {
      ok: true,
      json: async () => ({
        status: 'OK',
        routes: [{
          legs: [{}, {}],
          overview_polyline: { points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }
        }]
      })
    };
  };
  comprobar.equal(await conduccionRutaPolilinea(rutaPuntos), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  comprobar.equal(await conduccionRutaPolilinea(rutaPuntos), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  comprobar.equal(solicitudes, 1);
});

test('no devuelve líneas rectas si Google no entrega geometría', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ status: 'OK', routes: [{ legs: [{}, {}] }] })
  });
  await comprobar.rejects(
    conduccionRutaPolilinea([
    { latitude: -16.502, longitude: -68.152 },
    { latitude: -16.512, longitude: -68.152 },
    { latitude: -16.522, longitude: -68.152 }]
    ),
    (error) => error.code === 'ROUTING_UNAVAILABLE'
  );
});
