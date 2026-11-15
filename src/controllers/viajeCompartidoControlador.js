'use strict';

const { createHmac } = require('node:crypto');
const jwt = require('jsonwebtoken');
const Viaje = require('../models/Viaje');
const Conductor = require('../models/Conductor');
const ConductorUbicacion = require('../models/ConductorUbicacion');
const { almacenamientoClave } = require('../services/identidadSessionCrypto');

const audiencia = 'linealila-viaje-compartido';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function clave() {
  const secretoSesion = process.env.JWT_SECRET;
  // Derivar una clave exclusiva para los enlaces incluso en el entorno local sin JWT_SECRET.
  const secreto = secretoSesion?.length >= 32 ? secretoSesion : almacenamientoClave();
  return createHmac('sha256', secreto).update(audiencia).digest();
}

async function crearEnlace(solicitud, respuesta) {
  respuesta.set('Cache-Control', 'private, no-store');
  const { rideId } = solicitud.params;
  if (!uuid.test(rideId)) return respuesta.status(404).json({ error: 'Viaje no encontrado.' });
  try {
    const viaje = await Viaje.findByPk(rideId);
    const conductor = viaje?.driverId && viaje.passengerId !== solicitud.user.id
      ? await Conductor.findByPk(viaje.driverId, { attributes: ['userId'] }) : null;
    if (!viaje || (viaje.passengerId !== solicitud.user.id && conductor?.userId !== solicitud.user.id)) {
      return respuesta.status(404).json({ error: 'Viaje no encontrado.' });
    }
    if (viaje.status !== 'en_curso' || !viaje.driverId) {
      return respuesta.status(409).json({ error: 'Solo puedes compartir un viaje en curso.' });
    }
    const token = jwt.sign({ conductor: viaje.driverId }, clave(), {
      subject: viaje.id, audience: audiencia, expiresIn: '12h', algorithm: 'HS256'
    });
    return respuesta.json({ ruta: `/viaje-compartido/#${token}` });
  } catch (error) {
    console.error('Error al crear enlace de viaje:', error.name);
    return respuesta.status(503).json({ error: 'No se pudo generar el enlace. Intenta de nuevo.' });
  }
}

async function consultarUbicacion(solicitud, respuesta) {
  respuesta.set('Cache-Control', 'private, no-store');
  const token = solicitud.body?.token;
  let permiso;
  try {
    if (typeof token !== 'string' || token.length > 1024) return respuesta.sendStatus(404);
    permiso = jwt.verify(token, clave(), { audience: audiencia, algorithms: ['HS256'] });
    if (!uuid.test(permiso.sub) || !uuid.test(permiso.conductor)) return respuesta.sendStatus(404);
  } catch {
    return respuesta.sendStatus(404);
  }

  try {
    const ubicacion = await ConductorUbicacion.findByPk(permiso.conductor, {
      attributes: ['location', 'location_recorded_at']
    });
    const viaje = await Viaje.findByPk(permiso.sub, {
      attributes: ['id', 'status', 'driverId', 'startedAt'],
      include: [
        { association: 'passenger', attributes: ['id'],
          include: [{ association: 'identity', attributes: ['firstNames'] }] },
        { association: 'driver', attributes: ['id', 'userId'], include: [
          { association: 'user', attributes: ['id'],
            include: [{ association: 'identity', attributes: ['firstNames'] }] },
          { association: 'vehicles', attributes: ['brand', 'model', 'color', 'plate'],
            where: { status: 'activo' }, limit: 1 }
        ] }
      ]
    });
    if (viaje?.status !== 'en_curso' || viaje.driverId !== permiso.conductor) return respuesta.sendStatus(410);
    const [longitud, latitud] = ubicacion?.location?.coordinates ?? [];
    const registrada = new Date(ubicacion?.location_recorded_at).getTime();
    const inicio = new Date(viaje.startedAt).getTime();
    const reciente = [latitud, longitud, registrada].every(Number.isFinite) &&
      Math.abs(latitud) <= 90 && Math.abs(longitud) <= 180 && Date.now() - registrada <= 60000 && registrada >= inicio;
    const vehiculo = viaje.driver?.vehicles?.[0];
    return respuesta.json({
      ubicacion: reciente ? { latitud, longitud, registrada } : null,
      detalles: {
        pasajero: viaje.passenger?.identity?.firstNames?.trim() || null,
        conductor: viaje.driver?.user?.identity?.firstNames?.trim() || null,
        vehiculo: vehiculo ? {
          marca: vehiculo.brand, modelo: vehiculo.model, color: vehiculo.color, placa: vehiculo.plate
        } : null
      }
    });
  } catch (error) {
    console.error('Error al consultar viaje compartido:', error.name);
    return respuesta.sendStatus(503);
  }
}

module.exports = { crearEnlace, consultarUbicacion };
