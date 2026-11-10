const { origenesAdjuntos } = require('../services/documentosRepositorio');
const { saveMetadata } = require('../services/solicitudDocumentos');
// backend/src/controllers/solicitudControlador.js
const ConductorSolicitud = require("../models/ConductorSolicitud");
const ConductorDomicilio = require("../models/ConductorDomicilio");
const sequelize = require("../config/baseDatos");
const SolicitudArchivo = require("../models/SolicitudArchivo");
const Usuario = require("../models/Usuario");
const UsuarioIdentidad = require("../models/UsuarioIdentidad");
const Conductor = require('../models/Conductor');
const fs = require('fs/promises');
const ruta = require('path');
const sharp = require('sharp');
const ocrServicio = require("../services/servicioOcr");
const { resolverEmisionLicencia } = require("../services/licenseValidacion");
const { recorteParaOcr, recorteAFotograma } = require("../services/documentoRecorte");
const { CONDUCTOR_OCR_DOCUMENTOS: CONDUCTOR_OCR_DOCUMENTS, guardarImagenesConductor } = require("../services/conductorOcrImage");

const REQUERIDO_CONDUCTOR_DOCUMENTS = [
'licenseFront', 'licenseBack', 'ticPhoto',
'antecedentsPhoto', 'carFront', 'carBack',
'soatPhoto', 'ruatPhoto',
'domicileProof'];


const activoOcrSolicitudes = new Set();

// La captura no es una aprobación: guardamos incluso lecturas incompletas para revisión.
const leerEnviadoDocumentos = async (archivos) => {
  const entradas = await Promise.all([...CONDUCTOR_OCR_DOCUMENTS].map(async (tipo) => {
    const archivo = archivos?.[tipo]?.[0];
    if (!archivo) return null;
    const iniciadoEn = Date.now();
    try {
      const imagen = await fs.readFile(archivo.path);
      const leer = await ocrServicio.extraerDocumento(imagen, tipo);
      console.log(`[OCR] ${tipo} completado en ${Date.now() - iniciadoEn}ms`);
      return [tipo, {
        fields: leer.fields || {},
        text: leer.rawText || '',
        missing: leer.missing || []
      }, false];
    } catch (error) {
      console.error(`OCR de ${tipo} falló:`, error);
      return [tipo, { fields: {}, text: '', missing: [] }, true];
    }
  }));
  const resultados = entradas.filter(Boolean);
  return {ocr: Object.fromEntries(resultados.map(([tipo, lectura]) => [tipo, lectura])),
    fallido: resultados.some(([, , fallo]) => fallo)};
};

const validoDomicilio = (direccion, latitud, longitud) => {
  const lat = Number(latitud);
  const lng = Number(longitud);
  return typeof direccion === 'string' && direccion.trim().length >= 8 && direccion.trim().length <= 255 &&
  String(latitud ?? '').trim() !== '' && String(longitud ?? '').trim() !== '' &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
};

/**
 * Preprocesa la imagen para OCR: blanco y negro + estiramiento de contraste.
 * Vision lee mejor en escala de grises con contraste normalizado.
 */
async function preprocessParaOcr(buffer) {
  try {
    return await sharp(buffer).grayscale().normalize().toBuffer();
  } catch (error) {
    console.warn('No se pudo preprocesar la imagen para OCR:', error.message);
    return buffer;
  }
}

const metadatosDesdeOcr = (ocr) => {
  const licencia = ocr.licenseFront?.fields || {};
  const ruat = ocr.ruatPhoto?.fields || {};
  const soat = ocr.soatPhoto?.fields || {};
  const vehiculoTipo = String(ruat.vehicleType || '').toLowerCase();
  return {
    vehicleType: ['taxi', 'minibus', 'bus', 'motocicleta'].includes(vehiculoTipo) ? vehiculoTipo : null,
    vehiclePlate: ruat.vehiclePlate || null,
    vehicleYear: ruat.vehicleYear || null,
    vehicleColor: ruat.vehicleColor || null,
    vehiclePassengerCapacity: ruat.vehiclePassengerCapacity || null,
    vehicleBrand: ruat.vehicleBrand || null,
    vehicleModel: ruat.vehicleModel || null,
    registrationMunicipality: ruat.registrationMunicipality || null,
    crpvaNumber: ruat.crpvaNumber || null,
    ruatIssueDate: ruat.ruatIssueDate || null,
    ownershipStartDate: ruat.ownershipStartDate || null,
    doorCount: ruat.doorCount || null,
    serviceType: ruat.serviceType || null,
    chassisNumber: ruat.chassisNumber || null,
    engineNumber: ruat.engineNumber || null,
    fuelType: ruat.fuelType || null,
    engineDisplacement: ruat.engineDisplacement || null,
    engineType: ruat.engineType || null,
    legalObservations: ruat.legalObservations || null,
    licenseExpiryDate: licencia.licenseExpiryDate || null,
    licenseCategory: licencia.licenseCategory || null,
    licenseNumber: licencia.licenseNumber || null,
    licenseIssueDate: resolverEmisionLicencia(licencia, ocr.licenseBack?.fields) || null,
    licenseNationality: licencia.nationality || null,
    soatRosetteNumber: soat.soatRosetteNumber || null,
    soatStartDate: soat.soatStartDate || null,
    soatExpiryDate: soat.soatExpiryDate || null,
    soatUse: soat.soatUse || null
  };
};

const procesarConductorSolicitudOcr = async (solicitudId) => {
  if (activoOcrSolicitudes.has(solicitudId)) return;
  activoOcrSolicitudes.add(solicitudId);
  try {
    const registros = await SolicitudArchivo.findAll({ where: { requestId: solicitudId } });
    const archivos = {};
    for (const registro of registros) {
      if (!CONDUCTOR_OCR_DOCUMENTS.has(registro.fileType)) continue;
      archivos[registro.fileType] = [{
        path: ruta.join(__dirname, '../uploads/drivers', ruta.basename(registro.filename))
      }];
    }
    const {ocr, fallido} = await leerEnviadoDocumentos(archivos);
    const patch = {
      ...metadatosDesdeOcr(ocr),
      ocr,
      ocrProcessingStatus: fallido ? 'fallido' : 'complete',
      ocrProcessedAt: new Date().toISOString()
    };
    await saveMetadata(solicitudId, patch);
  } catch (error) {
    console.error(`No se pudo procesar OCR para solicitud ${solicitudId}:`, error);
    try {
      await ConductorSolicitud.update({ocrProcessingStatus:'fallido',ocrProcessedAt:new Date()}, {where:{id:solicitudId}});
    } catch (persistenciaError) {
      console.error('No se pudo registrar el fallo de OCR:', persistenciaError);
    }
  } finally {
    activoOcrSolicitudes.delete(solicitudId);
  }
};

const reanudarPendienteConductorOcr = async () => {
  const [solicitudes] = await sequelize.query(
    "SELECT id FROM solicitud_conductor WHERE estado_ocr = 'pendiente'"
  );
  await Promise.all(solicitudes.map(solicitud => procesarConductorSolicitudOcr(solicitud.id)));
};

/**
 * Extrae datos de una imagen de documento usando OCR.
 * POST /solicitudes/extraer-ocr  (multipart: image + documentType + recorte opcional)
 */
const extraerDocumento = async (solicitud, respuesta) => {
  try {
    const documentoTipo = solicitud.body && solicitud.body.documentType;
    if (!Object.prototype.hasOwnProperty.call(ocrServicio.REQUERIDOS_POR_TIPO, documentoTipo)) {
      return respuesta.status(400).json({
        error: 'Se requiere el campo "documentType".'
      });
    }
    if (!solicitud.file) {
      return respuesta.status(400).json({ error: 'No se recibió ninguna imagen.' });
    }


    // Geometría del molde de la cámara (si el cliente la envió)
    let recorteRectangulo = null;
    if (solicitud.body) {
      const vals = [
      'cropX',
      'cropY',
      'cropW',
      'cropH',
      'cropScreenW',
      'cropScreenH'].
      map((f) => parseFloat(solicitud.body[f]));
      if (vals.every((v, indice) => Number.isFinite(v) && (indice < 2 ? v >= 0 : v > 0))) {
        recorteRectangulo = {
          x: vals[0],
          y: vals[1],
          w: vals[2],
          h: vals[3],
          screenW: vals[4],
          screenH: vals[5]
        };
        const outside =
        recorteRectangulo.x + recorteRectangulo.w > recorteRectangulo.screenW * 1.05 ||
        recorteRectangulo.y + recorteRectangulo.h > recorteRectangulo.screenH * 1.05;
        if (outside) recorteRectangulo = null;
      }
    }
    const wantRecorte =
    recorteRectangulo ||
    solicitud.body && (
    solicitud.body.crop === '1' || solicitud.body.crop === 'true' || solicitud.body.crop === true);

    let buffer = solicitud.file.buffer;
    // Rotate based on EXIF orientation so the image is upright for OCR.
    // Sharp's .rotate() reads the EXIF 'orientation' tag and applies the
    // correct transformation (90°, 270°, or flip) before any further processing.
    buffer = await sharp(buffer, { limitInputPixels: 24000000 }).rotate().toBuffer();
    if (documentoTipo === 'licenseFront' || documentoTipo === 'licenseBack') {
      if (wantRecorte) {
        try {
          buffer = await recorteAFotograma(buffer, recorteRectangulo, 0.05);
        } catch (error) {
          console.warn('No se pudo recortar la licencia para OCR:', error.message);
        }
      }
    } else {
      if (wantRecorte) buffer = await recorteParaOcr(buffer, recorteRectangulo, 0.05);
      buffer = await preprocessParaOcr(buffer);
    }
    buffer = await sharp(buffer).png().toBuffer();

    // Vista previa (reducida) de exactamente lo que se envía a Vision
    let vistaPreviaBase64 = '';
    try {
      const vistaPrevia = await sharp(buffer).
      resize({ width: 480, withoutEnlargement: true }).
      jpeg({ quality: 70 }).
      toBuffer();
      vistaPreviaBase64 = `data:image/jpeg;base64,${vistaPrevia.toString('base64')}`;
    } catch (error) {
      console.warn('No se pudo generar la vista previa:', error.message);
    }

    const { fields: campos, rawText: brutoTexto, missing: faltante, facesFound: rostrosEncontrado, rejected: rechazado, rejectReason: rechazarMotivo, words: palabras, classify: clasificar } =
    await ocrServicio.extraerDocumento(buffer, documentoTipo);

    if (rechazado && (documentoTipo === 'ciFront' || documentoTipo === 'ciBack')) {
      console.log(
        `[OCR] ${documentoTipo} rechazado. Clasificación:`,
        JSON.stringify(clasificar)
      );
    }

    respuesta.json({
      documentType: documentoTipo,
      fields: campos,
      rawText: brutoTexto,
      missing: faltante,
      facesFound: rostrosEncontrado,
      rejected: rechazado,
      rejectReason: rechazarMotivo,
      words: palabras,
      classify: clasificar,
      previewBase64: vistaPreviaBase64
    });
  } catch (error) {
    console.error('Error extracting document:', error.name);
    respuesta.status(error.status || 500).json({
      error: error.status ? error.message : 'No se pudo analizar la imagen. Intenta una nueva captura.'
    });
  }
};

/**
 * Register a new driver - creates first DriverRequest
 * POST /solicitudes/registrar
 */
const registrarConductor = async (solicitud, respuesta) => {
  try {
    console.log('Driver registration request received');
    console.log(
      'Files received:',
      solicitud.files ? Object.keys(solicitud.files) : 'NO FILES'
    );
    const usuarioId = solicitud.user?.id;
    if (!usuarioId) {
      return respuesta.status(401).json({ error: 'Usuario no autenticado' });
    }
    const anteriorSolicitud = await ConductorSolicitud.findOne({ where: { userId: usuarioId }, order: [['version', 'DESC']] });
    if (anteriorSolicitud) {
      return respuesta.status(409).json({ error: 'Ya tienes una solicitud. Consulta su estado o reenvía los documentos observados.' });
    }

    const { domicileAddress: domicilioDireccion, domicileLatitude: domicilioLatitud, domicileLongitude: domicilioLongitud } = solicitud.body;

    const identidad = await UsuarioIdentidad.findOne({ where: { userId: usuarioId } });
    if (!identidad || identidad.verificationStatus !== 'verificado') {
      return respuesta.status(400).json({ error: 'Debes verificar tu identidad con la cédula antes de solicitar ser conductor.' });
    }
    const enviadoTipos = new Set(Object.keys(solicitud.files || {}).filter((tipo) => solicitud.files[tipo]?.[0]));
    const faltanteArchivos = REQUERIDO_CONDUCTOR_DOCUMENTS.filter((tipo) => !enviadoTipos.has(tipo));
    if (faltanteArchivos.length) return respuesta.status(422).json({ error: `Faltan documentos obligatorios: ${faltanteArchivos.join(', ')}.` });
    if (!validoDomicilio(domicilioDireccion, domicilioLatitud, domicilioLongitud)) {
      return respuesta.status(422).json({ error: 'Indica una dirección y marca el domicilio en el mapa.' });
    }

    const origenes = origenesAdjuntos(solicitud.body, solicitud.files);
    // Guardar primero fotos y solicitud; el OCR no retrasa la respuesta al móvil.
    const request = await sequelize.transaction(async (transaccion) => {
      // Serializar registros del mismo usuario antes de comprobar duplicados.
      const usuario = await Usuario.findByPk(usuarioId, {
        transaction: transaccion, lock: transaccion.LOCK.UPDATE
      });
      if (!usuario) throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });
      const conductor = await Conductor.findOne({
        where: { userId: usuarioId }, paranoid: false, transaction: transaccion
      });
      if (conductor) throw Object.assign(new Error('Ya tienes un perfil de conductor.'), { status: 409 });
      const existente = await ConductorSolicitud.findOne({
        where: { userId: usuarioId }, transaction: transaccion
      });
      if (existente) throw Object.assign(new Error('Ya tienes una solicitud de conductor.'), { status: 409 });
      await guardarImagenesConductor(solicitud.files, solicitud.body);
      const creadoSolicitud = await ConductorSolicitud.create({
        userId: usuarioId,
        version: 1,
        status: 'pendiente',
        metadata: { ocr: {}, ocrProcessingStatus: 'pendiente' }
      }, { transaction: transaccion });
      await ConductorDomicilio.create({
        userId: usuarioId,
        driverRequestId: creadoSolicitud.id,
        address: domicilioDireccion.trim(),
        location: { type: 'Point', coordinates: [Number(domicilioLongitud), Number(domicilioLatitud)] }
      }, { transaction: transaccion });
      for (const campo of REQUERIDO_CONDUCTOR_DOCUMENTS) {
        const archivo = solicitud.files[campo][0];
        await SolicitudArchivo.create({
          requestId: creadoSolicitud.id,
          userId: usuarioId,
          fileType: campo,
          evidenceOrigin: origenes[campo],
          filename: archivo.filename,
          mimeType: archivo.mimetype,
          status: 'pendiente'
        }, { transaction: transaccion });
      }
      await saveMetadata(creadoSolicitud.id, creadoSolicitud.metadata || {}, transaccion);
      return creadoSolicitud;
    });

    respuesta.status(201).json({
      message: 'Solicitud enviada para revisión administrativa.',
      request: {
        id: request.id,
        version: request.version,
        status: request.status
      }
    });
    setImmediate(() => procesarConductorSolicitudOcr(request.id));
  } catch (error) {
    console.error('Error registering driver:', error);
    respuesta.status(error.status || 500).json({
      error: 'Error al crear solicitud de conductor: ' + error.message
    });
  }
};

/**
 * Get current driver request status
 * GET /solicitudes/estado
 */
const obtenerSolicitudEstado = async (solicitud, respuesta) => {
  try {
    const usuarioId = solicitud.user?.id;
    if (!usuarioId) {
      return respuesta.status(401).json({ error: 'Usuario no autenticado' });
    }

    // Buscar la solicitud más reciente por userId (nuevo sistema)
    const recienteSolicitud = await ConductorSolicitud.findOne({
      where: { userId: usuarioId },
      order: [['version', 'DESC']]
    });

    if (!recienteSolicitud) {
      return respuesta.status(200).json({
        hasApplication: false,
        status: null
      });
    }

    // Get files for this request
    const archivos = await SolicitudArchivo.findAll({
      where: { requestId: recienteSolicitud.id }
    });

    const documentos = {};
    archivos.forEach((archivo) => {
      const BASE_URL =
      process.env.API_BASE_URL ||
      `http://localhost:${process.env.PORT || 3000}`;
      documentos[archivo.fileType] = {
        filename: archivo.filename,
        url: `${BASE_URL}/archivos/conductores/${archivo.filename}`,
        status: archivo.status,
        uploadedAt: archivo.uploadedAt
      };
    });

    respuesta.status(200).json({
      hasApplication: true,
      status: recienteSolicitud.status,
      request: {
        id: recienteSolicitud.id,
        version: recienteSolicitud.version,
        status: recienteSolicitud.status,
        rejectionReason: recienteSolicitud.rejectionReason,
        rejectedDocuments: recienteSolicitud.rejectedDocuments || [],
        metadata: recienteSolicitud.metadata || {},
        documents: documentos,
        createdAt: recienteSolicitud.createdAt
      }
    });
  } catch (error) {
    console.error('Error getting request status:', error);
    respuesta.status(500).json({
      error: 'Error al obtener estado de solicitud'
    });
  }
};

/**
 * Resubmit documents - creates new DriverRequest version
 * POST /solicitudes/reenviar
 */
const resubmitDocumentos = async (solicitud, respuesta) => {
  try {
    console.log('Document resubmission request received');
    const usuarioId = solicitud.user?.id;
    if (!usuarioId) {
      return respuesta.status(401).json({ error: 'Usuario no autenticado' });
    }

    // Get latest request by userId (nuevo sistema)
    const recienteSolicitud = await ConductorSolicitud.findOne({
      where: { userId: usuarioId },
      order: [['version', 'DESC']]
    });

    if (!recienteSolicitud) {
      return respuesta.status(404).json({
        error: 'No hay solicitud de conductor para reenviar'
      });
    }

    if (!['observado', 'rechazado'].includes(recienteSolicitud.status)) {
      return respuesta.status(400).json({
        error: 'Solo se pueden reenviar documentos de solicitudes observadas o rechazadas anteriores'
      });
    }
    if (recienteSolicitud.status === 'rechazado' && !(recienteSolicitud.rejectedDocuments || []).length) {
      return respuesta.status(403).json({ error: 'La solicitud fue rechazada definitivamente y no puede reenviarse.' });
    }

    const carasLicencia = ['licenseFront', 'licenseBack'];
    const requiereLicencia = carasLicencia.some(cara =>
      (recienteSolicitud.rejectedDocuments || []).includes(cara) || solicitud.files?.[cara]?.[0]
    );
    if (requiereLicencia && carasLicencia.some(cara => !solicitud.files?.[cara]?.[0])) {
      return respuesta.status(422).json({ error: 'Envía ambas caras de la licencia de conducir.' });
    }

    const origenes = origenesAdjuntos(solicitud.body, solicitud.files);
    const actualizadoMetadatos = { ...(recienteSolicitud.metadata || {}) };
    if (solicitud.files?.domicileProof?.[0]) {
      if (!validoDomicilio(solicitud.body.domicileAddress, solicitud.body.domicileLatitude, solicitud.body.domicileLongitude)) {
        return respuesta.status(422).json({ error: 'Indica una dirección válida y marca el domicilio en el mapa.' });
      }
      actualizadoMetadatos.domicile = {
        address: solicitud.body.domicileAddress.trim(),
        latitude: Number(solicitud.body.domicileLatitude),
        longitude: Number(solicitud.body.domicileLongitude)
      };
    }

    const actualizadoOcr = { ...(actualizadoMetadatos.ocr || {}) };
    await guardarImagenesConductor(solicitud.files, solicitud.body);
    const {ocr: nuevasLecturas, fallido} = await leerEnviadoDocumentos(solicitud.files);
    Object.assign(actualizadoOcr, nuevasLecturas);
    if (Object.keys(nuevasLecturas).length) {
      actualizadoMetadatos.ocrProcessingStatus = fallido ? 'fallido' : 'complete';
      actualizadoMetadatos.ocrProcessedAt = new Date().toISOString();
    }
    actualizadoMetadatos.ocr = actualizadoOcr;
    if (solicitud.files?.licenseFront?.[0] || solicitud.files?.licenseBack?.[0]) {
      const frontal = actualizadoOcr.licenseFront?.fields || {};
      Object.assign(actualizadoMetadatos, {
        licenseNumber: frontal.licenseNumber || null,
        licenseExpiryDate: frontal.licenseExpiryDate || null,
        licenseCategory: frontal.licenseCategory || null,
        licenseIssueDate: resolverEmisionLicencia(frontal, actualizadoOcr.licenseBack?.fields) || null,
        licenseNationality: frontal.nationality || null
      });
    }
    if (solicitud.files?.ruatPhoto?.[0]) {
      const ruat = actualizadoOcr.ruatPhoto?.fields || {};
      const vehiculoTipo = String(ruat.vehicleType || '').toLowerCase();
      Object.assign(actualizadoMetadatos, {
        vehicleType: ['taxi', 'minibus', 'bus', 'motocicleta'].includes(vehiculoTipo) ? vehiculoTipo : null,
        vehiclePlate: ruat.vehiclePlate || null,
        vehicleBrand: ruat.vehicleBrand || null,
        vehicleModel: ruat.vehicleModel || null,
        vehicleYear: ruat.vehicleYear || null,
        vehicleColor: ruat.vehicleColor || null,
        vehiclePassengerCapacity: ruat.vehiclePassengerCapacity || null
      });
    }
    if (solicitud.files?.soatPhoto?.[0]) {
      const soat = actualizadoOcr.soatPhoto?.fields || {};
      Object.assign(actualizadoMetadatos, {
        soatRosetteNumber: soat.soatRosetteNumber || null,
        soatStartDate: soat.soatStartDate || null,
        soatExpiryDate: soat.soatExpiryDate || null,
        soatUse: soat.soatUse || null
      });
    }

    const anteriorDomicilio = await ConductorDomicilio.findOne({ where: { driverRequestId: recienteSolicitud.id } });
    const siguienteDomicilio = actualizadoMetadatos.domicile || (anteriorDomicilio?.location?.coordinates ?
    {
      address: anteriorDomicilio.address,
      longitude: anteriorDomicilio.location.coordinates[0],
      latitude: anteriorDomicilio.location.coordinates[1]
    } :
    null);
    if (siguienteDomicilio && !validoDomicilio(siguienteDomicilio.address, siguienteDomicilio.latitude, siguienteDomicilio.longitude)) {
      return respuesta.status(422).json({ error: 'El domicilio anterior no es válido. Solicita corregirlo antes de reenviar.' });
    }
    if (solicitud.files?.domicileProof?.[0] && !siguienteDomicilio) {
      return respuesta.status(422).json({ error: 'Falta el domicilio corregido.' });
    }
    delete actualizadoMetadatos.domicile;

    // La nueva versión y todos sus archivos se guardan juntos o se revierten juntos.
    const nuevoSolicitud = await sequelize.transaction(async transaccion => {
      await Usuario.findByPk(usuarioId, { transaction: transaccion, lock: transaccion.LOCK.UPDATE });
      const actual = await ConductorSolicitud.findOne({
        where: { userId: usuarioId }, order: [['version', 'DESC']],
        transaction: transaccion, lock: transaccion.LOCK.UPDATE
      });
      if (actual?.id !== recienteSolicitud.id || !['observado', 'rechazado'].includes(actual.status)) {
        throw Object.assign(new Error('La solicitud cambió. Consulta su estado antes de reenviar.'), { status: 409 });
      }
      const anteriores = await SolicitudArchivo.findAll({
        where: { requestId: actual.id, status: 'verificado' }, transaction: transaccion
      });
      const faltantes = REQUERIDO_CONDUCTOR_DOCUMENTS.filter(tipo =>
        !solicitud.files?.[tipo]?.[0] && !anteriores.some(archivo => archivo.fileType === tipo));
      if (faltantes.length) {
        throw Object.assign(new Error('Faltan documentos por reenviar: ' + faltantes.join(', ')), { status: 422 });
      }
      const creadoSolicitud = await ConductorSolicitud.create({
        userId: usuarioId,
        version: actual.version + 1,
        status: 'pendiente',
        metadata: actualizadoMetadatos
      }, { transaction: transaccion });
      if (siguienteDomicilio && solicitud.files?.domicileProof?.[0]) {
        await ConductorDomicilio.create({
          userId: usuarioId, driverRequestId: creadoSolicitud.id,
          address: siguienteDomicilio.address,
          location: { type: 'Point', coordinates: [Number(siguienteDomicilio.longitude), Number(siguienteDomicilio.latitude)] }
        }, { transaction: transaccion });
      }
      const tipos = new Set([...REQUERIDO_CONDUCTOR_DOCUMENTS, ...Object.keys(solicitud.files || {}),
        ...anteriores.map(archivo => archivo.fileType)]);
      for (const tipo of tipos) {
        const nuevo = solicitud.files?.[tipo]?.[0];
        const anterior = anteriores.find(archivo => archivo.fileType === tipo);
        if (!nuevo && !anterior) continue;
        if (!nuevo && anterior) {
          await require('../services/documentosRepositorio').insert('solicitud_documento',{id_solicitud_conductor:creadoSolicitud.id,id_documento:anterior.id},transaccion);
          continue;
        }
        await SolicitudArchivo.create({
          requestId: creadoSolicitud.id, userId: usuarioId, fileType: tipo,
          evidenceOrigin: origenes[tipo],
          filename: nuevo?.filename || anterior.filename,
          mimeType: nuevo ? nuevo.mimetype : anterior.mimeType,
          status: nuevo ? 'pendiente' : 'verificado'
        }, { transaction: transaccion });
      }
      await saveMetadata(creadoSolicitud.id, actualizadoMetadatos, transaccion);
      return creadoSolicitud;
    });

    respuesta.json({
      message: 'Documentos reenviados correctamente',
      request: {
        id: nuevoSolicitud.id,
        version: nuevoSolicitud.version,
        status: nuevoSolicitud.status
      }
    });
  } catch (error) {
    console.error('Error resubmitting documents:', error);
    respuesta.status(error.status || 500).json({
      error: 'Error al reenviar documentos: ' + error.message
    });
  }
};

module.exports = {
  registrarConductor: registrarConductor,
  obtenerSolicitudEstado: obtenerSolicitudEstado,
  reenviarDocumentos: resubmitDocumentos,
  extraerDocumento: extraerDocumento,
  reanudarPendienteConductorOcr: reanudarPendienteConductorOcr
};
