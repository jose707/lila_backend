'use strict';

const sequelize = require("../config/baseDatos");
const ConductorSolicitud = require("../models/ConductorSolicitud");
const ConductorDomicilio = require("../models/ConductorDomicilio");
const SolicitudArchivo = require("../models/SolicitudArchivo");
const UsuarioIdentidad = require("../models/UsuarioIdentidad");
const Conductor = require("../models/Conductor");
const Vehiculo = require("../models/Vehiculo");
const { notificar: notificar } = require("../services/notificacionServicio");
const correcciones = require('../services/documentosCorreccionServicio');

const REQUERIDO_ARCHIVOS = [
'licenseFront', 'licenseBack', 'ticPhoto', 'antecedentsPhoto',
'ruatPhoto', 'soatPhoto', 'carFront', 'carBack',
'domicileProof'];


const notificarApplicant = (usuarioId, titulo, cuerpo, solicitudId, accion = '') => {
  Promise.resolve(notificar({ userId: usuarioId, title: titulo, body: cuerpo, type: 'sistema', data: { request_id: solicitudId, action: accion } })).
  catch((error) => console.warn('No se pudo notificar la revisión:', error.message));
};

const aprobarConductor = async (solicitud, respuesta) => {
  const { requestId: solicitudId } = solicitud.params;
  const verificadoDocumentos = solicitud.body?.verifiedDocuments;
  if (!Array.isArray(verificadoDocumentos)) {
    return respuesta.status(400).json({ error: 'Indica los documentos revisados.' });
  }
  const faltanteRevision = REQUERIDO_ARCHIVOS.filter((tipo) => !verificadoDocumentos.includes(tipo));
  if (faltanteRevision.length) {
    return respuesta.status(400).json({ error: `Faltan documentos por aprobar: ${faltanteRevision.join(', ')}.` });
  }

  let transaccion;
  try {
    transaccion = await sequelize.transaction();
    const request = await ConductorSolicitud.findByPk(solicitudId, {
      transaction: transaccion, lock: transaccion.LOCK.UPDATE
    });
    if (!request) {await transaccion.rollback();return respuesta.status(404).json({ error: 'Solicitud no encontrada.' });}
    if (request.status !== 'pendiente') {
      await transaccion.rollback();
      return respuesta.status(409).json({ error: 'Solo puede aprobarse una solicitud pendiente.' });
    }
    if (request.metadata?.ocrProcessingStatus === 'pendiente') {
      await transaccion.rollback();
      return respuesta.status(409).json({ error: 'El OCR de los documentos todavía se está procesando.' });
    }
    const reciente = await ConductorSolicitud.findOne({
      where: { userId: request.userId }, order: [['version', 'DESC']], transaction: transaccion
    });
    if (reciente?.id !== request.id) {
      await transaccion.rollback();
      return respuesta.status(409).json({ error: 'Existe una versión más reciente de esta solicitud.' });
    }
    const identidad = await UsuarioIdentidad.findOne({ where: { userId: request.userId }, transaction: transaccion });
    if (identidad?.verificationStatus !== 'verificado') {
      await transaccion.rollback();
      return respuesta.status(400).json({ error: 'La cédula de identidad aún no está verificada.' });
    }
    const archivos = await SolicitudArchivo.findAll({ where: { requestId: solicitudId }, transaction: transaccion });
    const faltanteArchivos = REQUERIDO_ARCHIVOS.filter((tipo) => !archivos.some((archivo) => archivo.fileType === tipo));
    if (faltanteArchivos.length) {
      await transaccion.rollback();
      return respuesta.status(400).json({ error: `Faltan archivos: ${faltanteArchivos.join(', ')}.` });
    }
    const existenteConductor = await Conductor.findOne({ where: { userId: request.userId }, paranoid: false, transaction: transaccion });
    if (existenteConductor) {
      await transaccion.rollback();
      return respuesta.status(409).json({ error: 'Esta persona ya tiene un registro de conductor.' });
    }

    const metadatos = request.metadata || {};
    const domicilio = await ConductorDomicilio.findOne({ where: { driverRequestId: request.id }, transaction: transaccion });
    const coordenadas = domicilio?.location?.coordinates;
    if (!domicilio || domicilio.userId !== request.userId ||
    typeof domicilio.address !== 'string' || domicilio.address.trim().length < 8 ||
    !Array.isArray(coordenadas) || coordenadas.length !== 2 ||
    !Number.isFinite(coordenadas[0]) || !Number.isFinite(coordenadas[1]) ||
    coordenadas[0] < -180 || coordenadas[0] > 180 ||
    coordenadas[1] < -90 || coordenadas[1] > 90) {
      await transaccion.rollback();
      return respuesta.status(400).json({ error: 'Falta la dirección o ubicación válida del domicilio.' });
    }
    const erroresDocumentos = [...new Set(correcciones.validarDatosDocumentales(metadatos, identidad).map(error => error.mensaje))];
    if (erroresDocumentos.length) {
      await transaccion.rollback();
      return respuesta.status(400).json({
        error: `No se puede aprobar la solicitud:\n${erroresDocumentos.join('\n')}`,
        detalles: erroresDocumentos
      });
    }

    if (solicitud.soloRevisionDocumental) {
      await SolicitudArchivo.update({status:'verificado',verifiedAt:new Date(),verifiedBy:solicitud.user.id},{where:{requestId:request.id},transaction:transaccion});
      await transaccion.commit();
      return respuesta.json({message:'Documentos aprobados. Debe realizarse la evaluación psicológica.'});
    }
    if (REQUERIDO_ARCHIVOS.some(tipo=>!archivos.some(a=>a.fileType===tipo&&a.status==='verificado'))) {
      await transaccion.rollback();
      return respuesta.status(409).json({error:'Primero debe completarse la aprobación documental.'});
    }
    const [evaluacion] = await require('../services/documentosRepositorio').select(
      `SELECT e.estado,i.resultado,i.valida_hasta FROM public.evaluacion_psicologica e
       LEFT JOIN public.documento_informe_psicologico i ON i.id_documento_informe_psicologico=e.id_documento_informe
       WHERE e.id_solicitud_conductor=:id AND e.estado <> 'cancelada' ORDER BY e.creado_en DESC LIMIT 1`,{id:request.id},transaccion);
    const hoy = new Intl.DateTimeFormat('en-CA',{timeZone:'America/La_Paz',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if (!evaluacion || evaluacion.estado!=='realizada' || evaluacion.resultado!=='apto' || (evaluacion.valida_hasta && evaluacion.valida_hasta < hoy)) {
      await transaccion.rollback();
      return respuesta.status(409).json({error:'Se requiere una evaluación psicológica apta y vigente antes de crear el conductor.'});
    }
    const conductor = await Conductor.create({
      userId: request.userId,
      status: 'aprobado',
      isAvailable: false
    }, { transaction: transaccion });
    const vehiculo = await Vehiculo.create({
      driver_id: conductor.id,
      status: 'activo'
    }, { transaction: transaccion });
    await SolicitudArchivo.update(
      { status: 'verificado', verifiedAt: new Date(), verifiedBy: solicitud.user.id },
      { where: { requestId: solicitudId }, transaction: transaccion }
    );
    await domicilio.update({
      verificationStatus: 'verificado', verifiedAt: new Date(), verifiedBy: solicitud.user.id,
      rejectionReason: null
    }, { transaction: transaccion });
    const repositorio = require('../services/documentosRepositorio');
    for (const archivo of archivos) {
      const esVehiculo = ['ruatPhoto','soatPhoto','carFront','carBack','carLeft','carRight'].includes(archivo.fileType);
      await repositorio.update('documento','id_documento',archivo.id,{estado_verificacion:'verificado',verificado_en:new Date(),id_usuario_verificador:solicitud.user.id},transaccion);
      await repositorio.insert(esVehiculo ? 'vehiculo_documento' : 'conductor_documento', {id_documento:archivo.id,[esVehiculo?'id_vehiculo':'id_conductor']:esVehiculo?vehiculo.id:conductor.id},transaccion);
    }
    await request.update({ status: 'aprobado', rejectionReason: null, rejectedDocuments: [] }, { transaction: transaccion });
    await transaccion.commit();
    notificarApplicant(request.userId, 'Solicitud aprobada', 'Tu registro como conductor fue aprobado.', request.id);
    return respuesta.json({ message: 'Solicitud aprobada.', driverId: conductor.id, vehicleId: vehiculo.id });
  } catch (error) {
    if (transaccion && !transaccion.finished) await transaccion.rollback();
    console.error('Error al aprobar solicitud:', error);
    return respuesta.status(500).json({ error: 'No se pudo aprobar la solicitud.' });
  }
};

const decideSolicitud = (estado) => async (solicitud, respuesta) => {
  const motivo = String(solicitud.body?.reason || '').trim();
  if (!motivo) return respuesta.status(400).json({ error: 'Indica el motivo de la decisión.' });
  if (!Array.isArray(solicitud.body?.rejectedDocuments) || !Array.isArray(solicitud.body?.verifiedDocuments)) {
    return respuesta.status(400).json({ error: 'Indica los documentos revisados.' });
  }
  const rechazadoDocumentos = [...new Set(solicitud.body.rejectedDocuments)];
  const verificadoDocumentos = [...new Set(solicitud.body.verifiedDocuments)];
  const carasLicencia = ['licenseFront', 'licenseBack'];
  if (carasLicencia.some(cara => rechazadoDocumentos.includes(cara))) {
    for (const cara of carasLicencia) {
      if (!rechazadoDocumentos.includes(cara)) rechazadoDocumentos.push(cara);
      const indice = verificadoDocumentos.indexOf(cara);
      if (indice !== -1) verificadoDocumentos.splice(indice, 1);
    }
  }
  if (estado === 'observado' && !rechazadoDocumentos.length) {
    return respuesta.status(400).json({ error: 'Selecciona al menos un documento para corregir.' });
  }
  if (REQUERIDO_ARCHIVOS.some((tipo) =>
  !rechazadoDocumentos.includes(tipo) && !verificadoDocumentos.includes(tipo))) {
    return respuesta.status(400).json({ error: 'Revisa todos los documentos antes de resolver la solicitud.' });
  }
  if (rechazadoDocumentos.some((tipo) => verificadoDocumentos.includes(tipo))) {
    return respuesta.status(400).json({ error: 'Un documento no puede estar verificado y rechazado a la vez.' });
  }
  if (rechazadoDocumentos.some((tipo) => !REQUERIDO_ARCHIVOS.includes(tipo)) ||
  verificadoDocumentos.some((tipo) => !REQUERIDO_ARCHIVOS.includes(tipo))) {
    return respuesta.status(400).json({ error: 'Hay tipos de documento inválidos.' });
  }
  let transaccion;
  try {
    transaccion = await sequelize.transaction();
    const request = await ConductorSolicitud.findByPk(solicitud.params.requestId, {
      transaction: transaccion, lock: transaccion.LOCK.UPDATE
    });
    if (!request) {await transaccion.rollback();return respuesta.status(404).json({ error: 'Solicitud no encontrada.' });}
    if (request.status !== 'pendiente') {
      await transaccion.rollback();
      return respuesta.status(409).json({ error: 'Solo puede resolverse una solicitud pendiente.' });
    }
    if (request.metadata?.ocrProcessingStatus === 'pendiente') {
      await transaccion.rollback();
      return respuesta.status(409).json({ error: 'El OCR de los documentos todavía se está procesando.' });
    }
    const reciente = await ConductorSolicitud.findOne({
      where: { userId: request.userId }, order: [['version', 'DESC']], transaction: transaccion
    });
    if (reciente?.id !== request.id) {
      await transaccion.rollback();
      return respuesta.status(409).json({ error: 'Existe una versión más reciente de esta solicitud.' });
    }
    await SolicitudArchivo.update(
      { status: 'verificado', verifiedAt: new Date(), verifiedBy: solicitud.user.id },
      { where: { requestId: request.id, fileType: verificadoDocumentos }, transaction: transaccion }
    );
    await SolicitudArchivo.update(
      { status: 'rechazado', verifiedAt: null, verifiedBy: solicitud.user.id },
      { where: { requestId: request.id, fileType: rechazadoDocumentos }, transaction: transaccion }
    );
    const domicilio = await ConductorDomicilio.findOne({ where: { driverRequestId: request.id }, transaction: transaccion });
    if (domicilio && rechazadoDocumentos.includes('domicileProof')) {
      await domicilio.update({
        verificationStatus: 'rechazado', verifiedAt: null, verifiedBy: solicitud.user.id,
        rejectionReason: motivo
      }, { transaction: transaccion });
    } else if (domicilio && verificadoDocumentos.includes('domicileProof')) {
      await domicilio.update({
        verificationStatus: 'verificado', verifiedAt: new Date(), verifiedBy: solicitud.user.id,
        rejectionReason: null
      }, { transaction: transaccion });
    }
    await request.update({
      status: estado, rejectionReason: motivo,
      rejectedDocuments: rechazadoDocumentos,
    }, { transaction: transaccion });
    await transaccion.commit();
    const puedeReenviar = rechazadoDocumentos.length > 0;
    notificarApplicant(request.userId,
    estado === 'rechazado' ? 'Solicitud de conductor rechazada' : puedeReenviar ? 'Documentos por reenviar' : 'Solicitud observada',
    estado === 'rechazado'
      ? (puedeReenviar ? `Revisa los documentos rechazados\nMotivo: ${motivo}` : `Motivo: ${motivo}`)
      : (puedeReenviar ? `Revisa los documentos rechazados y vuelve a enviarlos. Motivo: ${motivo}` : motivo),
    request.id, puedeReenviar ? 'resubmit_driver_documents' : '');
    return respuesta.json({ message: estado === 'observado' ? 'Solicitud observada.' : 'Solicitud rechazada.' });
  } catch (error) {
    if (transaccion && !transaccion.finished) await transaccion.rollback();
    console.error('Error al resolver solicitud:', error);
    return respuesta.status(500).json({ error: 'No se pudo resolver la solicitud.' });
  }
};

const datosDocumento = async (solicitud, respuesta) => {
  try {
    return respuesta.json(await correcciones.consultarDatos(solicitud.params.requestId, solicitud.params.tipo));
  } catch (error) {
    return respuesta.status(error.status || 500).json({error:error.status ? error.message : 'No se pudieron consultar los datos del documento.'});
  }
};
const corregirDocumento = async (solicitud, respuesta) => {
  try {
    return respuesta.json(await correcciones.corregirDatos(solicitud.params.requestId, solicitud.params.tipo, solicitud.body, solicitud.user.id));
  } catch (error) {
    if (!error.status) console.error('Corrección documental:', error.message);
    return respuesta.status(error.status || 500).json({error:error.status ? error.message : 'No se pudieron guardar las correcciones.'});
  }
};

module.exports = {
  datosDocumento,
  corregirDocumento,
  aprobarConductor: aprobarConductor,
  observeConductor: decideSolicitud('observado'),
  rechazarConductor: decideSolicitud('rechazado')
};
