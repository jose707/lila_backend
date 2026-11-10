'use strict';
const db = require('../config/baseDatos');
const repo = require('./documentosRepositorio');
const map = require('../config/nombres-columnas-por-tabla.json');

function physical(model, values, excluded = []) {
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    if (excluded.includes(key) || value === undefined) continue;
    const attr = model.rawAttributes[key];
    if (!attr || attr.type.key === 'VIRTUAL') continue;
    const field = attr.field;
    result[map[model.tableName]?.[field] || field] = value;
  }
  return result;
}

function writableProjection(model, write) {
  model.bulkCreate = async (values, options = {}) => {
    if (!options.transaction) return db.transaction(transaction => model.bulkCreate(values, {
      ...options,
      transaction
    }));
    const rows = [];
    for (const value of values) rows.push(await model.create(value, options));
    return rows;
  };
  model.create = async (values, options = {}) => {
    if (!options.transaction) return db.transaction(transaction => model.create(values, {
      ...options,
      transaction
    }));
    const row = model.build(values);
    await row.validate();
    await write(row, values, options, true);
    row.isNewRecord = false;
    return row;
  };
  model.prototype.update = async function(values, options = {}) {
    if (!options.transaction) return db.transaction(transaction => this.update(values, {
      ...options,
      transaction
    }));
    await write(this, values, options, false);
    this.set(values);
    this.changed(false);
    return this;
  };
  model.update = async (values, options = {}) => {
    if (!options.transaction) return db.transaction(transaction => model.update(values, {
      ...options,
      transaction
    }));
    const rows = await model.findAll(options);
    for (const row of rows) await row.update(values, options);
    return [rows.length];
  };
}

function configureIdentity(model) {
  writableProjection(model, async (row, values, options, creating) => {
    if (creating) {
      await repo.createDocument({
        id_documento: row.id,
        estado_verificacion:row.verificationStatus,verificado_en:row.verifiedAt,id_usuario_verificador:row.verifiedBy,motivo_rechazo:row.rejectionReason,
        tipo_documento: 'ci',
        userId: row.userId
      }, options.transaction);
      await repo.insert('documento_ci', physical(model, row.get(), ['userId','verificationStatus','verifiedAt','verifiedBy','rejectionReason']), options.transaction);
    } else await repo.update('documento_ci', 'id_documento_ci', row.id, physical(model, values, ['userId','verificationStatus','verifiedAt','verifiedBy','rejectionReason']), options.transaction);
    await repo.update('documento','id_documento',row.id,{estado_verificacion:values.verificationStatus,verificado_en:values.verifiedAt,id_usuario_verificador:values.verifiedBy,motivo_rechazo:values.rejectionReason},options.transaction);
  });
}

function configureDomicile(model) {
  writableProjection(model, async (row, values, options, creating) => {
    const t = options.transaction;
    if (creating) {
      await repo.createDocument({
        id_documento: row.id,
        tipo_documento: 'domicileProof',
        requestId: row.driverRequestId
      }, t);
      await repo.insert('documento_domicilio', {
        id_documento_domicilio: row.id,
        direccion: row.address
      }, t);
    }
    if (values.address !== undefined) await repo.update('documento_domicilio', 'id_documento_domicilio', row.id, {
      direccion: values.address
    }, t);
    if (values.location) await repo.query('UPDATE public.documento_domicilio SET ubicacion=ST_SetSRID(ST_MakePoint(:x,:y),4326) WHERE id_documento_domicilio=:id', {
      id: row.id,
      x: values.location.coordinates[0],
      y: values.location.coordinates[1]
    }, t);
    const review = {
      estado_verificacion: values.verificationStatus,
      verificado_en: values.verifiedAt,
      id_usuario_verificador: values.verifiedBy,
      motivo_rechazo: values.rejectionReason
    };
    await repo.update('documento', 'id_documento', row.id, review, t);
  });
}

function configureFile(model) {
  writableProjection(model, async (row, values, options, creating) => {
    const t = options.transaction;
    let id = row.id;
    if (creating) {
      // El domicilio declarado y su comprobante pertenecen al mismo documento.
      const existing = row.fileType === 'domicileProof' ? await repo.select('SELECT d.id_documento FROM public.documento d JOIN public.solicitud_documento sd USING(id_documento) WHERE sd.id_solicitud_conductor=:id AND d.tipo_documento=:tipo AND d.ruta_archivo IS NULL', {
        id: row.requestId,
        tipo: row.fileType
      }, t) : [];
      if (existing.length) {
        id = existing[0].id_documento;
        row.id = id;
      } else await repo.createDocument({
        id_documento: id,
        tipo_documento: row.fileType,
        requestId: row.requestId
      }, t);
    }
    await repo.update('documento', 'id_documento', id, {
      ruta_archivo: values.filename,
      origen_evidencia: values.evidenceOrigin,
      tipo_mime: values.mimeType
    }, t);
    const updates = {
      estado_verificacion: values.status,
      verificado_en: values.verifiedAt,
      id_usuario_verificador: values.verifiedBy
    };
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (entries.length) await repo.query(`UPDATE public.documento SET ${entries.map(([k],i)=>k+'=:v'+i)} WHERE id_documento=:id`, {
      id,
      request: row.requestId,
      ...Object.fromEntries(entries.map(([, v], i) => ['v' + i, v]))
    }, t);
  });
}
module.exports = {
  configureIdentity,
  configureDomicile,
  configureFile
};
