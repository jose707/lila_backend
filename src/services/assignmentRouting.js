'use strict';
const { fail } = require('./quickAssignmentPolicy');
const geometryCache = new Map();

async function fetchDrivingRoute(points) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key)
    throw fail(
      503,
      'Configura Google Directions API en el servidor.',
      'ROUTING_UNAVAILABLE',
    );
  const coord = point => `${point.latitude},${point.longitude}`;
  const params = new URLSearchParams({
    origin: coord(points[0]),
    destination: coord(points.at(-1)),
    mode: 'driving',
    language: 'es',
    key,
  });
  if (points.length > 2)
    params.set('waypoints', points.slice(1, -1).map(coord).join('|'));
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?${params}`,
      {
        signal: global.AbortSignal.timeout(5000),
      },
    );
    const result = await response.json();
    const route = result.routes?.[0];
    const legs = route?.legs;
    if (!response.ok || result.status !== 'OK' || !legs?.length)
      throw new Error('Route unavailable');
    return route;
  } catch {
    throw fail(
      503,
      'No se pudo calcular la ruta. Intenta de nuevo.',
      'ROUTING_UNAVAILABLE',
    );
  }
}

// Server-side routing: never bill client-supplied distances, durations or fares.
async function drivingRoute(points) {
  const route = await fetchDrivingRoute(points);
  try {
    const { legs } = route;
    const distance = legs.reduce((sum, leg) => sum + leg.distance.value, 0);
    const duration = legs.reduce((sum, leg) => sum + leg.duration.value, 0);
    if (
      ![distance, duration].every(Number.isFinite) ||
      distance < 0 ||
      duration < 0
    )
      throw new Error('Invalid route');
    return { distance, duration: Math.round(duration) };
  } catch {
    throw fail(
      503,
      'No se pudo calcular la ruta. Intenta de nuevo.',
      'ROUTING_UNAVAILABLE',
    );
  }
}

async function drivingRoutePolyline(points) {
  const cacheKey = points.map(point => `${point.latitude},${point.longitude}`).join('|');
  const cached = geometryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.polyline;
  const route = await fetchDrivingRoute(points);
  const polyline = route.overview_polyline?.points;
  if (typeof polyline !== 'string' || !polyline || route.legs.length !== points.length - 1)
    throw fail(503, 'No se pudo trazar el recorrido por carretera.', 'ROUTING_UNAVAILABLE');
  geometryCache.set(cacheKey, { polyline, expiresAt: Date.now() + 60 * 60 * 1000 });
  if (geometryCache.size > 500) geometryCache.delete(geometryCache.keys().next().value);
  return polyline;
}

module.exports = { drivingRoute, drivingRoutePolyline };
