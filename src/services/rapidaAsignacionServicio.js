'use strict';
const { Op: Operador } = require('sequelize');
const sequelize = require("../config/baseDatos");
const Viaje = require("../models/Viaje");
const Conductor = require("../models/Conductor");
const Usuario = require("../models/Usuario");
const ViajeParada = require("../models/ViajeParada");
const { obtenerIo: obtenerIo } = require('../socket');
const trazado = require("./asignacionRouting");
const {
  RADIO_METROS: RADIO_METROS,
  RESERVA_SEGUNDOS: RESERVA_SEGUNDOS,
  UBICACION_MAXIMO_ANTIGUEDAD_SEGUNDOS: UBICACION_MAXIMO_ANTIGUEDAD_SEGUNDOS,
  ACTIVO_ESTADOS: ACTIVO_ESTADOS,
  fallar: fallar,
  validarPunto: validarPunto
} = require("./rapidaAsignacionPolicy");

async function publicar(viaje) {
  const conductor = await Conductor.findByPk(viaje.driverId);
  const contenido = {
    rideId: viaje.id,
    status: viaje.status,
    expiresAt: viaje.expiresAt
  };
  const io = obtenerIo();
  io.to(`user:${viaje.passengerId}`).emit('ride:assignment', contenido);
  if (conductor) io.to(`user:${conductor.userId}`).emit('ride:assignment', contenido);
  io.to(`ride:${viaje.id}`).emit('ride:status:changed', contenido);
}

async function vencerReservas() {
  const [filas] =
  await sequelize.query(`UPDATE viaje SET status = 'vencido', updated_at = NOW()
    WHERE request_mode = 'asignacion_rapida' AND status = 'solicitado' AND expires_at <= clock_timestamp()
    RETURNING id, passenger_id AS "passengerId", driver_id AS "driverId", status, expires_at AS "expiresAt"`);
  await Promise.allSettled(filas.map(publicar));
}

async function reservarUnaVez(pasajeroId, entrada, progreso) {
  const {
    pickupLocation: recogidaUbicacion,
    dropoffLocation: destinoUbicacion,
    vehicleTypeRequested: vehiculoTipoSolicitado,
    paymentMethod: pagoMetodo = 'efectivo',
    requestKey: solicitudClave
  } = entrada;
  const paradas = entrada.waypoints ?? [];
  if (
  !validarPunto(recogidaUbicacion) ||
  !validarPunto(destinoUbicacion) ||
  !Array.isArray(paradas) ||
  paradas.length > 8 ||
  !paradas.every(validarPunto) ||
  !['taxi', 'minibus', 'bus', 'motocicleta'].includes(vehiculoTipoSolicitado) ||
  !['efectivo', 'qr'].includes(pagoMetodo) ||
  typeof solicitudClave !== 'string' ||
  !/^[a-zA-Z0-9_-]{16,100}$/.test(solicitudClave))
  {
    throw fallar(
      400,
      'Revisa origen, destino, vehículo, pago e identificador de solicitud.'
    );
  }
  await vencerReservas();
  // Bloquea la fila del pasajero para procesar uno a uno los reintentos y las solicitudes simultáneas de varios dispositivos.
  const viaje = await sequelize.transaction(async (transaccion) => {
    await Usuario.findByPk(pasajeroId, {
      transaction: transaccion,
      lock: transaccion.LOCK.UPDATE
    });
    const anterior = await Viaje.findOne({
      where: { passengerId: pasajeroId, requestKey: solicitudClave },
      transaction: transaccion
    });
    if (anterior) return anterior;
    const activo = await Viaje.findOne({
      where: {
        passengerId: pasajeroId,
        [Operador.or]: [
        { status: { [Operador.in]: ACTIVO_ESTADOS } },
        {
          status: { [Operador.in]: ['solicitado', 'ofertado'] },
          expiresAt: { [Operador.gt]: new Date() }
        }]

      },
      transaction: transaccion
    });
    if (activo) {
      if (activo.requestMode === 'asignacion_rapida') return activo;
      throw fallar(409, 'Ya tienes un viaje o solicitud activa.', 'ACTIVE_RIDE');
    }
    const [[zona]] = await sequelize.query(
      `SELECT * FROM get_service_area(ST_SetSRID(ST_MakePoint(:lng,:lat),4326))`,
      {
        replacements: {
          lng: recogidaUbicacion.longitude,
          lat: recogidaUbicacion.latitude
        },
        transaction: transaccion
      }
    );
    if (!zona) {
      const [[{ count: cantidad }]] = await sequelize.query(
        "SELECT COUNT(*) AS count FROM zona_servicio WHERE is_active = true",
        { transaction: transaccion }
      );
      if (Number(cantidad))
      throw fallar(
        422,
        'El punto de recogida está fuera de cobertura.',
        'OUT_OF_SERVICE_AREA'
      );
    }
    progreso('locating');
    const [candidatos] = await sequelize.query(
      `SELECT d.id, ST_Y(dl.location) AS latitude, ST_X(dl.location) AS longitude
      FROM conductor d JOIN ubicacion_conductor dl ON dl.driver_id = d.id
      WHERE d.status = 'aprobado' AND d.deleted_at IS NULL AND d.user_id <> :passengerId
        AND dl.is_online = true AND dl.location_recorded_at > clock_timestamp() - make_interval(secs => :maxAge)
        AND EXISTS (SELECT 1 FROM vehiculo v WHERE v.driver_id = d.id AND v.status = 'activo'
          AND v.deleted_at IS NULL AND v.vehicle_type = :vehicleType)
        AND NOT EXISTS (SELECT 1 FROM viaje r WHERE r.driver_id = d.id AND r.deleted_at IS NULL AND
          (r.status IN ('aceptado','llegado','en_curso') OR (r.request_mode = 'asignacion_rapida' AND r.status = 'solicitado')))
        AND ST_DWithin(dl.location::geography, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography, :radius)
      ORDER BY ST_Distance(dl.location::geography, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography), d.id
      LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
      {
        replacements: {
          passengerId: pasajeroId,
          maxAge: UBICACION_MAXIMO_ANTIGUEDAD_SEGUNDOS,
          vehicleType: vehiculoTipoSolicitado,
          lng: recogidaUbicacion.longitude,
          lat: recogidaUbicacion.latitude,
          radius: RADIO_METROS
        },
        transaction: transaccion
      }
    );
    const candidato = candidatos[0];
    if (!candidato)
    throw fallar(
      409,
      'No hay conductores disponibles dentro de 3 km.',
      'NO_DRIVERS'
    );
    progreso('assigning');
    const trip = await trazado.conduccionRuta([
    recogidaUbicacion,
    ...paradas,
    destinoUbicacion]
    );
    const recogida = await trazado.conduccionRuta([candidato, recogidaUbicacion]);
    const baseTarifa = Number(zona?.base_fare ?? 12);
    const tarifaPorKm = Number(zona?.fare_per_km ?? 0.5);
    const tarifaPorMinuto = Number(zona?.fare_per_minute ?? 0.58);
    const totalTarifa = Math.round(
      baseTarifa +
      trip.distance / 1000 * tarifaPorKm +
      Math.ceil(trip.duration / 60) * tarifaPorMinuto
    );
    const [[{ now: ahora }]] = await sequelize.query(
      "SELECT clock_timestamp() AS now",
      { transaction: transaccion }
    );
    const punto = (valor) => ({
      type: 'Point',
      coordinates: [valor.longitude, valor.latitude]
    });
    const reservado = await Viaje.create(
      {
        passengerId: pasajeroId,
        driverId: candidato.id,
        requestMode: 'asignacion_rapida',
        requestKey: solicitudClave,
        pickupLocation: punto(recogidaUbicacion),
        pickup_address: recogidaUbicacion.address,
        dropoffLocation: punto(destinoUbicacion),
        dropoff_address: destinoUbicacion.address,
        vehicle_type_requested: vehiculoTipoSolicitado,
        paymentMethod: pagoMetodo,
        distance: trip.distance,
        duration: trip.duration,
        baseFare: baseTarifa,
        farePerKm: tarifaPorKm,
        farePerMinute: tarifaPorMinuto,
        totalFare: totalTarifa,
        finalFare: totalTarifa,
        pickupDistance: recogida.distance,
        pickupDuration: recogida.duration,
        service_area_id: zona?.id ?? null,
        status: 'solicitado',
        expiresAt: new Date(
          new Date(ahora).getTime() + RESERVA_SEGUNDOS * 1000
        )
      },
      { transaction: transaccion }
    );
    if (paradas.length)
    await ViajeParada.bulkCreate(
      paradas.map((parada, indice) => ({
        ride_id: reservado.id,
        sequence: indice + 1,
        location: punto(parada),
        address: parada.address
      })),
      { transaction: transaccion }
    );
    // Old negotiation offers must no longer be selectable while this driver is reserved.
    await sequelize.query(
      `UPDATE oferta_viaje SET status = 'vencido' WHERE driver_id = :id AND status = 'pendiente'`,
      {
        replacements: { id: candidato.id },
        transaction: transaccion
      }
    );
    return reservado;
  });
  await publicar(viaje).catch((error) =>
  console.warn('Assignment notification:', error.message)
  );
  return viaje;
}

async function real(usuarioId, comoConductor = false) {
  await vencerReservas();
  const conductor = comoConductor ? await Conductor.findOne({ where: { userId: usuarioId } }) : null;
  if (comoConductor && !conductor) return null;
  return Viaje.findOne({
    where: {
      ...(comoConductor ? { driverId: conductor.id } : { passengerId: usuarioId }),
      requestMode: 'asignacion_rapida',
      status: { [Operador.in]: ['solicitado', ...ACTIVO_ESTADOS] }
    },
    order: [['createdAt', 'DESC']]
  });
}

async function obtener(usuarioId, id) {
  await vencerReservas();
  const viaje = await Viaje.findByPk(id);
  if (!viaje || viaje.requestMode !== 'asignacion_rapida')
  throw fallar(404, 'Reserva no encontrada.');
  if (viaje.passengerId !== usuarioId) {
    const conductor = await Conductor.findOne({ where: { userId: usuarioId } });
    if (!conductor || conductor.id !== viaje.driverId)
    throw fallar(403, 'Este viaje no te pertenece.');
  }
  return viaje;
}

async function finalizarReserva(pasajeroId, id, confirmar) {
  let newlyAssigned = false;
  const viaje = await sequelize.transaction(async (transaccion) => {
    const reservado = await Viaje.findByPk(id, {
      transaction: transaccion,
      lock: transaccion.LOCK.UPDATE
    });
    if (!reservado || reservado.requestMode !== 'asignacion_rapida')
    throw fallar(404, 'Reserva no encontrada.');
    if (reservado.passengerId !== pasajeroId)
    throw fallar(403, 'Este viaje no te pertenece.');
    if (reservado.status !== 'solicitado') return reservado; // Idempotent, never revive terminal states.
    const [[{ valid: valido }]] = await sequelize.query(
      "SELECT :expires::timestamptz > clock_timestamp() AS valid",
      {
        replacements: { expires: reservado.expiresAt },
        transaction: transaccion
      }
    );
    let estado = !valido ? 'vencido' : confirmar ? 'aceptado' : 'cancelado';
    if (estado === 'aceptado') {
      const [disponible] = await sequelize.query(
        `SELECT d.id FROM conductor d JOIN ubicacion_conductor dl ON dl.driver_id = d.id
        WHERE d.id = :id AND d.status = 'aprobado' AND d.deleted_at IS NULL AND dl.is_online = true
          AND dl.location_recorded_at > clock_timestamp() - make_interval(secs => :maxAge)
          AND ST_DWithin(dl.location::geography, (SELECT pickup_location::geography FROM viaje WHERE id = :rideId), :radius)
          AND EXISTS (SELECT 1 FROM vehiculo v WHERE v.driver_id = d.id AND v.status = 'activo'
            AND v.deleted_at IS NULL AND v.vehicle_type = :vehicleType)`,
        {
          replacements: {
            id: reservado.driverId,
            maxAge: UBICACION_MAXIMO_ANTIGUEDAD_SEGUNDOS,
            radius: RADIO_METROS,
            rideId: reservado.id,
            vehicleType: reservado.vehicle_type_requested
          },
          transaction: transaccion
        }
      );
      if (!disponible.length) estado = 'vencido';
    }
    newlyAssigned = estado === 'aceptado';
    return reservado.update(
      {
        status: estado,
        ...(newlyAssigned ?
        { acceptedAt: sequelize.literal('clock_timestamp()') } :
        {}),
        ...(estado === 'cancelado' ?
        { cancelledBy: 'pasajero', cancelledAt: new Date() } :
        {})
      },
      { transaction: transaccion }
    );
  });
  await publicar(viaje).catch((error) =>
  console.warn('Assignment notification:', error.message)
  );
  if (newlyAssigned) {
    const { notificar: notificar } = require("./notificacionServicio");
    const conductor = await Conductor.findByPk(viaje.driverId);
    if (conductor)
    notificar({
      userId: conductor.userId,
      type: 'viaje_aceptado',
      title: 'Tienes un viaje asignado',
      body: 'El pasajero confirmó. Dirígete al punto de recogida.',
      data: { ride_id: viaje.id }
    });
  }
  return viaje;
}

async function reservar(
pasajeroId,
entrada,
progreso = () => {},
{ searchWindowMs: buscarWindowMilisegundos = 5000, searchIntervalMs: buscarIntervaloMilisegundos = 500 } = {})
{
  const plazo = Date.now() + buscarWindowMilisegundos;
  let ocupadoConductorReintentos = 0;
  for (;;) {
    try {
      return await reservarUnaVez(pasajeroId, entrada, progreso);
    } catch (error) {
      if (error.code === 'NO_DRIVERS') {
        const restante = plazo - Date.now();
        if (restante <= 0) throw error;
        // Each failed attempt rolls back before waiting, so no database lock is held.
        await new Promise((resolver) =>
        setTimeout(resolver, Math.min(buscarIntervaloMilisegundos, restante))
        );
        continue;
      }
      // A legacy acceptance can win between candidate selection and insertion.
      // Roll back and select again; the unique database index is the final arbiter.
      if (
      ocupadoConductorReintentos++ >= 2 ||
      error.original?.constraint !== 'viaje_conductor_ocupado_unico')

      throw error;
    }
  }
}
module.exports = {
  reservar: reservar,
  actual: real,
  obtener: obtener,
  finalizarReserva: finalizarReserva,
  vencerReservas: vencerReservas
};
