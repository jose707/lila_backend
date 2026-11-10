'use strict';
const { fallar: fallar } = require("./rapidaAsignacionPolicy");
const geometriaCache = new Map();

async function consultarConduccionRuta(puntos) {
  const clave = process.env.GOOGLE_MAPS_API_KEY;
  if (!clave)
  throw fallar(
    503,
    'Configura Google Directions API en el servidor.',
    'ROUTING_UNAVAILABLE'
  );
  const coord = (punto) => `${punto.latitude},${punto.longitude}`;
  const parametros = new URLSearchParams({
    origin: coord(puntos[0]),
    destination: coord(puntos.at(-1)),
    mode: 'driving',
    language: 'es',
    key: clave
  });
  if (puntos.length > 2)
  parametros.set('waypoints', puntos.slice(1, -1).map(coord).join('|'));
  try {
    const respuesta = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?${parametros}`,
      {
        signal: global.AbortSignal.timeout(5000)
      }
    );
    const resultado = await respuesta.json();
    const ruta = resultado.routes?.[0];
    const legs = ruta?.legs;
    if (!respuesta.ok || resultado.status !== 'OK' || !legs?.length)
    throw new Error('Route unavailable');
    return ruta;
  } catch {
    throw fallar(
      503,
      'No se pudo calcular la ruta. Intenta de nuevo.',
      'ROUTING_UNAVAILABLE'
    );
  }
}

// Server-side routing: never bill client-supplied distances, durations or fares.
async function conduccionRuta(puntos) {
  const ruta = await consultarConduccionRuta(puntos);
  try {
    const { legs } = ruta;
    const distancia = legs.reduce((suma, leg) => suma + leg.distance.value, 0);
    const duracion = legs.reduce((suma, leg) => suma + leg.duration.value, 0);
    if (
    ![distancia, duracion].every(Number.isFinite) ||
    distancia < 0 ||
    duracion < 0)

    throw new Error('Invalid route');
    return { distance: distancia, duration: Math.round(duracion) };
  } catch {
    throw fallar(
      503,
      'No se pudo calcular la ruta. Intenta de nuevo.',
      'ROUTING_UNAVAILABLE'
    );
  }
}

async function conduccionRutaPolilinea(puntos) {
  const cacheClave = puntos.map((punto) => `${punto.latitude},${punto.longitude}`).join('|');
  const cacheado = geometriaCache.get(cacheClave);
  if (cacheado && cacheado.expiresAt > Date.now()) return cacheado.polyline;
  const ruta = await consultarConduccionRuta(puntos);
  const polilinea = ruta.overview_polyline?.points;
  if (typeof polilinea !== 'string' || !polilinea || ruta.legs.length !== puntos.length - 1)
  throw fallar(503, 'No se pudo trazar el recorrido por carretera.', 'ROUTING_UNAVAILABLE');
  geometriaCache.set(cacheClave, { polyline: polilinea, expiresAt: Date.now() + 60 * 60 * 1000 });
  if (geometriaCache.size > 500) geometriaCache.delete(geometriaCache.keys().next().value);
  return polilinea;
}

module.exports = { conduccionRuta: conduccionRuta, conduccionRutaPolilinea: conduccionRutaPolilinea };
