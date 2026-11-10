'use strict';
const db = require('../config/baseDatos');
const repo = require('../services/documentosRepositorio');
const {
  Conductor,
  Vehiculo,
  UsuarioIdentidad
} = require('../models');
const { guardarImagenesConductor } = require('../services/conductorOcrImage');
const ocr = require('../services/servicioOcr');
const {
  compararLicenciaLados,
  emisionLicenciaFutura
} = require('../services/licenseValidacion');
const path = require('path');
const fs = require('fs/promises');
const directory = path.resolve(__dirname, '../uploads/drivers');
const vehicleTypes = ['ruatPhoto', 'soatPhoto', 'carFront', 'carBack', 'carLeft', 'carRight'];
const driverTypes = ['licenseFront', 'licenseBack', 'ticPhoto', 'antecedentsPhoto', 'domicileProof'];
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), {
    status
  });
};
const fecha = value => {
  const m = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : value;
};
async function latestVehicleFile(vehicleId, type, t) {
  const [row] = await repo.select(`SELECT d.id_documento AS id,d.ruta_archivo AS filename,d.estado_verificacion AS status FROM public.documento d JOIN public.vehiculo_documento vd USING(id_documento) WHERE vd.id_vehiculo=:id AND d.tipo_documento=:type ORDER BY d.creado_en DESC,d.id_documento DESC LIMIT 1`, {
    id: vehicleId,
    type
  }, t);
  return row || null;
}
async function enviar(req, res) {
  try {
    const driver = await Conductor.findOne({
      where: {
        userId: req.user.id
      }
    });
    if (!driver || !['aprobado', 'suspendido'].includes(driver.status)) fail('Se requiere un perfil de conductor aprobado.', 403);
    const files = Object.entries(req.files || {}).flatMap(([type, items]) => items.map(file => ({
      type,
      file
    })));
    if (!files.length || files.some(x => ![...vehicleTypes, ...driverTypes].includes(x.type))) fail('Adjunta documentos admitidos.');
    const types = files.map(x => x.type);
    if (types.some(x => x.startsWith('license')) && (!types.includes('licenseFront') || !types.includes('licenseBack'))) fail('La renovación de licencia requiere ambas caras.');
    const vehicle = types.some(x => vehicleTypes.includes(x)) ? await Vehiculo.findOne({
      where: {
        driver_id: driver.id,
        ...(req.body?.vehicleId ? {
          id: req.body.vehicleId
        } : {})
      }
    }) : null;
    if (types.some(x => vehicleTypes.includes(x)) && !vehicle) fail('Vehículo no encontrado.', 404);
    if (types.includes('domicileProof')) {
      const lat = Number(req.body.domicileLatitude),
        lng = Number(req.body.domicileLongitude);
      if (typeof req.body.domicileAddress !== 'string' || req.body.domicileAddress.trim().length < 8 || !req.body.domicileLatitude || !req.body.domicileLongitude || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail('Declara una dirección y ubicación válidas.');
    }
    const origenes = repo.origenesAdjuntos(req.body,req.files);
    await guardarImagenesConductor(req.files, req.body);
    const readings = {};
    for (const {
        type,
        file
      }
      of files) {
      if (path.basename(file.filename) !== file.filename) fail('Nombre de archivo inválido.');
      if (ocr.REQUERIDOS_POR_TIPO[type]?.length) {
        const result = await ocr.extraerDocumento(await fs.readFile(path.join(directory, file.filename)), type);
        readings[type] = {
          fields: result.fields,
          text: result.rawText,
          missing: result.missing
        };
      }
    }
    const ids = await db.transaction(async t => {
      await Conductor.findByPk(driver.id, {
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      const ids = {};
      for (const {
          type,
          file
        }
        of files) {
        const owner = vehicleTypes.includes(type) ? {
          vehicleId: vehicle.id
        } : {
          driverId: driver.id
        };
        const id = await repo.createDocument({
          ...owner,
          tipo_documento: type,
          ruta_archivo: file.filename,
          origen_evidencia: origenes[type],
          tipo_mime: file.mimetype,
          vigente: false
        }, t);
        ids[type] = id;
        await repo.saveReading(id, type, readings[type], t);
        if (type === 'domicileProof') {
          await repo.query('INSERT INTO public.documento_domicilio(id_documento_domicilio,direccion,ubicacion) VALUES(:id,:address,ST_SetSRID(ST_MakePoint(:lng,:lat),4326)) ON CONFLICT(id_documento_domicilio) DO UPDATE SET direccion=EXCLUDED.direccion,ubicacion=EXCLUDED.ubicacion', {
            id,
            address: req.body.domicileAddress.trim(),
            lat: Number(req.body.domicileLatitude),
            lng: Number(req.body.domicileLongitude)
          }, t);
        }
      }
      if (ids.licenseFront) await repo.update('documento', 'id_documento', ids.licenseBack, {
        id_documento_principal: ids.licenseFront
      }, t);
      return ids;
    });
    res.status(201).json({
      message: 'Documentos recibidos para revisión. Se conserva el historial anterior.',
      documents: ids,
      vehicle: vehicle ? {
        id: vehicle.id,
        ruatFile: files.find(x => x.type === 'ruatPhoto')?.file.filename,
        ruatVerified: false,
      } : null
    });
  } catch (e) {
    console.error('Error al renovar documentos:', e.message);
    res.status(e.status || 500).json({
      error: e.status ? e.message : 'No se pudo registrar la renovación.'
    });
  }
}
async function pendientes(req, res) {
  try {
    res.json(await repo.select(`SELECT d.id_documento,d.tipo_documento,d.ruta_archivo,d.creado_en,d.texto_ocr,cd.id_conductor,vd.id_vehiculo FROM public.documento d LEFT JOIN public.conductor_documento cd USING(id_documento) LEFT JOIN public.vehiculo_documento vd USING(id_documento) WHERE d.estado_verificacion='pendiente' AND (cd.id_conductor IS NOT NULL OR vd.id_vehiculo IS NOT NULL) ORDER BY d.creado_en`));
  } catch {
    res.sendStatus(500);
  }
}
async function revisar(req, res) {
  try {
    if (!['verificado', 'rechazado'].includes(req.body?.estado)) fail('Indica verificado o rechazado.');
    if (req.body.estado === 'rechazado' && !String(req.body.motivo || '').trim()) fail('Indica un motivo de rechazo.');
    await db.transaction(async t => {
      const [doc] = await repo.select('SELECT * FROM public.documento WHERE id_documento=:id', {
        id: req.params.documentId
      }, t);
      if (!doc) fail('Documento no encontrado.', 404);
      if (doc.estado_verificacion !== 'pendiente') fail('El documento ya fue revisado.', 409);
      if (doc.tipo_documento === 'licenseBack') fail('Revisa la licencia desde su anverso.');
      const [owner] = await repo.select('SELECT cd.id_conductor,vd.id_vehiculo,COALESCE(c.id_usuario,cv.id_usuario) AS id_usuario FROM public.documento d LEFT JOIN public.conductor_documento cd USING(id_documento) LEFT JOIN public.conductor c USING(id_conductor) LEFT JOIN public.vehiculo_documento vd USING(id_documento) LEFT JOIN public.vehiculo v ON v.id_vehiculo=vd.id_vehiculo LEFT JOIN public.conductor cv ON cv.id_conductor=v.id_conductor WHERE d.id_documento=:id', {
        id: doc.id_documento
      }, t);
      if (!owner?.id_usuario) fail('Este documento se revisa desde la solicitud.', 409);
      await repo.query(owner.id_vehiculo ? 'SELECT 1 FROM public.vehiculo WHERE id_vehiculo=:id FOR UPDATE' : 'SELECT 1 FROM public.conductor WHERE id_conductor=:id FOR UPDATE', {
        id: owner.id_vehiculo || owner.id_conductor
      }, t);
      const [current] = await repo.select('SELECT estado_verificacion FROM public.documento WHERE id_documento=:id FOR UPDATE', {
        id: doc.id_documento
      }, t);
      if (current.estado_verificacion !== 'pendiente') fail('El documento ya fue revisado.', 409);
      if(doc.tipo_documento==='ruatPhoto' && req.body.estado==='verificado') {
        const [r]=await repo.select('SELECT * FROM public.documento_ruat WHERE id_documento_ruat=:id',{id:doc.id_documento},t);
        if(!r?.placa?.trim() || !r.marca?.trim() || !r.modelo?.trim() || !/^[0-9]{4}$/.test(r.anio||'') || !['taxi','minibus','bus','motocicleta'].includes(r.tipo_vehiculo)) fail('Completa los datos obligatorios del RUAT antes de aprobarlo.');
      }
      const docs = [doc];
      if (doc.tipo_documento === 'licenseFront') {
        const [back] = await repo.select("SELECT * FROM public.documento WHERE id_documento_principal=:id AND tipo_documento='licenseBack' FOR UPDATE", {
          id: doc.id_documento
        }, t);
        if (!back) fail('Falta el reverso de la licencia.');
        docs.push(back);
        if (req.body.estado === 'verificado') {
          const [frontData] = await repo.select('SELECT * FROM public.documento_licencia WHERE id_documento_licencia=:id', {
            id: doc.id_documento
          }, t);
          const [backData] = await repo.select('SELECT * FROM public.documento_licencia WHERE id_documento_licencia=:id', {
            id: back.id_documento
          }, t);
          const ci = await UsuarioIdentidad.findOne({
            where: {
              userId: owner.id_usuario
            },
            transaction: t
          });
          const fields = x => ({
            licenseNumber: x?.numero_licencia,
            issueDate: x?.fecha_emision_detectada,
            licenseExpiryDate: x?.fecha_vencimiento
          });
          if (emisionLicenciaFutura(fields(frontData), fields(backData))) fail('La fecha de emisión de la licencia no puede ser futura.');
          if (!ci || frontData?.numero_licencia !== ci.ciNumber || !compararLicenciaLados(fields(frontData), fields(backData)).matches || !(new Date(fecha(frontData?.fecha_vencimiento) + 'T23:59:59Z') >= new Date())) fail('La licencia debe coincidir con el CI y estar vigente.');
        }
      }
      for (const item of docs) {
        if (req.body.estado === 'verificado') {
          const table = owner.id_vehiculo ? 'vehiculo_documento' : 'conductor_documento',
            column = owner.id_vehiculo ? 'id_vehiculo' : 'id_conductor',
            id = owner.id_vehiculo || owner.id_conductor;
          await repo.query(`UPDATE public.documento SET vigente=false WHERE tipo_documento=:type AND id_documento IN(SELECT id_documento FROM public.${table} WHERE ${column}=:owner)`, {
            type: item.tipo_documento,
            owner: id
          }, t);
        }
        await repo.update('documento', 'id_documento', item.id_documento, {
          estado_verificacion: req.body.estado,
          verificado_en: new Date(),
          id_usuario_verificador: req.user.id,
          motivo_rechazo: req.body.estado === 'rechazado' ? req.body.motivo : null,
          vigente: req.body.estado === 'verificado'
        }, t);
      }

    });
    res.json({
      message: 'Revisión registrada.'
    });
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.status ? e.message : 'No se pudo revisar el documento.'
    });
  }
}
module.exports = {
  enviar,
  pendientes,
  revisar,
  latestVehicleFile
};
