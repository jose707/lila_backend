// backend/src/controllers/viajeControlador.js

/**

 * @param {string} id - driverId (para role='conductor') o passengerId (para role='pasajero')
 * @param {'pasajero'|'conductor'} role
 * @returns {Promise<number>}
 */
async function calcularCalificacion(id, rol) {
  if (!id) return 5;
  try {
    const { sequelize: sequelize } = require('../models');

    const raterTipo = rol === 'conductor' ? 'pasajero' : 'conductor';
    const idColumna = rol === 'conductor' ? 'driver_id' : 'passenger_id';

    const [filas] = await sequelize.query(
      `SELECT c.rating FROM calificacion c JOIN viaje v ON v.id = c.ride_id WHERE v.${idColumna} = :id AND c.rater_type = :raterType`,
      { replacements: { id, raterType: raterTipo } }
    );

    const lista = Array.isArray(filas) ? filas : filas ? [filas] : [];

    const semillaCalificacion = 5;
    const total = lista.length + 1;
    const suma = lista.reduce(
      (acumulador, r) => acumulador + (parseFloat(r.rating) || 0),
      semillaCalificacion
    );
    return Math.round(suma / total * 10) / 10;
  } catch {
    return 5;
  }
}

const Viaje = require("../models/Viaje");
const Usuario = require("../models/Usuario");
const UsuarioIdentidad = require('../models/UsuarioIdentidad');
const Conductor = require("../models/Conductor");
const CobrosConductor = require("../models/CobrosConductor");
const ViajeParada = require("../models/ViajeParada");
const ViajeOferta = require("../models/ViajeOferta");
const { Op: Operador } = require('sequelize');
const { sequelize: sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { obtenerIo: obtenerIo } = require('../socket');

const nombreParticipante = (identidad) =>
  [identidad?.firstNames, identidad?.paternalSurname, identidad?.maternalSurname]
    .map(parte => parte?.trim()).filter(Boolean).join(' ');

const identidadConNombre = {
  association: 'identity',
  attributes: ['firstNames', 'paternalSurname', 'maternalSurname'],
  required: false
};

const crearViaje = async (solicitud, respuesta) => {
  if (solicitud.body.requestMode === 'asignacion_rapida') {
    return require("./rapidaAsignacionControlador").reservar(solicitud, respuesta);
  }
  if (solicitud.body.requestMode && solicitud.body.requestMode !== 'negociacion') {
    return respuesta.status(400).json({ error: 'Modo de solicitud inválido.' });
  }
  try {
    const realRapido = await require("../services/rapidaAsignacionServicio").actual(solicitud.user.id);
    if (realRapido) return respuesta.status(409).json({ error: 'Ya tienes una reserva o viaje activo.' });
    const {
      pickupLocation: recogidaUbicacion,
      dropoffLocation: destinoUbicacion,
      waypoints: paradas,
      distance: distancia,
      duration: duracion,
      fare: tarifa,
      vehicleTypeRequested: vehiculoTipoSolicitado,
      paymentMethod: pagoMetodo
    } = solicitud.body;
    const pasajeroId = solicitud.user.id;

    // Cancelar cualquier solicitud activa previa del pasajero
    const activoViajes = await Viaje.findAll({
      where: { passengerId: pasajeroId, status: ['solicitado', 'ofertado'] }
    });
    for (const activo of activoViajes) {
      await activo.update({
        status: 'cancelado',
        cancelledAt: new Date(),
        cancelledBy: 'pasajero',
        cancelReason: 'Nueva solicitud creada'
      });
    }

    // ── Validar coordenadas ────────────────────────────────────────────
    if (
    !recogidaUbicacion?.latitude ||
    !recogidaUbicacion?.longitude ||
    !recogidaUbicacion?.address)
    {
      return respuesta.status(400).json({
        error:
        'pickupLocation inválida. Debe tener latitude, longitude y address'
      });
    }
    if (
    !destinoUbicacion?.latitude ||
    !destinoUbicacion?.longitude ||
    !destinoUbicacion?.address)
    {
      return respuesta.status(400).json({
        error:
        'dropoffLocation inválida. Debe tener latitude, longitude y address'
      });
    }
    if (!distancia || !duracion) {
      return respuesta.
      status(400).
      json({ error: 'Faltan datos requeridos: distance, duration' });
    }

    // ── Validar waypoints (paradas intermedias) ────────────────────────
    let paradasValidadas = [];
    if (paradas && Array.isArray(paradas) && paradas.length > 0) {
      for (let indice = 0; indice < paradas.length; indice++) {
        const parada = paradas[indice];
        if (!parada?.latitude || !parada?.longitude || !parada?.address) {
          return respuesta.status(400).json({
            error: `waypoint[${indice}] inválido. Debe tener latitude, longitude y address`
          });
        }
      }
      paradasValidadas = paradas;
    }

    const finalDistancia = parseFloat(distancia);
    const finalDuracion = Math.round(parseFloat(duracion));
    const recogidaLongitud = parseFloat(recogidaUbicacion.longitude);
    const recogidaLatitud = parseFloat(recogidaUbicacion.latitude);

    // ── Validar zona de servicio ──────────────────────────────────────
    // Una sola query PostGIS: get_service_area devuelve la zona si el punto
    // está dentro, o NULL si está fuera. Esto reemplaza las dos queries
    // anteriores (is_location_serviceable + get_service_area) por una sola,
    // reduciendo a la mitad los round-trips a la BD en cada creación de viaje.
    let servicioZona = null;

    try {
      const [[zona]] = await sequelize.query(
        `SELECT * FROM get_service_area(ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))`,
        { replacements: { lng: recogidaLongitud, lat: recogidaLatitud } }
      );
      servicioZona = zona ?? null;

      if (!servicioZona) {
        // NULL = punto fuera de todas las zonas activas.
        // Solo rechazar si hay zonas configuradas; si no hay ninguna,
        // es operación abierta y se usan tarifas por defecto.
        const [[{ count: cantidad }]] = await sequelize.query(
          `SELECT COUNT(*) AS count FROM zona_servicio WHERE is_active = true`
        );
        if (parseInt(cantidad, 10) > 0) {
          return respuesta.status(422).json({
            error:
            'Lo sentimos, el punto de recogida está fuera de nuestras zonas de cobertura.',
            code: 'OUT_OF_SERVICE_AREA'
          });
        }
        // Sin zonas configuradas → continuar con tarifas por defecto
      }
    } catch (zoneError) {
      // PostGIS no disponible o tablas no configuradas → usar tarifas por defecto
      console.warn(
        '⚠️ [crearViaje] Consulta de zona omitida (PostGIS no disponible o sin zonas):',
        zoneError.message
      );
    }

    // Usar tarifas de la zona o fallback a valores por defecto
    const baseTarifa = servicioZona?.base_fare ?? 12;
    const tarifaPorKm = servicioZona?.fare_per_km ?? 0.5;
    const tarifaPorMinuto = servicioZona?.fare_per_minute ?? 0.58;
    const servicioZonaId = servicioZona?.id ?? null;

    // ── Calcular tarifa total ─────────────────────────────────────────
    let totalTarifa = tarifa;

    if (totalTarifa == null) {
      const distanciaKm = finalDistancia / 1000;
      const distanciaMinimo = Math.ceil(finalDuracion / 60);

      totalTarifa = baseTarifa + distanciaKm * tarifaPorKm + distanciaMinimo * tarifaPorMinuto;

      totalTarifa = Math.round(totalTarifa); // opcional
    }

    const finalTarifa = Math.max(0, Math.round(totalTarifa * 100) / 100);

    // ── Crear el viaje ────────────────────────────────────────────────
    const viaje = await Viaje.create({
      passengerId: pasajeroId,
      pickupLocation: {
        type: 'Point',
        coordinates: [recogidaLongitud, recogidaLatitud]
      },
      pickup_address: recogidaUbicacion.address,
      dropoffLocation: {
        type: 'Point',
        coordinates: [
        parseFloat(destinoUbicacion.longitude),
        parseFloat(destinoUbicacion.latitude)]

      },
      dropoff_address: destinoUbicacion.address,
      vehicle_type_requested: vehiculoTipoSolicitado ?? null,
      paymentMethod: pagoMetodo || 'efectivo',
      distance: finalDistancia,
      duration: finalDuracion,
      baseFare: baseTarifa,
      farePerKm: tarifaPorKm,
      farePerMinute: tarifaPorMinuto,
      totalFare: totalTarifa,
      finalFare: finalTarifa,
      service_area_id: servicioZonaId,
      status: 'solicitado',
      expiresAt: new Date(Date.now() + 2 * 60 * 1000)
    });

    // ── Persistir waypoints (paradas intermedias) ─────────────────────
    if (paradasValidadas.length > 0) {
      const registrosParadas = paradasValidadas.map((parada, indice) => ({
        ride_id: viaje.id,
        sequence: indice + 1,
        location: {
          type: 'Point',
          coordinates: [parseFloat(parada.longitude), parseFloat(parada.latitude)]
        },
        address: parada.address
      }));
      await ViajeParada.bulkCreate(registrosParadas);
    }

    console.log('✅ [crearViaje] Viaje creado:', {
      id: viaje.id,
      zona: servicioZona?.name ?? 'Sin zona',
      tarifa: `Bs ${finalTarifa}`,
      paradas: paradasValidadas.length
    });

    // 🔌 Notificar conductores cercanos de forma no-bloqueante
    // (no esperamos con await — el cliente recibe respuesta inmediatamente)
    (async () => {
      try {
        const [longitud, latitud] = [recogidaLongitud, recogidaLatitud];

        // Buscar conductores cercanos Y datos del pasajero en paralelo
        const [cercanoConductores, pasajero, pasajeroCalificacion] = await Promise.all([
        sequelize.query(
          `SELECT d."user_id" as "userId"
             FROM ubicacion_conductor dl
             JOIN conductor d ON dl.driver_id = d.id
             WHERE dl.is_online = true
               AND d.status = 'aprobado'
               AND d.id NOT IN (
                 SELECT driver_id FROM viaje
                 WHERE (status IN ('aceptado', 'llegado', 'en_curso') OR (request_mode = 'asignacion_rapida' AND status = 'solicitado'))
                   AND driver_id IS NOT NULL
               )
               AND ST_DWithin(
                 dl.location::geography,
                 ST_GeomFromText('POINT(${longitud} ${latitud})', 4326)::geography,
                 3000
               )`,
          { type: sequelize.QueryTypes.SELECT }
        ),
        Usuario.findByPk(pasajeroId, {
          attributes: ['id', 'name', 'phone', 'profilePhoto'],
          include: [identidadConNombre]
        }),
        calcularCalificacion(pasajeroId, 'pasajero')]
        );

        if (cercanoConductores.length === 0) {
          console.log(`🔍 [crearViaje] Sin conductores cercanos para el viaje ${viaje.id}`);
          return;
        }

        const viajeContenido = {
          rideId: viaje.id,
          passengerName: nombreParticipante(pasajero?.identity) || pasajero?.name || 'Pasajero',
          passengerPhone: pasajero?.phone || '',
          passengerRating: pasajeroCalificacion,
          passengerProfilePhoto: pasajero?.profilePhoto || null,
          pickupAddress: recogidaUbicacion.address,
          dropoffAddress: destinoUbicacion.address,
          fare: finalTarifa,
          distance: finalDistancia,
          duration: finalDuracion,
          pickupLocation: { latitude: recogidaLatitud, longitude: recogidaLongitud },
          dropoffLocation: {
            latitude: parseFloat(destinoUbicacion.latitude),
            longitude: parseFloat(destinoUbicacion.longitude),
            address: destinoUbicacion.address
          },
          waypoints: paradasValidadas.map((parada) => ({
            latitude: parseFloat(parada.latitude),
            longitude: parseFloat(parada.longitude),
            address: parada.address
          })),
          createdAt: viaje.createdAt,
          expiresAt: viaje.expiresAt
        };

        const io = obtenerIo();
        cercanoConductores.forEach(({ userId: usuarioId }) => {
          io.to(`user:${usuarioId}`).emit('ride:new_request', viajeContenido);
        });

        console.log(`🚗 [crearViaje] Solicitud de viaje enviada a ${cercanoConductores.length} conductor(es)`);
      } catch (error) {
        console.warn('⚠️ [crearViaje] Error notificando conductores:', error.message);
      }
    })();

    return respuesta.status(201).json({ message: 'Solicitud de viaje creada', ride: viaje });
  } catch (error) {
    console.error('❌ [crearViaje] Error:', error.message);
    return respuesta.status(500).json({
      error: 'Error al crear la solicitud de viaje',
      details: error.message
    });
  }
};

const obtenerViajePorId = async (solicitud, respuesta) => {
  try {
    const { id } = solicitud.params;

    // Solo loguear una vez cada 10 segundos para no saturar logs
    const registroClave = `getRideById_${id}`;
    const ultimoRegistroTiempo = global.lastLogs?.[registroClave] || 0;
    const ahora = Date.now();
    const debeRegistro = ahora - ultimoRegistroTiempo > 10000; // Log cada 10s

    let viaje;
    try {
      const ConductorUbicacion = require("../models/ConductorUbicacion");
      const Vehiculo = require("../models/Vehiculo");
      const Calificacion = require("../models/Calificacion");

      viaje = await Viaje.findByPk(id, {
        include: [
        {
          model: ViajeParada,
          as: 'waypoints',
          required: false,
          order: [['sequence', 'ASC']]
        },
        {
          model: Usuario,
          as: 'passenger',
          attributes: { exclude: ['password'] }
        },
        {
          model: Conductor,
          as: 'driver',
          required: false,
          attributes: { exclude: ['createdAt', 'updatedAt'] },
          include: [
          {
            model: Usuario,
            as: 'user',
            attributes: { exclude: ['password', 'createdAt', 'updatedAt'] }
          },
          {
            model: ConductorUbicacion,
            as: 'location',
            required: false
          },
          {
            model: Vehiculo,
            as: 'vehicles',
            required: false,
            where: { status: 'activo' },
            limit: 1
          }]

        }]

      });
      if (debeRegistro) {
        console.log('✅ [obtenerViajePorId] Viaje obtenido con sus relaciones:', {
          idViaje: viaje?.id,
          tieneConductor: !!viaje?.driver,
          conductorTieneUsuario: !!viaje?.driver?.user
        });
        if (!global.lastLogs) global.lastLogs = {};
        global.lastLogs[registroClave] = ahora;
      }
    } catch (asociacionError) {
      console.warn(
        '⚠️ [obtenerViajePorId] Error al cargar las relaciones:',
        asociacionError.message,
        asociacionError.stack
      );
      // Retornar viaje sin Driver si hay error de asociación
      viaje = await Viaje.findByPk(id);
    }

    if (!viaje) {
      return respuesta.status(404).json({
        error: 'Viaje no encontrado'
      });
    }

    if (debeRegistro) {
      console.log('📍 [obtenerViajePorId] Datos del viaje:', {
        idViaje: viaje.id,
        tieneConductor: !!viaje.driver,
        datosConductor: viaje.driver ?
        {
          id: viaje.driver.id,
          idUsuario: viaje.driver.userId,
          tieneUsuario: !!viaje.driver.user,
          tieneUbicacion: !!viaje.driver.location
        } :
        null
      });
    }

    // Calcular tiempo restante para cada contra-oferta (30 segundos de validez)
    const OFERTA_VALIDITY_SEGUNDOS = 30;
    const enrichedViaje = viaje.toJSON();
    const usuarioConductor = enrichedViaje.driver?.user || enrichedViaje.driver?.User;
    const idsParticipantes = [enrichedViaje.passenger?.id, usuarioConductor?.id].filter(Boolean);
    const identidades = idsParticipantes.length ? await UsuarioIdentidad.findAll({
      where: { userId: idsParticipantes },
      attributes: ['userId', 'firstNames', 'paternalSurname', 'maternalSurname']
    }) : [];
    const nombresParticipantes = new Map(identidades.map(identidad => [
      identidad.userId,
      nombreParticipante(identidad)
    ]));

    if (
    enrichedViaje.counterOffers &&
    Array.isArray(enrichedViaje.counterOffers))
    {
      enrichedViaje.counterOffers = enrichedViaje.counterOffers.map((oferta) => {
        const ofertaCreadoTiempo = new Date(oferta.createdAt).getTime();
        const transcurridoSegundos = Math.floor((ahora - ofertaCreadoTiempo) / 1000);
        const tiempoIzquierdaEnSegundos = Math.max(
          0,
          OFERTA_VALIDITY_SEGUNDOS - transcurridoSegundos
        );

        return {
          ...oferta,
          timeLeftInSeconds: tiempoIzquierdaEnSegundos,
          isExpired: tiempoIzquierdaEnSegundos === 0
        };
      });
    }

    // ── Extraer y normalizar coordenadas PostGIS ──────────────────────────
    const extraerCoordenadas = (geom, direccionCampo) => ({
      latitude: geom?.coordinates?.[1] ?? geom?.latitude ?? 0,
      longitude: geom?.coordinates?.[0] ?? geom?.longitude ?? 0,
      address: direccionCampo || ''
    });

    // ── Calcular ratings reales desde tabla ratings (via calcRating) ──────
    const conductorPromedioCalificacion = await calcularCalificacion(enrichedViaje.driverId, 'conductor');
    const pasajeroPromedioCalificacion = await calcularCalificacion(
      enrichedViaje.passengerId,
      'pasajero'
    );

    // ── Extraer ubicación del conductor desde driver_locations ────────────
    const conductorUbicacion = enrichedViaje.driver?.location;
    const conductorUbicacionCoordenadas = conductorUbicacion?.location ?
    {
      latitude: conductorUbicacion.location.coordinates?.[1] ?? 0,
      longitude: conductorUbicacion.location.coordinates?.[0] ?? 0,
      heading: conductorUbicacion.heading ?? null
    } :
    null;

    // ── Vehículo del conductor ────────────────────────────────────────────
    const vehiculo = enrichedViaje.driver?.vehicles?.[0] || null;

    const response = {
      ...enrichedViaje,
      // Ratings calculados desde tabla ratings (default 5.0 si no hay calificaciones)
      driverRatingValue: conductorPromedioCalificacion,
      passengerRatingValue: pasajeroPromedioCalificacion,
      // Ubicaciones con coordenadas y dirección correctas
      pickupLocation: extraerCoordenadas(
        enrichedViaje.pickupLocation,
        viaje.pickup_address
      ),
      dropoffLocation: extraerCoordenadas(
        enrichedViaje.dropoffLocation,
        viaje.dropoff_address
      ),
      // Waypoints normalizados
      waypoints: (enrichedViaje.waypoints || []).map((parada) => ({
        id: parada.id,
        sequence: parada.sequence,
        location: {
          latitude: parada.location?.coordinates?.[1] ?? 0,
          longitude: parada.location?.coordinates?.[0] ?? 0
        },
        address: parada.address,
        arrivedAt: parada.arrived_at || null,
        departedAt: parada.departed_at || null
      })),
      // Conductor normalizado (alias user → User para compatibilidad con frontend)
      driver: enrichedViaje.driver ?
      {
        ...enrichedViaje.driver,
        User: usuarioConductor ? { ...usuarioConductor, name: nombresParticipantes.get(usuarioConductor.id) || usuarioConductor.name } : null,
        currentLocation: conductorUbicacionCoordenadas,
        rating: conductorPromedioCalificacion,
        vehicleModel: vehiculo ?
        `${vehiculo.brand} ${vehiculo.model}`.trim() :
        null,
        vehicleColor: vehiculo?.color || null,
        vehiclePlate: vehiculo?.plate || null
      } :
      null,
      // Pasajero con rating calculado
      passenger: enrichedViaje.passenger ?
      {
        ...enrichedViaje.passenger,
        name: nombresParticipantes.get(enrichedViaje.passenger.id) || enrichedViaje.passenger.name,
        rating: pasajeroPromedioCalificacion
      } :
      null
    };

    respuesta.status(200).json(response);
  } catch (error) {
    console.error('Error al obtener viaje:', error);
    respuesta.status(500).json({
      error: 'Error al obtener el viaje'
    });
  }
};

const obtenerActivoViaje = async (solicitud, respuesta) => {
  try {
    const usuarioId = solicitud.user.id;
    await require("../services/rapidaAsignacionServicio").vencerReservas();
    const activoConductor = await Conductor.findOne({ where: { userId: usuarioId } });

    let activoViaje;
    try {
      activoViaje = await Viaje.findOne({
        where: {
          [Operador.or]: [{ passengerId: usuarioId }, ...(activoConductor ? [{ driverId: activoConductor.id }] : [])],
          [Operador.and]: [{ [Operador.or]: [
            { status: { [Operador.in]: ['aceptado', 'llegado', 'en_curso'] } },
            { requestMode: 'negociacion', status: { [Operador.in]: ['solicitado', 'ofertado'] }, expiresAt: { [Operador.gt]: new Date() } }]
          }]
        },
        include: [
        {
          model: Usuario,
          as: 'passenger',
          attributes: { exclude: ['password'] }
        },
        {
          model: Conductor,
          as: 'driver',
          required: false,
          include: [
          {
            model: Usuario,
            as: 'user',
            attributes: { exclude: ['password'] }
          }]

        }]

      });
    } catch (asociacionError) {
      console.warn(
        '⚠️ [getActiveRide] Error cargando asociaciones:',
        asociacionError.message
      );
      // Retornar viaje sin Driver si hay error
      activoViaje = await Viaje.findOne({
        where: {
          [Operador.or]: [{ passengerId: usuarioId }, ...(activoConductor ? [{ driverId: activoConductor.id }] : [])],
          [Operador.and]: [{ [Operador.or]: [
            { status: { [Operador.in]: ['aceptado', 'llegado', 'en_curso'] } },
            { requestMode: 'negociacion', status: { [Operador.in]: ['solicitado', 'ofertado'] }, expiresAt: { [Operador.gt]: new Date() } }]
          }]
        }
      });
    }

    if (!activoViaje) {
      return respuesta.status(404).json({
        error: 'No hay viajes activos'
      });
    }

    respuesta.status(200).json({
      ride: activoViaje
    });
  } catch (error) {
    console.error('Error al obtener viaje activo:', error);
    respuesta.status(500).json({
      error: 'Error al obtener el viaje activo'
    });
  }
};

const obtenerViajeHistorial = async (solicitud, respuesta) => {
  try {
    const usuarioId = solicitud.user.id;
    const { limit: limite = 10, offset: desplazamiento = 0 } = solicitud.query;

    // driver_id en rides referencia drivers.id (no users.id).
    // Hay que resolver el drivers.id del usuario antes de filtrar.
    const conductorRegistro = await Conductor.findOne({ where: { userId: usuarioId } });
    const conductorId = conductorRegistro?.id ?? null;

    const oClausula = [{ passengerId: usuarioId }];
    if (conductorId) oClausula.push({ driverId: conductorId });

    const viajes = await Viaje.findAll({
      where: {
        [Operador.or]: oClausula,
        status: {
          [Operador.in]: ['completado', 'cancelado']
        }
      },
      include: [
      { model: Usuario, as: 'passenger', attributes: { exclude: ['password'] } },
      { model: ViajeParada, as: 'waypoints', attributes: ['sequence', 'address'], required: false },
      {
        model: Conductor,
        as: 'driver',
        required: false,
        include: [
        {
          model: Usuario,
          as: 'user',
          attributes: { exclude: ['password'] }
        }]

      }],

      order: [['createdAt', 'DESC']],
      limit: parseInt(limite),
      offset: parseInt(desplazamiento)
    });

    const total = await Viaje.count({
      where: {
        [Operador.or]: oClausula,
        status: {
          [Operador.in]: ['completado', 'cancelado']
        }
      }
    });

    respuesta.status(200).json({
      rides: viajes,
      total,
      limit: parseInt(limite),
      offset: parseInt(desplazamiento)
    });
  } catch (error) {
    console.error('Error al obtener historial:', error);
    respuesta.status(500).json({
      error: 'Error al obtener el historial de viajes'
    });
  }
};

const aceptarViaje = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId } = solicitud.params;
    const conductorId = solicitud.user.id;

    console.log('🚗 [acceptRide] Intentando aceptar viaje:', {
      rideId: viajeId,
      driverId: conductorId,
      userExists: !!solicitud.user,
      userIdExists: !!solicitud.user?.id
    });

    // Validar que el conductor esté autenticado
    if (!conductorId) {
      return respuesta.status(401).json({
        error: 'Conductor no autenticado'
      });
    }

    // 🔥 VALIDAR QUE EL USUARIO SEA UN CONDUCTOR APROBADO
    const conductor = await Conductor.findOne({
      where: { userId: conductorId, status: 'aprobado' }
    });

    if (!conductor) {
      console.warn('⚠️ [acceptRide] Usuario no es conductor aprobado:', {
        userId: conductorId
      });
      return respuesta.status(403).json({
        error:
        'No eres un conductor aprobado. Debes completar tu registro y ser aprobado para aceptar viajes.'
      });
    }

    console.log('✅ [acceptRide] Conductor validado:', {
      driverId: conductor.id,
      userId: conductor.userId,
      status: conductor.status
    });

    // 🔥 VALIDAR QUE LA SOLICITUD NO HA EXPIRADO
    // UPDATE atómico: validar status en la misma operación
    // Evita race condition donde dos conductores aceptan el mismo viaje
    const [actualizado] = await Viaje.update(
      {
        driverId: conductor.id,
        status: 'aceptado',
        acceptedAt: new Date()
      },
      {
        where: {
          id: viajeId,
          status: 'solicitado',
          requestMode: 'negociacion',
          expiresAt: { [Operador.gt]: new Date() }
        }
      }
    );

    console.log('🚗 [acceptRide] Resultado de actualización:', {
      updated: actualizado,
      rideId: viajeId,
      driverId: conductor.id
    });

    if (actualizado === 0) {
      // Verificar si el viaje existe pero no está en estado 'solicitado'
      const existenteViaje = await Viaje.findByPk(viajeId);
      if (!existenteViaje) {
        return respuesta.status(404).json({
          error: 'Viaje no encontrado'
        });
      }

      // Validar si la solicitud expiró
      if (
      existenteViaje.expiresAt &&
      new Date() > new Date(existenteViaje.expiresAt))
      {
        console.warn('⏰ [acceptRide] ❌ Solicitud expirada:', {
          rideId: viajeId,
          expiresAt: existenteViaje.expiresAt,
          now: new Date()
        });

        return respuesta.status(410).json({
          error: 'La solicitud de viaje ha expirado (2 minutos sin respuesta)',
          expiredAt: existenteViaje.expiresAt
        });
      }

      // Log específico para entender por qué falló la aceptación
      console.warn(
        '⚠️ [acceptRide] Fallo al aceptar. Estado actual:',
        existenteViaje.status
      );

      if (existenteViaje.status === 'cancelado') {
        return respuesta.status(400).json({
          error: 'Esta solicitud fue cancelada por el pasajero'
        });
      } else if (existenteViaje.status === 'aceptado') {
        return respuesta.status(400).json({
          error: 'Esta solicitud ya fue aceptada por otro conductor'
        });
      }

      return respuesta.status(400).json({
        error:
        'El viaje ya fue aceptado por otro conductor o ha sido cancelado'
      });
    }

    // Obtener el viaje actualizado
    let viajeActualizado;
    try {
      viajeActualizado = await Viaje.findByPk(viajeId, {
        include: [
        {
          model: Usuario,
          as: 'passenger',
          attributes: { exclude: ['password'] }
        },
        {
          model: Conductor,
          as: 'driver',
          required: false,
          include: [
          {
            model: Usuario,
            as: 'user',
            attributes: { exclude: ['password'] }
          }]

        }]

      });
    } catch (asociacionError) {
      console.warn(
        '⚠️ [acceptRide] Error cargando asociaciones:',
        asociacionError.message
      );
      viajeActualizado = await Viaje.findByPk(viajeId);
    }

    console.log('✅ [acceptRide] Viaje aceptado exitosamente:', {
      rideId: viajeActualizado.id,
      status: viajeActualizado.status,
      driverId: viajeActualizado.driverId,
      passengerName: viajeActualizado.passenger?.name
    });

    // ── Notificar al pasajero ─────────────────────────────────────────────
    const { notificarViajeAceptado: notificarViajeAceptado } = require("../services/notificacionServicio");
    const conductorNombre =
    viajeActualizado.driver?.User?.name ??
    viajeActualizado.driver?.user?.name ??
    'El conductor';
    notificarViajeAceptado(viajeActualizado.passengerId, viajeActualizado, conductorNombre);

    // 🔌 Socket: notificar al pasajero que el viaje fue aceptado
    try {
      obtenerIo().to(`user:${viajeActualizado.passengerId}`).emit('ride:accepted', {
        rideId: viajeActualizado.id,
        status: 'aceptado',
        driverId: viajeActualizado.driverId,
        driverName: conductorNombre
      });
      obtenerIo().to(`ride:${viajeActualizado.id}`).emit('ride:status:changed', {
        rideId: viajeActualizado.id,
        status: 'aceptado',
        timestamp: new Date().toISOString()
      });
    } catch (socketError) {
      console.warn('⚠️ [Socket] acceptRide emit error:', socketError.message);
    }

    respuesta.status(200).json({
      message: 'Viaje aceptado exitosamente',
      ride: viajeActualizado
    });
  } catch (error) {
    console.error('❌ [acceptRide] Error al aceptar viaje:', error);
    console.error('❌ [acceptRide] Stack trace:', error.stack);
    console.error('❌ [acceptRide] Error message:', error.message);
    respuesta.status(error.status || (['23505', '23514', '40P01'].includes(error.original?.code) ? 409 : 500)).json({
      error: 'Error al aceptar el viaje',
      details: error.message
    });
  }
};

const completarViaje = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId } = solicitud.params;
    const { driverRating: conductorCalificacion, driverReview: conductorRevision, passengerRating: pasajeroCalificacion, passengerReview: pasajeroRevision } =
    solicitud.body;

    console.log('🚕 [completeRide] Datos recibidos:', {
      rideId: viajeId,
      driverRating: conductorCalificacion,
      driverReview: conductorRevision,
      passengerRating: pasajeroCalificacion,
      passengerReview: pasajeroRevision
    });

    try {
      await sequelize.query('SELECT public.tasa_comision_para_viaje(:id)',{esquemaFisico:true,replacements:{id:viajeId}});
    } catch(error) {
      if(error.original?.code==='23514') return respuesta.status(409).json({error:'Configura la zona y su tasa de comisión antes de completar el viaje.'});
      throw error;
    }
    // UPDATE atómico: validar status en la misma operación
    const [actualizado] = await Viaje.update(
      {
        status: 'completado',
        completedAt: new Date(),
        driverRating: conductorCalificacion || undefined,
        driverReview: conductorRevision || undefined,
        passengerRating: pasajeroCalificacion || undefined,
        passengerReview: pasajeroRevision || undefined,
        paymentStatus: 'completado'
      },
      {
        where: {
          id: viajeId,
          status: 'en_curso' // ← Validar AQUÍ en la actualización
        }
      }
    );

    if (actualizado === 0) {
      // Verificar si el viaje existe pero no está en estado 'en_curso'
      // Si está completado, permitir actualizar calificaciones
      const ride = await Viaje.findByPk(viajeId);
      if (!ride) {
        return respuesta.status(404).json({
          error: 'Viaje no encontrado'
        });
      }

      if (ride.status === 'completado') {
        // Permitir actualizar calificaciones en viajes ya completados
        await Viaje.update(
          {
            driverRating:
            conductorCalificacion !== undefined ? conductorCalificacion : ride.driverRating,
            driverReview:
            conductorRevision !== undefined ? conductorRevision : ride.driverReview,
            passengerRating:
            pasajeroCalificacion !== undefined ?
            pasajeroCalificacion :
            ride.passengerRating,
            passengerReview:
            pasajeroRevision !== undefined ?
            pasajeroRevision :
            ride.passengerReview
          },
          {
            where: { id: viajeId }
          }
        );
      } else {
        return respuesta.status(400).json({
          error: 'El viaje no está en progreso o ya fue completado'
        });
      }
    }

    // Obtener el viaje actualizado
    let viaje;
    try {
      viaje = await Viaje.findByPk(viajeId, {
        include: [
        {
          model: Usuario,
          as: 'passenger',
          attributes: { exclude: ['password'] }
        },
        {
          model: Conductor,
          as: 'driver',
          required: false,
          include: [
          {
            model: Usuario,
            as: 'user',
            attributes: { exclude: ['password'] }
          }]

        }]

      });
    } catch (asociacionError) {
      console.warn(
        '⚠️ [completeRide] Error cargando asociaciones:',
        asociacionError.message
      );
      viaje = await Viaje.findByPk(viajeId);
    }

    // Actualizar ratings basado en las calificaciones del viaje
    if (viaje) {
      console.log('📊 [completeRide] Actualizando ratings para viaje:', {
        rideId: viaje.id,
        driverId: viaje.driverId,
        passengerId: viaje.passengerId,
        driverRating: viaje.driverRating,
        passengerRating: viaje.passengerRating
      });

      // Actualizar rating del conductor en tabla Driver si hay driverRating
      if (viaje.driverRating && viaje.driverId) {
        try {
          console.log(
            `🔄 [completeRide] Calculando rating medio del conductor ${viaje.driverId}...`
          );
          const conductorCalificaciones = await Viaje.findAll({
            where: {
              driverId: viaje.driverId,
              driverRating: { [Operador.not]: null }
            },
            attributes: ['driverRating']
          });

          if (conductorCalificaciones.length > 0) {
            const promedioCalificacion =
            conductorCalificaciones.reduce((suma, r) => suma + r.driverRating, 0) /
            conductorCalificaciones.length;

            const totalViajesComoConductor = await Viaje.count({
              where: {
                driverId: viaje.driverId,
                status: 'completado'
              }
            });

            await Conductor.update(
              {
                rating: parseFloat(promedioCalificacion.toFixed(2)),
                totalTripsAsDriver: totalViajesComoConductor
              },
              {
                where: { id: viaje.driverId }
              }
            );

            console.log(
              `✅ [completeRide] Driver.rating actualizado: ${promedioCalificacion.toFixed(
                2
              )} (${conductorCalificaciones.length} reseñas, ${
              totalViajesComoConductor} viajes)`
            );
          }
        } catch (calificacionError) {
          console.error(
            '⚠️ [completeRide] Error actualizando Driver.rating:',
            calificacionError.message
          );
        }
      }

      // Actualizar rating del pasajero en tabla User si hay passengerRating
      if (viaje.passengerRating && viaje.passengerId) {
        try {
          console.log(
            `🔄 [completeRide] Calculando rating medio del pasajero ${viaje.passengerId}...`
          );
          const pasajeroCalificaciones = await Viaje.findAll({
            where: {
              passengerRating: { [Operador.not]: null }
            },
            attributes: ['passengerRating']
          });

          if (pasajeroCalificaciones.length > 0) {
            const promedioCalificacion =
            pasajeroCalificaciones.reduce((suma, r) => suma + r.passengerRating, 0) /
            pasajeroCalificaciones.length;

            const totalViajes = await Viaje.count({
              where: {
                passengerId: viaje.passengerId,
                status: 'completado'
              }
            });

            // rating y totalTrips son campos calculados (no columnas físicas en users)
            // Se calculan desde rides cuando se necesitan mostrar
            console.log(
              `✅ [completeRide] Rating pasajero calculado: ${promedioCalificacion.toFixed(
                2
              )} (${pasajeroCalificaciones.length} reseñas, ${
              totalViajes} viajes completados)`
            );
          }
        } catch (calificacionError) {
          console.error(
            '⚠️ [completeRide] Error actualizando User.rating:',
            calificacionError.message
          );
        }
      } else {
        console.log(
          `⚠️ [completeRide] Sin passengerRating para actualizar. passengerRating=${viaje.passengerRating}, passengerId=${viaje.passengerId}`
        );
      }
    } else {
      console.log('⚠️ [completeRide] Ride no encontrado después de actualizar');
    }

    // ── Registrar ganancias del conductor ──────────────────────────────
    // 📝  Los registros se crean siempre (historial acumulado).
    //     commission_status = 'pendiente' — quedan pendientes hasta que el
    //     admin active el cobro de comisiones (COMMISSIONS_START_DATE en .env).
    //     Los earnings anteriores a esa fecha NUNCA se incluirán en un settlement.
    if (viaje?.driverId) {
      try {


        // Detectar si ya existe (evitar duplicados si completeRide se llama dos veces)
        const existente = await CobrosConductor.findOne({
          where: { ride_id: viaje.id }
        });
        if (!existente) {
          // ── Crear registro de pago si no existe ─────────────────────────────
          const { Pago: Pago } = require('../models');
          let pago = await Pago.findOne({
            where: { rideId: viaje.id }
          });
          if (!pago) {
            pago = await Pago.create({
              rideId: viaje.id,
              passengerId: viaje.passengerId,
              amount: parseFloat(viaje.finalFare ?? 0),
              currency: 'BOB',
              payment_status: 'completado',
              paid_at: new Date()
            });
            console.log(
              `💳 [completeRide] Payment creado: ${pago.id} | Bs ${pago.amount}`
            );
          }

          await CobrosConductor.create({ride_id:viaje.id,settlement_id:null});
          console.log('Ganancia registrada con importes calculados desde el viaje.');
        }
      } catch (gananciaError) {
        // No romper el flujo — el viaje ya quedó completado
        console.error(
          '⚠️ [completeRide] Error al crear CobrosConductor:',
          gananciaError.message
        );
      }
    }

    // 🔌 Socket: notificar viaje completado
    try {
      obtenerIo().to(`ride:${viaje.id}`).emit('ride:status:changed', {
        rideId: viaje.id,
        status: 'completado',
        timestamp: new Date().toISOString()
      });
    } catch (socketError) {
      console.warn('⚠️ [Socket] completeRide emit error:', socketError.message);
    }

    respuesta.status(200).json({
      message: 'Viaje completado exitosamente',
      ride: viaje
    });
  } catch (error) {
    console.error('Error al completar viaje:', error);
    respuesta.status(500).json({
      error: 'Error al completar el viaje'
    });
  }
};

const obtenerViajeSolicitudes = async (solicitud, respuesta) => {
  try {
    if (await require("../services/rapidaAsignacionServicio").actual(solicitud.user.id, true)) return respuesta.json([]);
    const requestingConductor = await Conductor.findOne({
      where: { userId: solicitud.user.id },
      attributes: ['id']
    });
    if (!requestingConductor) return respuesta.json([]);
    console.log(
      '📡 [obtenerSolicitudesViaje] Buscando solicitudes de viajes pendientes...'
    );

    // Obtener todas las solicitudes de viajes que están en estado 'solicitado' u 'ofertado'
    // 'ofertado' = ya tiene al menos una oferta pero el pasajero aún no aceptó ninguna
    // Otros conductores pueden seguir enviando ofertas mientras el ride esté en estos estados
    const viajes = await Viaje.findAll({
      where: {
        requestMode: 'negociacion',
        status: ['solicitado', 'ofertado'],
        expiresAt: { [Operador.gt]: new Date() }
      },
      include: [
      {
        model: ViajeParada,
        as: 'waypoints',
        required: false,
        order: [['sequence', 'ASC']]
      },
      {
        model: Usuario,
        as: 'passenger',
          attributes: ['id', 'name', 'phone', 'profilePhoto'],
          include: [identidadConNombre]
      }],

      order: [['createdAt', 'DESC']] // Ordenar por más recientes
    });

    const rechazadoOfertas = viajes.length ? await ViajeOferta.findAll({
      where: {
        driver_id: requestingConductor.id,
        ride_id: { [Operador.in]: viajes.map((viaje) => viaje.id) },
        status: 'rechazado'
      },
      attributes: ['ride_id']
    }) : [];
    const rechazadoViajeIds = new Set(rechazadoOfertas.map((oferta) => oferta.ride_id));
    const visibleViajes = viajes.filter((viaje) => !rechazadoViajeIds.has(viaje.id));

    console.log('📡 [obtenerSolicitudesViaje] Viajes visibles:', visibleViajes.length);

    // ── Calcular ratings de pasajeros en batch (1 query) ─────────────────
    // Rating por defecto = 5 para usuarios nuevos sin valoraciones
    const pasajeroIds = [
    ...new Set(visibleViajes.map((r) => r.passengerId).filter(Boolean))];

    const pasajeroCalificacionesMapa = {};

    if (pasajeroIds.length > 0) {
      await Promise.all(
        pasajeroIds.map(async (pid) => {
          pasajeroCalificacionesMapa[pid] = await calcularCalificacion(pid, 'pasajero');
        })
      );
    }

    // Transformar la respuesta a un formato más limpio
    const viajeSolicitudes = visibleViajes.map((viaje, indice) => {
      const transformado = {
        rideId: viaje.id,
        passengerName: nombreParticipante(viaje.passenger?.identity) || viaje.passenger?.name || 'Pasajero',
        passengerPhone: viaje.passenger?.phone || '',
        passengerRating: pasajeroCalificacionesMapa[viaje.passengerId] ?? 5,
        passengerProfilePhoto: viaje.passenger?.profilePhoto || null,
        pickupLocation: {
          latitude:
          viaje.pickupLocation?.coordinates?.[1] ??
          viaje.pickupLocation?.latitude ??
          0,
          longitude:
          viaje.pickupLocation?.coordinates?.[0] ??
          viaje.pickupLocation?.longitude ??
          0,
          address: viaje.pickup_address || ''
        },
        dropoffLocation: {
          latitude:
          viaje.dropoffLocation?.coordinates?.[1] ??
          viaje.dropoffLocation?.latitude ??
          0,
          longitude:
          viaje.dropoffLocation?.coordinates?.[0] ??
          viaje.dropoffLocation?.longitude ??
          0,
          address: viaje.dropoff_address || ''
        },
        waypoints: (viaje.waypoints || []).map((parada) => ({
          latitude:
          parada.location?.coordinates?.[1] ??
          parada.location?.latitude ??
          0,
          longitude:
          parada.location?.coordinates?.[0] ??
          parada.location?.longitude ??
          0,
          address: parada.address || '',
          sequence: parada.sequence
        })),
        fare: viaje.totalFare || viaje.finalFare,
        distance: viaje.distance,
        duration: viaje.duration,
        notes: viaje.notes || '',
        createdAt: viaje.createdAt,
        expiresAt: viaje.expiresAt
      };

      // 🔥 DEBUG: Log cada viaje devuelto
      console.log(`📡 [obtenerSolicitudesViaje] Viaje ${indice + 1}:`, {
        idViaje: transformado.rideId,
        distancia: transformado.distance,
        duracion: transformado.duration,
        tarifa: transformado.fare,
        valoresGuardados: {
          distancia: viaje.distance,
          duracion: viaje.duration,
          tarifaTotal: viaje.totalFare,
          tarifaFinal: viaje.finalFare
        }
      });

      return transformado;
    });

    console.log(
      '📡 [obtenerSolicitudesViaje] Solicitudes devueltas:',
      viajeSolicitudes.length
    );
    respuesta.status(200).json(viajeSolicitudes);
  } catch (error) {
    console.error(
      '❌ [obtenerSolicitudesViaje] Error al obtener solicitudes de viajes:',
      error
    );
    respuesta.status(500).json({
      error: 'Error al obtener solicitudes de viajes',
      details: error.message
    });
  }
};

// 🔵 CUANDO EL CONDUCTOR LLEGA AL PUNTO DE RECOGIDA
const llegadoViaje = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId } = solicitud.params;

    // UPDATE atómico: validar que esté en estado 'aceptado'
    const [actualizado] = await Viaje.update(
      {
        status: 'llegado',
        arrivedAt: new Date()
      },
      {
        where: {
          id: viajeId,
          status: 'aceptado' // ← Solo se puede marcar como llegado si fue aceptado
        }
      }
    );

    if (actualizado === 0) {
      // Verificar si el viaje existe pero no está en estado 'aceptado'
      const ride = await Viaje.findByPk(viajeId);
      if (!ride) {
        return respuesta.status(404).json({
          error: 'Viaje no encontrado'
        });
      }

      return respuesta.status(400).json({
        error: 'El viaje no está en estado aceptado',
        currentStatus: ride.status
      });
    }

    // Recuperar el viaje actualizado con asociaciones
    let viaje;
    try {
      viaje = await Viaje.findByPk(viajeId, {
        include: [
        {
          model: Usuario,
          as: 'passenger',
          attributes: { exclude: ['password'] }
        },
        {
          model: Conductor,
          as: 'driver',
          required: false,
          include: [
          {
            model: Usuario,
            as: 'user',
            attributes: { exclude: ['password'] }
          }]

        }]

      });
    } catch (asociacionError) {
      console.warn(
        '⚠️ [registrarLlegada] Error al cargar las relaciones:',
        asociacionError.message
      );
      viaje = await Viaje.findByPk(viajeId);
    }

    console.log('🟠 [registrarLlegada] El conductor llegó al punto de recogida:', {
      idViaje: viaje.id,
      estado: viaje.status,
      llegadaEn: viaje.arrivedAt
    });

    const { notificarConductorLlegado: notificarConductorLlegado } = require("../services/notificacionServicio");
    const conductorNombre = viaje.driver?.User?.name || 'Tu conductor';
    notificarConductorLlegado(viaje.passengerId, viaje, conductorNombre).catch((error) => {
      console.error('Error enviando notificación arrived:', error);
    });

    // 🔌 Socket: notificar cambio de estado
    try {
      obtenerIo().to(`ride:${viaje.id}`).emit('ride:status:changed', {
        rideId: viaje.id,
        status: 'llegado',
        timestamp: new Date().toISOString()
      });
    } catch (socketError) {
      console.warn('⚠️ [Socket] arrivedRide emit error:', socketError.message);
    }

    respuesta.status(200).json({
      message: 'Conductor llegó al punto de recogida',
      ride: viaje
    });
  } catch (error) {
    console.error('❌ [registrarLlegada] Error al registrar la llegada:', error);
    respuesta.status(500).json({
      error: 'Error al marcar como llegado',
      details: error.message
    });
  }
};

const pasajeroListo = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId } = solicitud.params;

    // UPDATE: marcar al pasajero como listo
    const [actualizado] = await Viaje.update(
      {
        passengerReadyAt: new Date()
      },
      {
        where: {
          id: viajeId,
          status: 'llegado' // Solo se puede marcar si ya llegó el conductor
        }
      }
    );

    if (actualizado === 0) {
      // Verificar si el viaje existe pero no está en estado 'llegado'
      const ride = await Viaje.findByPk(viajeId);
      if (!ride) {
        return respuesta.status(404).json({
          error: 'Viaje no encontrado'
        });
      }

      return respuesta.status(400).json({
        error:
        'El viaje debe estar en estado "llegado" para marcar al pasajero como listo',
        currentStatus: ride.status
      });
    }

    // Recuperar el viaje actualizado
    const viaje = await Viaje.findByPk(viajeId, {
      include: [
      {
        model: Usuario,
        as: 'passenger',
        attributes: { exclude: ['password'] }
      },
      {
        model: Conductor,
        as: 'driver',
        required: false,
        include: [
        {
          model: Usuario,
          as: 'user',
          attributes: { exclude: ['password'] }
        }]

      }]

    });

    console.log('🟢 [passengerReady] Pasajero está listo:', {
      id: viaje.id,
      status: viaje.status,
      passengerReadyAt: viaje.passengerReadyAt
    });

    // 🔌 Socket: notificar que pasajero está listo
    try {
      obtenerIo().to(`ride:${viaje.id}`).emit('ride:status:changed', {
        rideId: viaje.id,
        status: 'passenger_ready',
        timestamp: new Date().toISOString()
      });
    } catch (socketError) {
      console.warn(
        '⚠️ [Socket] passengerReady emit error:',
        socketError.message
      );
    }

    respuesta.status(200).json({
      message: 'Pasajero confirmó que está listo',
      ride: viaje
    });
  } catch (error) {
    console.error(
      '❌ [passengerReady] Error al marcar pasajero como listo:',
      error
    );
    respuesta.status(500).json({
      error: 'Error al marcar pasajero como listo',
      details: error.message
    });
  }
};

const inicioViaje = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId } = solicitud.params;

    // UPDATE atómico: validar que esté en estado 'llegado'
    const [actualizado] = await Viaje.update(
      {
        status: 'en_curso',
        startedAt: new Date()
      },
      {
        where: {
          id: viajeId,
          status: 'llegado' // ← Solo se puede iniciar si el conductor llegó
        }
      }
    );

    if (actualizado === 0) {
      // Verificar si el viaje existe pero no está en estado 'aceptado'
      const ride = await Viaje.findByPk(viajeId);
      if (!ride) {
        return respuesta.status(404).json({
          error: 'Viaje no encontrado'
        });
      }

      return respuesta.status(400).json({
        error: 'El viaje no está en estado aceptado',
        currentStatus: ride.status
      });
    }

    // Recuperar el viaje actualizado con asociaciones
    let viaje;
    try {
      viaje = await Viaje.findByPk(viajeId, {
        include: [
        {
          model: Usuario,
          as: 'passenger',
          attributes: { exclude: ['password'] }
        },
        {
          model: Conductor,
          as: 'driver',
          required: false,
          include: [
          {
            model: Usuario,
            as: 'user',
            attributes: { exclude: ['password'] }
          }]

        }]

      });
    } catch (asociacionError) {
      console.warn(
        '⚠️ [startRide] Error cargando asociaciones:',
        asociacionError.message
      );
      viaje = await Viaje.findByPk(viajeId);
    }

    // 🔌 Socket: notificar inicio de viaje
    try {
      obtenerIo().to(`ride:${viaje.id}`).emit('ride:status:changed', {
        rideId: viaje.id,
        status: 'en_curso',
        timestamp: new Date().toISOString()
      });
    } catch (socketError) {
      console.warn('⚠️ [Socket] startRide emit error:', socketError.message);
    }

    respuesta.status(200).json({
      message: 'Viaje iniciado',
      ride: viaje
    });
  } catch (error) {
    console.error('❌ [startRide] Error al iniciar viaje:', error);
    respuesta.status(500).json({
      error: 'Error al iniciar el viaje',
      details: error.message
    });
  }
};

// 💰 CONTRA-OFERTAS DE TARIFA

const enviarContraOferta = async (solicitud, respuesta) => {
  const relojRecibidoEn = new Date().toISOString();
  try {
    const { rideId: viajeId } = solicitud.params;
    const { proposedPrice: propuestoPrecio } = solicitud.body;
    const conductorId = solicitud.user.id;

    console.log('💰 [submitCounterOffer] Nueva oferta:', {
      rideId: viajeId,
      driverId: conductorId,
      proposedPrice: propuestoPrecio
    });

    const Vehiculo = require("../models/Vehiculo");
    const { ViajeOferta: RideOffer } = require('../models');

    // Validar que el conductor esté aprobado
    const conductor = await Conductor.findOne({
      where: { userId: conductorId, status: 'aprobado' },
      include: [
      {
        model: Usuario,
        as: 'user',
        attributes: ['id', 'name', 'phone', 'profilePhoto']
      },
      {
        model: Vehiculo,
        as: 'vehicles',
        attributes: ['id', 'brand', 'model', 'color', 'plate'],
        where: { status: 'activo' },
        required: false,
        limit: 1
      }]

    });

    if (!conductor) {
      return respuesta.status(403).json({ error: 'No eres un conductor aprobado' });
    }

    // Obtener el viaje
    const viaje = await Viaje.findByPk(viajeId);
    if (!viaje) {
      return respuesta.status(404).json({ error: 'Viaje no encontrado' });
    }

    if (!['solicitado', 'ofertado'].includes(viaje.status)) {
      return respuesta.
      status(400).
      json({ error: 'El viaje ya fue aceptado o cancelado' });
    }

    if (viaje.expiresAt && new Date(viaje.expiresAt) <= new Date()) {
      return respuesta.status(410).json({ error: 'La solicitud ya expiró' });
    }

    const rechazadoOferta = await RideOffer.findOne({
      where: { ride_id: viajeId, driver_id: conductor.id, status: 'rechazado' },
      attributes: ['id']
    });
    if (rechazadoOferta) {
      return respuesta.status(409).json({
        error: 'El pasajero rechazó tu oferta para esta solicitud.',
        code: 'OFFER_REJECTED'
      });
    }

    const ofertaVenceEn = () => new Date(Math.min(
      Date.now() + 60 * 1000,
      viaje.expiresAt ? new Date(viaje.expiresAt).getTime() : Infinity
    ));

    // Evitar oferta duplicada activa del mismo conductor
    const existente = await RideOffer.findOne({
      where: { ride_id: viajeId, driver_id: conductor.id, status: 'pendiente' }
    });
    if (existente) {
      // Actualizar precio de la oferta existente
      const [actualizadoCantidad] = await RideOffer.update(
        { offered_price: propuestoPrecio, expires_at: ofertaVenceEn() },
        { where: { id: existente.id, status: 'pendiente' } }
      );
      if (!actualizadoCantidad) {
        return respuesta.status(409).json({
          error: 'La oferta ya fue procesada y no puede actualizarse.',
          code: 'OFFER_REJECTED'
        });
      }
      await existente.reload();
      const vehicle = conductor.vehicles?.[0] || null;
      const driverRating = await calcularCalificacion(conductor.id, 'conductor');
      const ofertaActualizada = {
          offerId: existente.id,
          driverId: conductor.id,
          driverName: conductor.user?.name || 'Conductor',
          driverProfilePicture: conductor.user?.profilePhoto || null,
          driverRating,
          driverPhone: conductor.user?.phone || '',
          vehicleModel: vehicle ?
          `${vehicle.brand} ${vehicle.model}`.trim() :
          '',
          vehicleColor: vehicle?.color || '',
          licensePlate: vehicle?.plate || '',
          proposedPrice: propuestoPrecio,
          createdAt: existente.createdAt,
          expiresAt: existente.expires_at
      };
      try {
        obtenerIo().to(`user:${viaje.passengerId}`).emit('offer:new', { rideId: viaje.id, offer: ofertaActualizada });
      } catch (error) {
        console.warn('No se pudo notificar la contraoferta actualizada:', error.message);
      }
      return respuesta.status(200).json({
        message: 'Oferta actualizada',
        serverClock: { receivedAt: relojRecibidoEn, sentAt: new Date().toISOString() },
        offer: ofertaActualizada
      });
    }

    // Crear oferta en ride_offers
    const vehiculo = conductor.vehicles?.[0] || null;
    const conductorCalificacion = await calcularCalificacion(conductor.id, 'conductor');

    const oferta = await RideOffer.create({
      ride_id: viajeId,
      driver_id: conductor.id,
      offered_price: propuestoPrecio,
      status: 'pendiente',
      expires_at: ofertaVenceEn()
    });

    // Cambiar estado del viaje a 'ofertado' si aún estaba en 'solicitado'
    if (viaje.status === 'solicitado') {
      await Viaje.update({ status: 'ofertado' }, { where: { id: viaje.id, status: 'solicitado' } });
    }

    console.log(
      '✅ [submitCounterOffer] Oferta guardada en ride_offers:',
      oferta.id
    );

    // 🔌 Socket: notificar nueva oferta al pasajero
    try {
      obtenerIo().
      to(`user:${viaje.passengerId}`).
      emit('offer:new', {
        rideId: viaje.id,
        offer: {
          offerId: oferta.id,
          driverId: conductor.id,
          driverName: conductor.user?.name || 'Conductor',
          driverProfilePicture: conductor.user?.profilePhoto || null,
          driverPhone: conductor.user?.phone || '',
          vehicleModel: vehiculo ?
          `${vehiculo.brand} ${vehiculo.model}`.trim() :
          '',
          vehicleColor: vehiculo?.color || '',
          licensePlate: vehiculo?.plate || '',
          proposedPrice: propuestoPrecio,
          driverRating: conductorCalificacion,
          createdAt: oferta.createdAt,
          expiresAt: oferta.expires_at,
          timeLeftInSeconds: Math.max(0, Math.ceil((new Date(oferta.expires_at).getTime() - Date.now()) / 1000))
        }
      });
    } catch (socketError) {
      console.warn(
        '⚠️ [Socket] submitCounterOffer emit error:',
        socketError.message
      );
    }

    respuesta.status(201).json({
      message: 'Oferta enviada',
      serverClock: { receivedAt: relojRecibidoEn, sentAt: new Date().toISOString() },
      offer: {
        offerId: oferta.id,
        driverId: conductor.id,
        driverName: conductor.user?.name || 'Conductor',
        driverProfilePicture: conductor.user?.profilePhoto || null,
        driverRating: conductorCalificacion,
        driverPhone: conductor.user?.phone || '',
        vehicleModel: vehiculo ? `${vehiculo.brand} ${vehiculo.model}`.trim() : '',
        vehicleColor: vehiculo?.color || '',
        licensePlate: vehiculo?.plate || '',
        proposedPrice: propuestoPrecio,
        createdAt: oferta.createdAt,
        expiresAt: oferta.expires_at
      }
    });
  } catch (error) {
    console.error('❌ [submitCounterOffer] Error:', error);
    respuesta.
    status(error.status || (['23505', '23514', '40P01'].includes(error.original?.code) ? 409 : 500)).
    json({ error: 'Error al enviar contra-oferta', details: error.message });
  }
};

const obtenerContraOfertas = async (solicitud, respuesta) => {
  const relojRecibidoEn = new Date().toISOString();
  try {
    const { rideId: viajeId } = solicitud.params;

    const { ViajeOferta: RideOffer } = require('../models');
    const Vehiculo = require("../models/Vehiculo");

    const viaje = await Viaje.findByPk(viajeId);
    if (!viaje) {
      return respuesta.status(404).json({ error: 'Viaje no encontrado' });
    }
    if (viaje.passengerId !== solicitud.user.id) {
      return respuesta.status(403).json({ error: 'Este viaje no te pertenece.' });
    }
    if (!['solicitado', 'ofertado'].includes(viaje.status)) {
      return respuesta.json({ offers: [], serverClock: { receivedAt: relojRecibidoEn, sentAt: new Date().toISOString() } });
    }

    // Auto-expirar ofertas cuyo expires_at ya pasó
    const vencidoCantidad = await RideOffer.update(
      { status: 'vencido' },
      {
        where: {
          ride_id: viajeId,
          status: 'pendiente',
          expires_at: { [Operador.lt]: new Date() }
        }
      }
    );
    if (vencidoCantidad[0] > 0) {
      console.log(
        `⏰ [obtenerContraofertas] ${vencidoCantidad[0]} oferta(s) expiradas marcadas en BD`
      );
      // Si no quedan ofertas pendientes, volver el ride a 'solicitado'
      // para que otros conductores puedan verlo y enviar nuevas ofertas
      const restantePendiente = await RideOffer.count({
        where: { ride_id: viajeId, status: 'pendiente' }
      });
      if (restantePendiente === 0 && viaje.status === 'ofertado') {
        await Viaje.update({ status: 'solicitado' }, { where: { id: viaje.id, status: 'ofertado' } });
        console.log(
          `🔄 [obtenerContraofertas] El viaje ${viajeId} vuelve a 'solicitado' (todas las ofertas expiraron)`
        );
      }
    }

    // Leer ofertas desde ride_offers (estado pending, aún vigentes)
    const viajeOfertas = await RideOffer.findAll({
      where: { ride_id: viajeId, status: 'pendiente' },
      include: [
      {
        model: Conductor,
        as: 'driver',
        include: [
        {
          model: Usuario,
          as: 'user',
          attributes: ['id', 'name', 'phone', 'profilePhoto']
        },
        {
          model: Vehiculo,
          as: 'vehicles',
          where: { status: 'activo' },
          required: false,
          limit: 1
        }]

      }],

      order: [['created_at', 'ASC']]
    });

    const ofertas = await Promise.all(
      viajeOfertas.map(async (o) => {
        const conductor = o.driver;
        const vehiculo = conductor?.vehicles?.[0] || null;
        const conductorCalificacion = await calcularCalificacion(conductor?.id, 'conductor');

        const ahora = Date.now();
        const venceEn = o.expires_at ?
        new Date(o.expires_at).getTime() :
        ahora + 60000;
        const tiempoIzquierdaEnSegundos = Math.max(
          0,
          Math.floor((venceEn - ahora) / 1000)
        );

        return {
          offerId: o.id,
          driverId: conductor?.id || null,
          driverName: conductor?.user?.name || 'Conductor',
          driverProfilePicture: conductor?.user?.profilePhoto || null,
          driverRating: conductorCalificacion,
          driverPhone: conductor?.user?.phone || '',
          vehicleModel: vehiculo ?
          `${vehiculo.brand} ${vehiculo.model}`.trim() :
          '',
          vehicleColor: vehiculo?.color || '',
          licensePlate: vehiculo?.plate || '',
          proposedPrice: parseFloat(o.offered_price),
          createdAt: o.createdAt,
          expiresAt: o.expires_at,
          timeLeftInSeconds: tiempoIzquierdaEnSegundos,
          isExpired: tiempoIzquierdaEnSegundos === 0,
          rejected: false
        };
      })
    );

    console.log(
      `📋 [obtenerContraofertas] ${ofertas.length} oferta(s) para el viaje ${viajeId}`
    );

    respuesta.status(200).json({
      offers: ofertas,
      rideId: viaje.id,
      originalFare: viaje.finalFare,
      serverClock: { receivedAt: relojRecibidoEn, sentAt: new Date().toISOString() }
    });
  } catch (error) {
    console.error('❌ [obtenerContraofertas] Error:', error);
    respuesta.status(500).json({
      error: 'Error al obtener contra-ofertas',
      details: error.message
    });
  }
};

const aceptarContraOferta = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId } = solicitud.params;
    const { offerId: ofertaId, finalPrice: finalPrecio } = solicitud.body;
    const pasajeroId = solicitud.user.id;

    console.log('✅ [aceptarContraoferta] Aceptando contraoferta:', {
      idViaje: viajeId,
      idOferta: ofertaId,
      precioFinal: finalPrecio
    });

    const { ViajeOferta: RideOffer } = require('../models');

    const viaje = await Viaje.findByPk(viajeId);
    if (!viaje) {
      return respuesta.status(404).json({ error: 'Viaje no encontrado' });
    }

    if (viaje.passengerId !== pasajeroId) {
      return respuesta.status(403).json({ error: 'Este viaje no te pertenece' });
    }

    if (viaje.expiresAt && new Date() > new Date(viaje.expiresAt)) {
      await viaje.update({ status: 'vencido' });
      return respuesta.status(410).json({
        error: 'La solicitud de viaje ha expirado (2 minutos sin respuesta)',
        expiredAt: viaje.expiresAt
      });
    }

    const seleccionadoOferta = await sequelize.transaction(async (transaccion) => {
      const bloqueadoViaje = await Viaje.findByPk(viajeId, { transaction: transaccion, lock: transaccion.LOCK.UPDATE });
      if (bloqueadoViaje.requestMode !== 'negociacion' || !['solicitado', 'ofertado'].includes(bloqueadoViaje.status) || new Date(bloqueadoViaje.expiresAt) <= new Date()) {
        throw Object.assign(new Error('La solicitud ya no está disponible.'), { status: 409 });
      }
      const oferta = await RideOffer.findOne({ where: { id: ofertaId, ride_id: viajeId, status: 'pendiente', expires_at: { [Operador.gt]: new Date() } }, transaction: transaccion });
      if (!oferta) throw Object.assign(new Error('La oferta ya no está disponible.'), { status: 409 });
      await Conductor.findByPk(oferta.driver_id, { transaction: transaccion, lock: transaccion.LOCK.UPDATE });
      await oferta.update({ status: 'aceptado' }, { transaction: transaccion });
      await bloqueadoViaje.update({ driverId: oferta.driver_id, finalFare: Number(oferta.offered_price), status: 'aceptado', acceptedAt: new Date() }, { transaction: transaccion });
      await RideOffer.update({ status: 'rechazado' }, { where: { ride_id: viajeId, status: 'pendiente' }, transaction: transaccion });
      return oferta;
    });

    // Recargar con asociaciones
    const actualizadoViaje = await Viaje.findByPk(viajeId, {
      include: [
      { model: Usuario, as: 'passenger', attributes: { exclude: ['password'] } },
      {
        model: Conductor,
        as: 'driver',
        required: false,
        include: [
        { model: Usuario, as: 'user', attributes: { exclude: ['password'] } }]

      }]

    });

    console.log('✅ [aceptarContraoferta] Contraoferta aceptada:', {
      idViaje: viajeId,
      idOferta: ofertaId,
      id: seleccionadoOferta.driver_id
    });

    // 🔌 Socket: notificar al conductor que su oferta fue aceptada
    try {
      const { Conductor: ConductorModelo } = require('../models');
      const conductorRegistro = await ConductorModelo.findByPk(seleccionadoOferta.driver_id, {
        attributes: ['userId']
      });
      if (conductorRegistro) {
        obtenerIo().to(`user:${conductorRegistro.userId}`).emit('offer:result', {
          rideId: viajeId,
          offerId: ofertaId,
          accepted: true
        });
      }
      obtenerIo().to(`ride:${viajeId}`).emit('ride:status:changed', {
        rideId: viajeId,
        status: 'aceptado',
        timestamp: new Date().toISOString()
      });
    } catch (socketError) {
      console.warn(
        '⚠️ [Socket] acceptCounterOffer emit error:',
        socketError.message
      );
    }

    respuesta.status(200).json({ message: 'Oferta aceptada', ride: actualizadoViaje });
  } catch (error) {
    console.error('❌ [aceptarContraoferta] Error:', error);
    respuesta.status(error.status || (['23505', '23514', '40P01'].includes(error.original?.code) ? 409 : 500)).json({
      error: 'Error al aceptar contra-oferta',
      details: error.message
    });
  }
};

// 🔥 RECHAZAR OFERTA
const rechazarContraOferta = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId } = solicitud.params;
    const { offerId: ofertaId } = solicitud.body;
    const pasajeroId = solicitud.user.id;

    console.log('🚫 [rejectCounterOffer] Rechazando oferta:', {
      rideId: viajeId,
      offerId: ofertaId
    });

    const { ViajeOferta: RideOffer } = require('../models');

    const viaje = await Viaje.findByPk(viajeId);
    if (!viaje) {
      return respuesta.status(404).json({ error: 'Viaje no encontrado' });
    }

    if (viaje.passengerId !== pasajeroId) {
      return respuesta.status(403).json({ error: 'Este viaje no te pertenece' });
    }

    // Marcar la oferta como rechazada en ride_offers
    const actualizado = await RideOffer.update(
      { status: 'rechazado' },
      { where: { id: ofertaId, ride_id: viajeId, status: 'pendiente' } }
    );

    if (!actualizado[0]) {
      return respuesta.
      status(404).
      json({ error: 'Oferta no encontrada o ya procesada' });
    }

    // Si no quedan ofertas pendientes, volver el viaje a 'solicitado'
    const restante = await RideOffer.count({
      where: { ride_id: viajeId, status: 'pendiente' }
    });
    if (restante === 0 && viaje.status === 'ofertado') {
      await viaje.update({ status: 'solicitado' });
    }

    console.log('✅ [rejectCounterOffer] Oferta rechazada:', {
      rideId: viajeId,
      offerId: ofertaId
    });

    // 🔌 Socket: notificar al conductor que su oferta fue rechazada
    try {
      const {
        ViajeOferta: ViajeOfertaModelo,
        Conductor: ConductorModelo
      } = require('../models');
      const ofertaRegistro = await ViajeOfertaModelo.findByPk(ofertaId, {
        attributes: ['driver_id']
      });
      if (ofertaRegistro) {
        const conductorRegistro = await ConductorModelo.findByPk(ofertaRegistro.driver_id, {
          attributes: ['userId']
        });
        if (conductorRegistro) {
          obtenerIo().to(`user:${conductorRegistro.userId}`).emit('offer:result', {
            rideId: viajeId,
            offerId: ofertaId,
            accepted: false
          });
        }
      }
    } catch (socketError) {
      console.warn(
        '⚠️ [Socket] rejectCounterOffer emit error:',
        socketError.message
      );
    }

    respuesta.status(200).json({ message: 'Oferta rechazada', offerId: ofertaId });
  } catch (error) {
    console.error('❌ [rejectCounterOffer] Error:', error);
    respuesta.status(500).json({
      error: 'Error al rechazar contra-oferta',
      details: error.message
    });
  }
};

/**
 * PUT /viajes/:rideId/cancelar
 *
 * Reglas:
 *  - Solo se puede cancelar en estados: requested | offered | accepted
 *  - El pasajero puede cancelar en cualquiera de esos estados
 *  - El conductor solo puede cancelar si ya aceptó (accepted o arrived)
 *  - Se valida cancellationReasonId contra la tabla cancellation_reasons
 *  - Si el viaje tenía ofertas pendientes, se rechazan todas
 */
const cancelarViaje = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId } = solicitud.params;
    const { cancellationReasonId: cancelacionMotivoId, cancelledBy: solicitudCanceladoPor } = solicitud.body;
    const usuarioId = solicitud.user.id;

    // ── Cargar el viaje ───────────────────────────────────────────────────
    const viaje = await Viaje.findByPk(viajeId);
    if (!viaje) {
      return respuesta.status(404).json({ error: 'Viaje no encontrado.' });
    }

    if (viaje.requestMode === 'asignacion_rapida' && viaje.status === 'solicitado') {
      return require("./rapidaAsignacionControlador").cancelar(solicitud, respuesta);
    }

    // ── Verificar estado cancelable ───────────────────────────────────────
    // Si ya está cancelado o expirado, responder OK (idempotente)
    if (viaje.status === 'cancelado' || viaje.status === 'vencido') {
      return respuesta.status(200).json({
        message: 'El viaje ya estaba cancelado.',
        rideId: viaje.id,
        status: viaje.status
      });
    }

    const cancelableEstados = [
    'solicitado',
    'ofertado',
    'aceptado',
    'llegado',
    'en_curso'];

    if (!cancelableEstados.includes(viaje.status)) {
      return respuesta.status(400).json({
        error: `No se puede cancelar un viaje en estado '${viaje.status}'.`,
        estadosPermitidos: cancelableEstados
      });
    }

    // ── Determinar quién cancela ──────────────────────────────────────────
    let canceladoPor = null;

    if (viaje.passengerId === usuarioId) {
      if (viaje.status === 'en_curso' && solicitudCanceladoPor !== 'sistema') {
        return respuesta.status(400).json({
          error: 'El pasajero no puede cancelar un viaje que ya está en curso.'
        });
      }
      canceladoPor = solicitudCanceladoPor === 'sistema' ? 'sistema' : 'pasajero';
    } else {
      // Verificar si es el conductor asignado
      const conductor = await Conductor.findOne({ where: { userId: usuarioId } });
      if (conductor && viaje.driverId === conductor.id) {
        if (!['aceptado', 'llegado', 'en_curso'].includes(viaje.status)) {
          return respuesta.status(400).json({
            error:
            'El conductor solo puede cancelar un viaje que ya aceptó, llegó o está en curso.'
          });
        }
        canceladoPor = 'conductor';
      }
    }

    if (!canceladoPor) {
      return respuesta.status(403).json({
        error: 'No estás autorizado para cancelar este viaje.'
      });
    }

    // ── Validar razón de cancelación ──────────────────────────────────────
    if (cancelacionMotivoId) {
      const { CancelacionMotivo: CancelacionMotivo } = require('../models');
      const motivo = await CancelacionMotivo.findByPk(cancelacionMotivoId);

      if (!motivo || !motivo.is_active) {
        return respuesta.status(400).json({
          error: 'Razón de cancelación inválida o inactiva.'
        });
      }

      // Verificar que la razón aplica al rol
      if (
      motivo.applicable_to !== 'ambos' &&
      motivo.applicable_to !== canceladoPor)
      {
        return respuesta.status(400).json({
          error: `Esta razón de cancelación solo aplica para '${motivo.applicable_to}', no para '${canceladoPor}'.`
        });
      }
    }

    // ── Rechazar todas las ofertas pendientes del viaje ───────────────────
    const { ViajeOferta: RideOffer } = require('../models');
    const rechazadoCantidad = await RideOffer.update(
      { status: 'cancelado' },
      { where: { ride_id: viajeId, status: 'pendiente' } }
    );
    if (rechazadoCantidad[0] > 0) {
      console.log(
        `📋 [cancelRide] ${rechazadoCantidad[0]} oferta(s) canceladas para ride ${viajeId}`
      );
    }

    // ── Cancelar el viaje ─────────────────────────────────────────────────
    const anteriorEstado = viaje.status; // guardar antes de que update() lo cambie
    await viaje.update({
      status: 'cancelado',
      cancelledBy: canceladoPor,
      cancelledAt: new Date(),
      cancellation_reason_id: cancelacionMotivoId ?? null
    });

    console.log(`🚫 [cancelRide] Viaje ${viajeId} cancelado por ${canceladoPor}`);

    // ── Notificar a la otra parte ─────────────────────────────────────────
    const { notificarViajeCancelado: notificarViajeCancelado } = require("../services/notificacionServicio");
    if (canceladoPor === 'pasajero' && viaje.driverId) {
      // Notificar al conductor que el pasajero canceló
      const { Conductor: ConductorModelo } = require('../models');
      const conductorRegistro = await ConductorModelo.findByPk(viaje.driverId, {
        attributes: ['userId']
      });
      if (conductorRegistro)
      notificarViajeCancelado(conductorRegistro.userId, viaje, canceladoPor);
    } else if (canceladoPor === 'conductor') {
      // Notificar al pasajero que el conductor canceló
      notificarViajeCancelado(viaje.passengerId, viaje, canceladoPor);
    }

    // 🔌 Socket: notificar cancelación
    try {
      obtenerIo().to(`ride:${viaje.id}`).emit('ride:status:changed', {
        rideId: viaje.id,
        status: 'cancelado',
        cancelledBy: canceladoPor,
        timestamp: new Date().toISOString()
      });
      // Notificar a TODOS los conductores conectados para que quiten la tarjeta de su lista.
      // Se usa broadcast global porque el room 'drivers:available' puede perder miembros
      // si el socket reconecta. El frontend filtra por rideId así que es seguro.
      if (['solicitado', 'ofertado'].includes(anteriorEstado)) {
        obtenerIo().emit('ride:request:cancelled', {
          rideId: viaje.id
        });
      }
    } catch (socketError) {
      console.warn('⚠️ [Socket] cancelRide emit error:', socketError.message);
    }

    return respuesta.status(200).json({
      message: `Viaje cancelado exitosamente por el ${canceladoPor === 'pasajero' ? 'pasajero' : 'conductor'}.`,

      rideId: viaje.id,
      cancelledBy: canceladoPor,
      status: 'cancelado'
    });
  } catch (error) {
    console.error('❌ [cancelRide] Error:', error.message);
    return respuesta.status(500).json({
      error: 'Error al cancelar el viaje.',
      details: error.message
    });
  }
};

/**
 * GET /api/viajes/motivos-cancelacion
 * Obtener las razones de cancelación activas
 */
const obtenerCancelacionMotivos = async (solicitud, respuesta) => {
  try {
    const { CancelacionMotivo: CancelacionMotivo } = require('../models');
    const { role: rol } = solicitud.query; // 'conductor' o 'pasajero'

    let motivos = await CancelacionMotivo.findAll({
      where: { is_active: true },
      order: [['description', 'ASC']]
    });

    if (rol) {
      motivos = motivos.filter(
        (r) =>
        !r.applicable_to ||
        r.applicable_to === 'ambos' ||
        r.applicable_to === rol
      );
    }

    return respuesta.status(200).json(motivos);
  } catch (error) {
    console.error('❌ [getCancellationReasons] Error:', error.message);
    return respuesta.
    status(500).
    json({ error: 'Error al obtener razones de cancelación' });
  }
};

const obtenerTarifaAjustes = async (solicitud, respuesta) => {
  // Valores por defecto globales
  const PREDETERMINADO_BASE_TARIFA = 12;
  const PREDETERMINADO_TARIFA_POR_KM = 0.5;
  const PREDETERMINADO_TARIFA_POR_MINUTO = 0.58;
  const PREDETERMINADO_CURRENCY = 'BOB';

  try {
    const { lat: latitud, lng: longitud } = solicitud.query;
    const latitude = parseFloat(latitud);
    const longitude = parseFloat(longitud);

    console.log(`📍 [tarifas] Solicitud recibida - lat: ${latitud}, lng: ${longitud}`);

    // Si se recibieron coordenadas válidas, consultar PostGIS
    if (!isNaN(latitude) && !isNaN(longitude)) {
      try {
        console.log(`🔍 [tarifas] Consultando zona PostGIS para (${latitude}, ${longitude})...`);
        const [[zona]] = await sequelize.query(
          `SELECT * FROM get_service_area(ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))`,
          { replacements: { lng: longitude, lat: latitude } }
        );
        if (zona?.id) {
          const resultado = {
            baseFare: zona.base_fare ?? PREDETERMINADO_BASE_TARIFA,
            farePerKm: zona.fare_per_km ?? PREDETERMINADO_TARIFA_POR_KM,
            farePerMinute: zona.fare_per_minute ?? PREDETERMINADO_TARIFA_POR_MINUTO,
            currency: zona.currency ?? PREDETERMINADO_CURRENCY,
            zoneId: zona.id,
            zoneName: zona.name
          };
          console.log(`✅ [tarifas] Zona encontrada: "${zona.name}"`);
          console.log(`   💰 Tarifas de zona:`);
          console.log(`     Tarifa base:       Bs ${resultado.baseFare}`);
          console.log(`     Tarifa por km:     Bs ${resultado.farePerKm} / km`);
          console.log(`     Tarifa por minuto: Bs ${resultado.farePerMinute} / min`);
          return respuesta.status(200).json(resultado);
        } else {
          console.log(`⚠️ [tarifas] Coordenadas (${latitude}, ${longitude}) fuera de todas las zonas activas.`);
        }
      } catch (zoneError) {
        // PostGIS no disponible → usar defaults
        console.warn('⚠️ [tarifas] No se pudo consultar la zona:', zoneError.message);
      }
    } else {
      console.log('⚠️ [tarifas] Sin coordenadas válidas → usando tarifas globales por defecto.');
    }

    // Sin coordenadas o fuera de zonas → devolver tarifas globales
    console.log('🌍 [tarifas] Usando tarifas GLOBALES por defecto:');
    console.log(`   Tarifa base:       Bs ${PREDETERMINADO_BASE_TARIFA}`);
    console.log(`   Tarifa por km:     Bs ${PREDETERMINADO_TARIFA_POR_KM} / km`);
    console.log(`   Tarifa por minuto: Bs ${PREDETERMINADO_TARIFA_POR_MINUTO} / min`);
    return respuesta.status(200).json({
      baseFare: PREDETERMINADO_BASE_TARIFA,
      farePerKm: PREDETERMINADO_TARIFA_POR_KM,
      farePerMinute: PREDETERMINADO_TARIFA_POR_MINUTO,
      currency: PREDETERMINADO_CURRENCY,
      zoneId: null,
      zoneName: null
    });
  } catch (error) {
    console.error('Error al obtener configuracion de tarifas:', error);
    respuesta.status(500).json({ error: 'Error al obtener tarifas' });
  }
};

module.exports = {
  obtenerMotivosCancelacion: obtenerCancelacionMotivos,
  crearViaje: crearViaje,
  obtenerViajePorId: obtenerViajePorId,
  obtenerViajeActivo: obtenerActivoViaje,
  obtenerHistorialViajes: obtenerViajeHistorial,
  obtenerSolicitudesViaje: obtenerViajeSolicitudes,
  aceptarViaje: aceptarViaje,
  llegadoViaje: llegadoViaje,
  pasajeroListo: pasajeroListo,
  iniciarViaje: inicioViaje,
  completarViaje: completarViaje,
  cancelarViaje: cancelarViaje,
  enviarContraoferta: enviarContraOferta,
  obtenerContraofertas: obtenerContraOfertas,
  aceptarContraoferta: aceptarContraOferta,
  rechazarContraoferta: rechazarContraOferta,
  obtenerConfiguracionTarifas: obtenerTarifaAjustes
};
