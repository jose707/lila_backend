'use strict';

const fallar = (estado, mensaje) => Object.assign(new Error(mensaje), { status: estado });
function validarSesion(sesionToken) {
  if (
  typeof sesionToken !== 'string' ||
  !/^[\w-]{16,36}$/.test(sesionToken))
  {
    throw fallar(400, 'Sesión de búsqueda inválida.');
  }
}
async function googleSolicitud(ruta, opciones, campoMask) {
  const clave = process.env.GOOGLE_MAPS_API_KEY;
  if (!clave) throw fallar(503, 'La búsqueda de destinos no está configurada.');
  try {
    const respuesta = await fetch(`https://places.googleapis.com/v1/${ruta}`, {
      ...opciones,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': clave,
        'X-Goog-FieldMask': campoMask
      },
      signal: global.AbortSignal.timeout(8000)
    });
    if (!respuesta.ok) {
      if (respuesta.status === 404)
      throw fallar(404, 'Este lugar ya no está disponible. Busca nuevamente.');
      if (respuesta.status === 429)
      throw fallar(
        503,
        'La búsqueda está ocupada. Intenta de nuevo en unos segundos.'
      );
      throw fallar(
        502,
        'La búsqueda de destinos no está disponible temporalmente. Intenta nuevamente.'
      );
    }
    return await respuesta.json();
  } catch (error) {
    if (error.status) throw error;
    throw fallar(
      503,
      'No se pudo conectar con la búsqueda de destinos. Intenta nuevamente.'
    );
  }
}
async function autocompletar({ input: entrada, sessionToken: sesionToken, latitude: latitud, longitude: longitud }) {
  validarSesion(sesionToken);
  if (
  typeof entrada !== 'string' ||
  entrada.trim().length < 2 ||
  entrada.length > 200)

  throw fallar(400, 'Escribe entre 2 y 200 caracteres.');
  if (
  (latitud !== undefined || longitud !== undefined) && (
  !Number.isFinite(latitud) ||
  !Number.isFinite(longitud) ||
  Math.abs(latitud) > 90 ||
  Math.abs(longitud) > 180))
  {
    throw fallar(400, 'Ubicación de búsqueda inválida.');
  }
  const cuerpo = {
    input: entrada.trim(),
    sessionToken: sesionToken,
    languageCode: 'es',
    includedRegionCodes: ['bo'],
    // Preserve the existing La Paz search area.
    locationRestriction: {
      rectangle: {
        low: { latitude: -16.63, longitude: -68.24 },
        high: { latitude: -16.29, longitude: -68.06 }
      }
    }
  };
  if (latitud !== undefined) cuerpo.origin = { latitude: latitud, longitude: longitud };
  const datos = await googleSolicitud(
    'places:autocomplete',
    { method: 'POST', body: JSON.stringify(cuerpo) },
    'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.distanceMeters'
  );
  return (datos.suggestions || []).
  filter((s) => s.placePrediction?.placeId && s.placePrediction?.text?.text).
  map(({ placePrediction: p }) => {
    const direccion = p.text.text.replace(/,\s*Bolivia\s*$/i, '').trim();
    const [principalTexto, ...rest] = direccion.split(',');
    return {
      placeId: p.placeId,
      address: direccion,
      mainText: principalTexto.trim(),
      secondaryText: rest.join(',').trim(),
      sessionToken: sesionToken,
      ...(Number.isFinite(p.distanceMeters) ?
      { distanceMeters: p.distanceMeters } :
      {})
    };
  }).
  sort((primero, segundo) =>
  latitud === undefined ?
  0 :
  (primero.distanceMeters ?? Infinity) - (segundo.distanceMeters ?? Infinity)
  );
}
async function detalles({ placeId: lugarId, sessionToken: sesionToken }) {
  validarSesion(sesionToken);
  if (typeof lugarId !== 'string' || !/^[\w-]{1,255}$/.test(lugarId))
  throw fallar(400, 'Lugar inválido.');
  const consulta = new URLSearchParams({ sessionToken: sesionToken, languageCode: 'es' });
  const datos = await googleSolicitud(
    `places/${encodeURIComponent(lugarId)}?${consulta}`,
    { method: 'GET' },
    'id,formattedAddress,location'
  );
  if (
  !Number.isFinite(datos.location?.latitude) ||
  !Number.isFinite(datos.location?.longitude) ||
  !datos.formattedAddress)
  {
    throw fallar(502, 'El lugar seleccionado no tiene una ubicación válida.');
  }
  return {
    placeId: datos.id,
    address: datos.formattedAddress,
    display_name: datos.formattedAddress,
    lat: String(datos.location.latitude),
    lon: String(datos.location.longitude)
  };
}
module.exports = { autocompletar, detalles: detalles };
