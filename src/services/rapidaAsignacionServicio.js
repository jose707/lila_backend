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
  RESERVA_SEGUNDOS,
  RESPUESTA_CONDUCTOR_SEGUNDOS,
  UBICACION_MAXIMO_ANTIGUEDAD_SEGUNDOS: UBICACION_MAXIMO_ANTIGUEDAD_SEGUNDOS,
  ACTIVO_ESTADOS: ACTIVO_ESTADOS,
  fallar: fallar,
  validarPunto: validarPunto
} = require("./rapidaAsignacionPolicy");

const consultarIntentos = (sql, replacements, transaction) =>
  sequelize.query(sql, { replacements, transaction, esquemaFisico: true });

async function publicar(viaje, anteriorId) {
  const conductores = await Conductor.findAll({
    where: { id: [viaje.driverId, anteriorId].filter(Boolean) }, attributes: ['userId']
  });
  const contenido = { rideId: viaje.id, status: viaje.status, expiresAt: viaje.expiresAt };
  const io = obtenerIo();
  io.to('user:' + viaje.passengerId).emit('ride:assignment', contenido);
  for (const conductor of conductores) io.to('user:' + conductor.userId).emit('ride:assignment', contenido);
  io.to('ride:' + viaje.id).emit('ride:status:changed', contenido);
}

async function ofrecerSiguiente(viaje, transaccion) {
  const [historial] = await consultarIntentos(
    'SELECT id_conductor FROM public.asignacion_rapida_intento WHERE id_viaje = :id',
    { id: viaje.id }, transaccion);
  const omitidos = historial.map(intento => intento.id_conductor);
  const [candidatos] = await sequelize.query(
      `SELECT d.id, ST_Y(dl.location) AS latitude, ST_X(dl.location) AS longitude
      FROM conductor d JOIN ubicacion_conductor dl ON dl.driver_id = d.id
      WHERE EXISTS (SELECT 1 FROM usuario u WHERE u.id = d.user_id AND u.is_active = true) AND d.status = 'aprobado' AND d.deleted_at IS NULL AND d.user_id <> :passengerId
        AND d.id NOT IN (:omitidos) AND dl.is_online = true AND dl.location_recorded_at > clock_timestamp() - make_interval(secs => :maxAge)
        AND EXISTS (SELECT 1 FROM vehiculo v WHERE v.driver_id = d.id AND v.status = 'activo'
          AND v.deleted_at IS NULL AND v.vehicle_type = :vehicleType)
        AND NOT EXISTS (SELECT 1 FROM viaje r WHERE r.driver_id = d.id AND r.deleted_at IS NULL AND
          (r.status IN ('aceptado','llegado','en_curso') OR (r.request_mode = 'asignacion_rapida' AND r.status = 'solicitado')))
        AND ST_DWithin(dl.location::geography, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography, :radius)
      ORDER BY ST_Distance(dl.location::geography, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography), d.id
      LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
      {
        replacements: {
          passengerId: viaje.passengerId,
          omitidos: omitidos.length ? omitidos : ["00000000-0000-0000-0000-000000000000"],
          maxAge: UBICACION_MAXIMO_ANTIGUEDAD_SEGUNDOS,
          vehicleType: viaje.vehicle_type_requested,
          lng: viaje.pickupLocation.coordinates[0],
          lat: viaje.pickupLocation.coordinates[1],
          radius: RADIO_METROS
        },
        transaction: transaccion
      }
    );

  const conductor = candidatos[0];
  if (!conductor) return;
  const recogida = await trazado.conduccionRuta([conductor, {
    latitude: viaje.pickupLocation.coordinates[1], longitude: viaje.pickupLocation.coordinates[0]
  }]);
  const [[{ ahora }]] = await sequelize.query('SELECT clock_timestamp() AS ahora', { transaction: transaccion });
  const vence = new Date(Math.min(new Date(ahora).getTime() + RESPUESTA_CONDUCTOR_SEGUNDOS * 1000,
    new Date(viaje.expiresAt).getTime()));
  if (vence.getTime() <= new Date(ahora).getTime()) return;
  await viaje.update({ driverId: conductor.id, pickupDistance: recogida.distance, pickupDuration: recogida.duration },
    { transaction: transaccion });
  await consultarIntentos(
    "INSERT INTO public.asignacion_rapida_intento(id_viaje,id_conductor,estado,vence_en) VALUES(:id,:conductor,'pendiente',:vence)",
    { id: viaje.id, conductor: conductor.id, vence }, transaccion);
  await sequelize.query("UPDATE oferta_viaje SET status = 'vencido' WHERE driver_id = :id AND status = 'pendiente'",
    { replacements: { id: conductor.id }, transaction: transaccion });
}

async function avanzarBusqueda(id, usuarioId, aceptar) {
  let anteriorId;
  let cambiado = false;
  const viaje = await sequelize.transaction(async transaccion => {
    const actual = await Viaje.findByPk(id, { transaction: transaccion, lock: transaccion.LOCK.UPDATE });
    if (!actual || actual.requestMode !== 'asignacion_rapida') throw fallar(404, 'Solicitud no encontrada.');
    if (usuarioId) {
      const conductor = await Conductor.findOne({ where: { userId: usuarioId }, transaction: transaccion });
      if (!conductor || conductor.id !== actual.driverId) {
        throw fallar(409, 'Esta solicitud ya no está disponible para ti.', 'OFFER_EXPIRED');
      }
    }
    if (actual.status !== 'solicitado') return actual;
    anteriorId = actual.driverId;
    const [[{ ahora }]] = await sequelize.query('SELECT clock_timestamp() AS ahora', { transaction: transaccion });
    const [intentos] = await consultarIntentos(
      "SELECT * FROM public.asignacion_rapida_intento WHERE id_viaje = :id AND id_conductor = :conductor AND estado = 'pendiente'",
      { id, conductor: actual.driverId }, transaccion);
    const intento = intentos[0];
    const vencido = new Date(actual.expiresAt).getTime() <= new Date(ahora).getTime();
    const ofertaVencida = !intento || new Date(intento.vence_en).getTime() <= new Date(ahora).getTime();
    if (vencido || ofertaVencida || usuarioId) {
      let estado = 'vencido';
      if (!vencido && !ofertaVencida && usuarioId) estado = aceptar ? 'aceptado' : 'rechazado';
      if (estado === 'aceptado') {
        const [disponibles] = await sequelize.query(
          `SELECT d.id FROM conductor d JOIN usuario u ON u.id = d.user_id JOIN ubicacion_conductor l ON l.driver_id = d.id WHERE d.id = :id AND d.status = 'aprobado' AND u.is_active = true AND d.deleted_at IS NULL AND l.is_online = true AND l.location_recorded_at > clock_timestamp() - make_interval(secs => :maxAge)
 AND ST_DWithin(l.location::geography,ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography,:radius)
 AND EXISTS(SELECT 1 FROM vehiculo v WHERE v.driver_id=d.id AND v.status='activo' AND v.deleted_at IS NULL AND v.vehicle_type=:vehicleType)
 AND clock_timestamp() < :vence`,
          { replacements: { id: actual.driverId, maxAge: UBICACION_MAXIMO_ANTIGUEDAD_SEGUNDOS, lng: actual.pickupLocation.coordinates[0], lat: actual.pickupLocation.coordinates[1], radius: RADIO_METROS, vehicleType: actual.vehicle_type_requested, vence: intento.vence_en }, transaction: transaccion });
        if (!disponibles.length) estado = 'vencido';
      }
      await consultarIntentos(
        "UPDATE public.asignacion_rapida_intento SET estado = :estado WHERE id_viaje = :id AND estado = 'pendiente'",
        { estado, id }, transaccion);
      if (estado === 'aceptado') {
        await actual.update({ status: 'aceptado', acceptedAt: ahora }, { transaction: transaccion });
      } else {
        await actual.update({ driverId: null, pickupDistance: null, pickupDuration: null,
          ...(vencido ? { status: 'vencido' } : {}) }, { transaction: transaccion });
      }
      cambiado = Boolean(anteriorId) || vencido;
    }
    if (actual.status === 'solicitado' && !actual.driverId) {
      await ofrecerSiguiente(actual, transaccion);
      cambiado = cambiado || Boolean(actual.driverId);
    }
    return actual;
  });
  if (cambiado) await publicar(viaje, anteriorId).catch(error => console.warn('Asignación rápida:', error.message));
  return viaje;
}

let sincronizando;
function vencerReservas() {
  if (!sincronizando) {
    sincronizando = (async () => {
      const pendientes = await Viaje.findAll({
        where: { requestMode: 'asignacion_rapida', status: 'solicitado' }, attributes: ['id']
      });
      for (const viaje of pendientes) {
        await avanzarBusqueda(viaje.id).catch(error => console.warn('Búsqueda de conductor:', error.message));
      }
    })().finally(() => { sincronizando = null; });
  }
  return sincronizando;
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
    const trip = await trazado.conduccionRuta([
    recogidaUbicacion,
    ...paradas,
    destinoUbicacion]
    );
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
        driverId: null,
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
        pickupDistance: null,
        pickupDuration: null,
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
    await ofrecerSiguiente(reservado, transaccion);
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

async function cancelarReserva(usuarioId, id) {
  const viaje = await sequelize.transaction(async transaccion => {
    const actual = await Viaje.findByPk(id, { transaction: transaccion, lock: transaccion.LOCK.UPDATE });
    if (!actual || actual.requestMode !== 'asignacion_rapida') throw fallar(404, 'Solicitud no encontrada.');
    if (actual.passengerId !== usuarioId) throw fallar(403, 'Este viaje no te pertenece.');
    if (actual.status !== 'solicitado') return actual;
    await consultarIntentos(
      "UPDATE public.asignacion_rapida_intento SET estado = 'cancelado' WHERE id_viaje = :id AND estado = 'pendiente'",
      { id }, transaccion);
    return actual.update({ status: 'cancelado', cancelledBy: 'pasajero', cancelledAt: new Date() },
      { transaction: transaccion });
  });
  await publicar(viaje).catch(error => console.warn('Asignación rápida:', error.message));
  return viaje;
}

async function reservar(pasajeroId, entrada, progreso = () => {}) {
  for (let intento = 0; ; intento++) {
    try {
      return await reservarUnaVez(pasajeroId, entrada, progreso);
    } catch (error) {
      if (intento >= 2 || error.original?.constraint !== 'viaje_conductor_ocupado_unico') throw error;
    }
  }
}
module.exports = {
  responderConductor: avanzarBusqueda,
  reservar: reservar,
  actual: real,
  obtener: obtener,
  cancelarReserva,
  vencerReservas: vencerReservas
};
