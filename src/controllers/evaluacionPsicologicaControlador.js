'use strict';
const db = require('../config/baseDatos');
const repo = require('../services/documentosRepositorio');
const fs = require('fs/promises');
const path = require('path');
const {
  randomUUID
} = require('crypto');
const multer = require('multer');
const directory = path.resolve(process.env.PSYCHOLOGICAL_REPORT_DIR || path.join(__dirname, '../../private/informes-psicologicos'));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1
  }
}).single('informe');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function fail(message, status = 409) {
  throw Object.assign(new Error(message), {
    status
  });
}
async function lockRequest(id, t) {
  if (!uuid.test(id)) fail('Solicitud inválida.', 400);
  const [request] = await repo.select('SELECT * FROM public.solicitud_conductor WHERE id_solicitud_conductor=:id FOR UPDATE', {
    id
  }, t);
  if (!request) fail('Solicitud no encontrada.', 404);
  if (request.estado !== 'pendiente') fail('La solicitud debe estar pendiente.');
  const [latest] = await repo.select('SELECT id_solicitud_conductor FROM public.solicitud_conductor WHERE id_usuario=:id ORDER BY version DESC LIMIT 1', {
    id: request.id_usuario
  }, t);
  if (latest.id_solicitud_conductor !== id) fail('Existe una solicitud más reciente.');
  const docs = await repo.select("SELECT d.tipo_documento,d.estado_verificacion FROM public.solicitud_documento sd JOIN public.documento d USING(id_documento) WHERE sd.id_solicitud_conductor=:id", {
    id
  }, t);
  const required = ['licenseFront', 'licenseBack', 'ticPhoto', 'antecedentsPhoto', 'ruatPhoto', 'soatPhoto', 'carFront', 'carBack', 'domicileProof'];
  if (required.some(type => !docs.some(d => d.tipo_documento === type && d.estado_verificacion === 'verificado'))) fail('Primero deben aprobarse todos los documentos requeridos.');
  return request;
}
async function registrar(req, res) {
  let saved;
  try {
    const body = req.body || {},
      file = req.file;
    if (!['apto', 'no_apto', 'requiere_reevaluacion'].includes(body.resultado)) fail('Evaluación o resultado inválido.', 400);
    if (!file || file.buffer.subarray(0, 5).toString() !== '%PDF-') fail('Adjunta el informe psicológico en PDF.', 400);
    const documentId = randomUUID();
    await db.transaction(async t => {
      await lockRequest(req.params.requestId, t);
      await fs.mkdir(directory, {
        recursive: true
      });
      saved = path.join(directory, documentId);
      await fs.writeFile(saved, file.buffer, {
        flag: 'wx',
        mode: 0o600
      });
      await repo.createDocument({
        id_documento: documentId,
        requestId: req.params.requestId,
        tipo_documento: 'psychologicalReport',
        origen_evidencia: 'archivo_subido',
        ruta_archivo: saved,
        tipo_mime: 'application/pdf'
      }, t);
      await repo.insert('documento_informe_psicologico', {
        id_documento_informe_psicologico: documentId,
        resultado: body.resultado
      }, t);
      await repo.insert('evaluacion_psicologica', {
        id_solicitud_conductor: req.params.requestId,
        estado: 'realizada',
        realizada_en: new Date(),
        id_documento_informe: documentId,
        id_usuario_evaluador: req.user.id,
        actualizado_en: new Date()
      }, t);
    });
    res.status(201).json({
      idDocumento: documentId
    });
  } catch (e) {
    if (saved) {
      try {
        const found = await repo.select('SELECT 1 FROM public.documento WHERE ruta_archivo=:path', {
          path: saved
        });
        if (!found.length) await fs.unlink(saved);
      } catch {}
    }
    res.status(e.status || 500).json({
      error: e.status ? e.message : 'No se pudo registrar el informe.'
    });
  }
}
async function listar(req, res) {
  try {
    if (!uuid.test(req.params.requestId)) return res.sendStatus(400);
    res.json(await repo.select('SELECT e.*,i.resultado FROM public.evaluacion_psicologica e LEFT JOIN public.documento_informe_psicologico i ON i.id_documento_informe_psicologico=e.id_documento_informe WHERE e.id_solicitud_conductor=:id ORDER BY e.creado_en DESC', {
      id: req.params.requestId
    }));
  } catch {
    res.sendStatus(500);
  }
}
async function verInforme(req, res) {
  try {
    if (!uuid.test(req.params.evaluationId)) return res.sendStatus(404);
    const [row] = await repo.select('SELECT d.ruta_archivo FROM public.evaluacion_psicologica e JOIN public.documento d ON d.id_documento=e.id_documento_informe WHERE e.id_evaluacion_psicologica=:id AND e.id_solicitud_conductor=:request', {
      id: req.params.evaluationId,
      request: req.params.requestId
    });
    if (!row || path.dirname(row.ruta_archivo) !== directory) return res.sendStatus(404);
    res.set('Cache-Control', 'private, no-store');
    res.type('application/pdf');
    res.sendFile(row.ruta_archivo);
  } catch {
    res.sendStatus(500);
  }
}
async function compartirPendientes(req, res) {
  try {
    const lista = require('../services/listaPsicologiaServicio');
    const personas = await lista.obtenerPendientesPsicologia();
    const archivo = await lista.generarPdf(personas);
    res.set('Cache-Control', 'private, no-store');
    res.type('application/pdf');
    res.set('Content-Disposition', 'attachment; filename="pendientes-psicologia.pdf"');
    res.send(archivo);
  } catch (error) {
    console.error('Lista para psicología:', error.message);
    res.status(500).json({ error: 'No se pudo generar el PDF para psicología.' });
  }
}
module.exports = {
  compartirPendientes,
  registrar,
  listar,
  verInforme,
  upload: (req, res, next) => upload(req, res, e => e ? res.status(400).json({
    error: 'Adjunta un PDF de hasta 8 MB.'
  }) : next())
};
