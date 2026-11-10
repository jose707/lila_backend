const PagoComision = require('../models/PagoComision');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');
const { Op } = require('sequelize');
const { sequelize, ComisionLiquidacion, Conductor, Usuario } = require('../models');

const directorio = path.resolve(process.env.COMMISSION_PROOF_DIR || path.join(__dirname, '../../private/comprobantes-comision'));
const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 2, fieldSize: 512, parts: 4 } }).single('comprobante');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const metodos = ['efectivo', 'qr', 'transferencia'];

function recibirArchivo(solicitud, respuesta, siguiente) {
  subir(solicitud, respuesta, error => {
    if (error) return respuesta.status(400).json({ error: 'Adjunta una sola imagen o PDF de hasta 8 MB.' });
    siguiente();
  });
}

function tipoArchivo(buffer) {
  if (buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'application/pdf';
  if (buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  return null;
}

function consultaComprobantes(ids) {
  return { commissionId: { [Op.in]: ids }, documentId: { [Op.ne]: null } };
}

async function ultimosComprobantes(ids, transaction) {
  if (!ids.length) return new Map();
  const registros = await PagoComision.findAll({
    where: consultaComprobantes(ids), include: [{ model: require('../models/Documento'), as: 'document' }], order: [['submittedAt', 'DESC'], ['id', 'DESC']], transaction
  });
  const ultimos = new Map();
  for (const registro of registros) {
    if (!ultimos.has(registro.commissionId)) ultimos.set(registro.commissionId, registro);
  }
  return ultimos;
}

function presentarComprobante(registro, vence, fechaBolivia) {
  if (!registro) return null;
  const datos = { estado: registro.status === 'pendiente' ? 'under_review' : registro.status === 'confirmado' ? 'aceptado' : registro.status, metodo: registro.method, referencia: registro.reference, motivo: registro.rejectionReason };
  return {
    id: registro.id, estado: datos.estado, tipoArchivo: registro.document?.mimeType, metodo: datos.metodo,
    referencia: datos.referencia, fecha: registro.submittedAt, motivo: datos.motivo ?? null,
    aTiempo: vence ? fechaBolivia(registro.submittedAt) <= vence : null
  };
}

async function obtenerConductor(solicitud, respuesta, siguiente) {
  try {
    const conductor = await Conductor.findOne({
      where: { userId: solicitud.user.id, status: { [Op.in]: ['aprobado', 'suspendido'] } },
      attributes: ['id'], include: [{ model: Usuario, as: 'user', attributes: [], required: true, where: { isActive: true } }]
    });
    if (!conductor) return respuesta.status(403).json({ error: 'No tienes acceso a liquidaciones de conductor.' });
    solicitud.conductorComisionesId = conductor.id;
    siguiente();
  } catch (error) {
    console.error('Error al comprobar conductor para comisiones:', error.message);
    return respuesta.status(500).json({ error: 'No se pudo verificar el acceso a comisiones.' });
  }
}

async function enviar(solicitud, respuesta) {
  const { id } = solicitud.params;
  const archivo = solicitud.file;
  const mime = archivo && tipoArchivo(archivo.buffer);
  const { metodo } = solicitud.body ?? {};
  const referencia = typeof solicitud.body?.referencia === 'string' ? solicitud.body.referencia.trim() : '';
  if (!uuid.test(id) || !mime || !metodos.includes(metodo) || referencia.length > 100) {
    return respuesta.status(400).json({ error: 'Selecciona un método y adjunta un JPG, PNG o PDF válido.' });
  }

  const comprobanteId = randomUUID();
  const archivoPrivado = path.join(directorio, comprobanteId);
  let guardado = false;
  try {
    const resultado = await sequelize.transaction(async transaction => {
      const liquidacion = await ComisionLiquidacion.findOne({
        where: { id, driver_id: solicitud.conductorComisionesId }, transaction, lock: transaction.LOCK.UPDATE
      });
      if (!liquidacion) return { codigo: 404, error: 'Liquidación no encontrada.' };
      await liquidacion.reload({transaction});
      if (!['pendiente_pago', 'atrasado'].includes(liquidacion.status) || Math.round(Number(liquidacion.total_commission) * 100) <= Math.round(Number(liquidacion.amount_paid || 0) * 100)) {
        return { codigo: 409, error: 'La liquidación no admite comprobantes.' };
      }
      const anterior = (await ultimosComprobantes([id], transaction)).get(id);
      if (anterior?.status === 'pendiente') return { codigo: 409, error: 'Ya tienes un comprobante en revisión.' };
      await fs.mkdir(directorio, { recursive: true, mode: 0o700 });
      await fs.writeFile(archivoPrivado, archivo.buffer, { flag: 'wx', mode: 0o600 });
      guardado = true;
      const documentoId = randomUUID();
      await require('../services/documentosRepositorio').createDocument({id_documento:documentoId,userId:solicitud.user.id,tipo_documento:'commissionProof',origen_evidencia:'archivo_subido',ruta_archivo:archivoPrivado,tipo_mime:mime},transaction);
      await PagoComision.create({ id: comprobanteId, commissionId: id, documentId: documentoId,
        amount: liquidacion.total_commission, method: metodo, reference: referencia || null, status: 'pendiente'
      }, { transaction });
      return { comprobanteId };
    });
    if (resultado.error) return respuesta.status(resultado.codigo).json({ error: resultado.error });
    return respuesta.status(201).json(resultado);
  } catch (error) {
    // Si el resultado del COMMIT es incierto, conserva el archivo mientras exista su registro.
    if (guardado) {
      try {
        if (!await PagoComision.findByPk(comprobanteId)) await fs.unlink(archivoPrivado);
      } catch (limpieza) { console.error('No se pudo comprobar la limpieza del comprobante:', limpieza.message); }
    }
    console.error('Error al enviar el comprobante:', error.message);
    return respuesta.status(500).json({ error: 'No se pudo enviar el comprobante.' });
  }
}

async function rechazar(solicitud, respuesta) {
  const { id, comprobanteId } = solicitud.params;
  const motivo = typeof solicitud.body?.motivo === 'string' ? solicitud.body.motivo.trim() : '';
  if (!uuid.test(id) || !uuid.test(comprobanteId) || !motivo || motivo.length > 500) {
    return respuesta.status(400).json({ error: 'Ingresa un motivo de rechazo de hasta 500 caracteres.' });
  }
  try {
    const resultado = await sequelize.transaction(async transaction => {
      const liquidacion = await ComisionLiquidacion.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!liquidacion) return { codigo: 404, error: 'Liquidación no encontrada.' };
      await liquidacion.reload({transaction});
      const registro = (await ultimosComprobantes([id], transaction)).get(id);
      if (liquidacion.status === 'pagado' || registro?.id !== comprobanteId || registro.status !== 'pendiente') {
        return { codigo: 409, error: 'Este comprobante ya no está pendiente de revisión.' };
      }
      await registro.update({ status: 'rechazado', rejectionReason: motivo, reviewerId: solicitud.user.id, reviewedAt: new Date() }, { transaction });
      return { message: 'Comprobante rechazado.' };
    });
    if (resultado.error) return respuesta.status(resultado.codigo).json({ error: resultado.error });
    return respuesta.json(resultado);
  } catch (error) {
    console.error('Error al rechazar el comprobante:', error.message);
    return respuesta.status(500).json({ error: 'No se pudo rechazar el comprobante.' });
  }
}

async function ver(solicitud, respuesta) {
  const { id, comprobanteId } = solicitud.params;
  if (!uuid.test(id) || !uuid.test(comprobanteId)) return respuesta.sendStatus(404);
  try {
    const registro = await PagoComision.findOne({ where: { id: comprobanteId, ...consultaComprobantes([id]) } });
    if (!registro) return respuesta.sendStatus(404);
    if (solicitud.conductorComisionesId) {
      const propia = await ComisionLiquidacion.findOne({ where: { id, driver_id: solicitud.conductorComisionesId }, attributes: ['id'] });
      if (!propia) return respuesta.sendStatus(404);
    }
    const [documentos] = await sequelize.query('SELECT mime_type FROM documento WHERE id = :id', { replacements: { id: registro.documentId } });
    const mime = documentos[0]?.mime_type;
    respuesta.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': mime });
    respuesta.sendFile(comprobanteId, { root: directorio, cacheControl: false }, error => {
      if (error && !respuesta.headersSent) respuesta.sendStatus(error.status === 404 ? 404 : 500);
    });
  } catch (error) {
    console.error('Error al leer comprobante:', error.message);
    if (!respuesta.headersSent) respuesta.sendStatus(500);
  }
}

module.exports = { recibirArchivo, obtenerConductor, ultimosComprobantes, presentarComprobante, enviar, rechazar, ver };
