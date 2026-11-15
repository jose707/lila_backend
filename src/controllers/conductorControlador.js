// backend/src/controllers/conductorControlador.js
const Conductor = require("../models/Conductor");
const Vehiculo = require("../models/Vehiculo");
const ConductorSolicitud = require("../models/ConductorSolicitud");
const SolicitudArchivo = require("../models/SolicitudArchivo");
const documentosRepositorio = require('../services/documentosRepositorio');
const fs = require('fs');
const ruta = require('path');

// Crear directorio de uploads si no existe
const subirDirectorio = ruta.join(__dirname, '../uploads/drivers');
if (!fs.existsSync(subirDirectorio)) {
  fs.mkdirSync(subirDirectorio, { recursive: true });
}

/**
 * Register a new driver application
 * POST /conductores/registrar
 */
const registrarConductor = require('./solicitudControlador').registrarConductor;

/**
 * Get driver application status for current user
 * GET /conductores/estado
 */
const obtenerConductorEstado = async (solicitud, respuesta) => {
  try {
    console.log('getDriverStatus called');
    const usuarioId = solicitud.user?.id;
    console.log('User ID:', usuarioId);

    if (!usuarioId) {
      return respuesta.status(401).json({
        error: 'Usuario no autenticado'
      });
    }

    const conductor = await Conductor.findOne({
      where: { userId: usuarioId }
    });

    console.log('Driver found:', conductor ? 'Yes' : 'No');
    if (conductor) {
      console.log('Driver status:', conductor.status);
    }

    if (!conductor) {
      const recienteSolicitud = await ConductorSolicitud.findOne({
        where: { userId: usuarioId }, order: [['version', 'DESC']]
      });
      return respuesta.status(200).json({
        hasApplication: !!recienteSolicitud,
        status: recienteSolicitud?.status || null,
        driver: null,
        request: recienteSolicitud ? { id: recienteSolicitud.id, version: recienteSolicitud.version,
          status: recienteSolicitud.status, rejectionReason: recienteSolicitud.rejectionReason } : null
      });
    }

    // Obtener datos del vehículo (incluye estado RUAT)
    const vehiculo = await Vehiculo.findOne({ where: { driver_id: conductor.id } });
    const [ruatDocumento, documentos] = await Promise.all([
      vehiculo ? require('./documentosRenovacionControlador').latestVehicleFile(vehiculo.id, 'ruatPhoto') : null,
      documentosRepositorio.select(`
        (SELECT 'licencia' AS tipo, l.fecha_vencimiento AS vencimiento, l.fecha_emision_detectada AS inicio
         FROM public.conductor_documento cd
         JOIN public.documento d USING (id_documento)
         LEFT JOIN public.documento_licencia l ON l.id_documento_licencia = d.id_documento
         WHERE cd.id_conductor = :conductorId AND d.tipo_documento = 'licenseFront'
           AND d.vigente AND d.estado_verificacion = 'verificado'
         ORDER BY d.creado_en DESC, d.id_documento DESC LIMIT 1)
        UNION ALL
        (SELECT 'soat' AS tipo, s.fecha_vencimiento AS vencimiento, s.fecha_inicio AS inicio
         FROM public.vehiculo_documento vd
         JOIN public.documento d USING (id_documento)
         LEFT JOIN public.documento_soat s ON s.id_documento_soat = d.id_documento
         WHERE vd.id_vehiculo = :vehiculoId AND d.tipo_documento = 'soatPhoto'
           AND d.vigente AND d.estado_verificacion = 'verificado'
         ORDER BY d.creado_en DESC, d.id_documento DESC LIMIT 1)
      `, { conductorId: conductor.id, vehiculoId: vehiculo?.id ?? null })
    ]);
    const documentosVerificados = { licencia: null, soat: null };
    for (const { tipo, vencimiento, inicio } of documentos) {
      documentosVerificados[tipo] = { vencimiento, inicio };
    }

    // Usuario tiene solicitud
    respuesta.status(200).json({
      hasApplication: true,
      status: conductor.status,
      driver: {
        id: conductor.id,
        status: conductor.status,
        licenseNumber: conductor.licenseNumber,
        vehicleType: conductor.vehicleType,
        vehiclePlate: conductor.vehiclePlate,
        rejectionReason: conductor.rejectionReason,
        documents: conductor.documents,
        documentosVerificados,
        createdAt: conductor.createdAt,
        vehicle: vehiculo ?
        {
          id: vehiculo.id,
          model: vehiculo.model,
          plate: vehiculo.plate,
          ruatFile: ruatDocumento?.status !== 'rechazado' ?
          ruatDocumento?.filename || null : null,
          ruatStatus: ruatDocumento?.status || null,
          ruatVerified: vehiculo.ruatVerified,
          ruatVerifiedAt: vehiculo.ruatVerifiedAt,
        } :
        null
      }
    });
  } catch (error) {
    console.error('Error getting driver status:', error);
    respuesta.status(500).json({
      error: 'Error al obtener estado de solicitud'
    });
  }
};

/**
 * Resubmit rejected documents
 * POST /conductores/reenviar
 */
const resubmitDocumentos = require('./solicitudControlador').reenviarDocumentos;

/**
 * 📍 Actualizar ubicación del conductor en tiempo real
 * PUT /conductores/location
 */
const actualizarConductorUbicacion = async (solicitud, respuesta) => {
  try {
    const usuarioId = solicitud.user?.id;
    const { latitude: latitud, longitude: longitud } = solicitud.body;

    console.log('📍 [updateDriverLocation] Actualizando ubicación:', {
      userId: usuarioId,
      latitude: latitud,
      longitude: longitud
    });

    if (!usuarioId) {
      return respuesta.status(401).json({
        error: 'Usuario no autenticado'
      });
    }

    if (!latitud || !longitud) {
      return respuesta.status(400).json({
        error: 'Debe proporcionar latitude y longitude'
      });
    }

    // Encontrar el conductor asociado al usuario
    const conductor = await Conductor.findOne({
      where: { userId: usuarioId }
    });

    if (!conductor) {
      return respuesta.status(404).json({
        error: 'Conductor no encontrado'
      });
    }

    // Guardar ubicación en driver_locations (upsert: crea o actualiza)
    const ConductorUbicacion = require("../models/ConductorUbicacion");
    await ConductorUbicacion.upsert({
      driver_id: conductor.id,
      location: {
        type: 'Point',
        coordinates: [parseFloat(longitud), parseFloat(latitud)]
      },
      is_online: true
    });

    console.log('✅ [updateDriverLocation] Ubicación actualizada:', {
      driverId: conductor.id,
      latitude: latitud,
      longitude: longitud
    });

    respuesta.json({
      message: 'Ubicación actualizada exitosamente',
      driver: {
        id: conductor.id,
        currentLocation: {
          latitude: parseFloat(latitud),
          longitude: parseFloat(longitud)
        }
      }
    });
  } catch (error) {
    console.error('❌ [updateDriverLocation] Error:', error);
    respuesta.status(500).json({
      error: 'Error al actualizar ubicación',
      details: error.message
    });
  }
};

/**
 * Conductor sube su RUAT para verificación del vehículo
 * POST /conductores/enviar-ruat
 */
const enviarRuat = (...args) => require('./documentosRenovacionControlador').enviar(...args);
module.exports = {
  registrarConductor: registrarConductor,
  obtenerConductorEstado: obtenerConductorEstado,
  reenviarDocumentos: resubmitDocumentos,
  actualizarConductorUbicacion: actualizarConductorUbicacion,
  enviarRuat: enviarRuat
};
