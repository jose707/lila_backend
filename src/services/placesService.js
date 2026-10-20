'use strict';

const fail = (status, message) => Object.assign(new Error(message), { status });
function validateSession(sessionToken) {
  if (
    typeof sessionToken !== 'string' ||
    !/^[\w-]{16,36}$/.test(sessionToken)
  ) {
    throw fail(400, 'Sesión de búsqueda inválida.');
  }
}
async function googleRequest(path, options, fieldMask) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw fail(503, 'La búsqueda de destinos no está configurada.');
  try {
    const response = await fetch(`https://places.googleapis.com/v1/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': fieldMask,
      },
      signal: global.AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      if (response.status === 404)
        throw fail(404, 'Este lugar ya no está disponible. Busca nuevamente.');
      if (response.status === 429)
        throw fail(
          503,
          'La búsqueda está ocupada. Intenta de nuevo en unos segundos.',
        );
      throw fail(
        502,
        'La búsqueda de destinos no está disponible temporalmente. Intenta nuevamente.',
      );
    }
    return await response.json();
  } catch (error) {
    if (error.status) throw error;
    throw fail(
      503,
      'No se pudo conectar con la búsqueda de destinos. Intenta nuevamente.',
    );
  }
}
async function autocomplete({ input, sessionToken, latitude, longitude }) {
  validateSession(sessionToken);
  if (
    typeof input !== 'string' ||
    input.trim().length < 2 ||
    input.length > 200
  )
    throw fail(400, 'Escribe entre 2 y 200 caracteres.');
  if (
    (latitude !== undefined || longitude !== undefined) &&
    (!Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180)
  ) {
    throw fail(400, 'Ubicación de búsqueda inválida.');
  }
  const body = {
    input: input.trim(),
    sessionToken,
    languageCode: 'es',
    includedRegionCodes: ['bo'],
    // Preserve the existing La Paz search area.
    locationRestriction: {
      rectangle: {
        low: { latitude: -16.63, longitude: -68.24 },
        high: { latitude: -16.29, longitude: -68.06 },
      },
    },
  };
  if (latitude !== undefined) body.origin = { latitude, longitude };
  const data = await googleRequest(
    'places:autocomplete',
    { method: 'POST', body: JSON.stringify(body) },
    'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.distanceMeters',
  );
  return (data.suggestions || [])
    .filter(s => s.placePrediction?.placeId && s.placePrediction?.text?.text)
    .map(({ placePrediction: p }) => {
      const address = p.text.text.replace(/,\s*Bolivia\s*$/i, '').trim();
      const [mainText, ...rest] = address.split(',');
      return {
        placeId: p.placeId,
        address,
        mainText: mainText.trim(),
        secondaryText: rest.join(',').trim(),
        sessionToken,
        ...(Number.isFinite(p.distanceMeters)
          ? { distanceMeters: p.distanceMeters }
          : {}),
      };
    })
    .sort((a, b) =>
      latitude === undefined
        ? 0
        : (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity),
    );
}
async function details({ placeId, sessionToken }) {
  validateSession(sessionToken);
  if (typeof placeId !== 'string' || !/^[\w-]{1,255}$/.test(placeId))
    throw fail(400, 'Lugar inválido.');
  const query = new URLSearchParams({ sessionToken, languageCode: 'es' });
  const data = await googleRequest(
    `places/${encodeURIComponent(placeId)}?${query}`,
    { method: 'GET' },
    'id,formattedAddress,location',
  );
  if (
    !Number.isFinite(data.location?.latitude) ||
    !Number.isFinite(data.location?.longitude) ||
    !data.formattedAddress
  ) {
    throw fail(502, 'El lugar seleccionado no tiene una ubicación válida.');
  }
  return {
    placeId: data.id,
    address: data.formattedAddress,
    display_name: data.formattedAddress,
    lat: String(data.location.latitude),
    lon: String(data.location.longitude),
  };
}
module.exports = { autocomplete, details };
