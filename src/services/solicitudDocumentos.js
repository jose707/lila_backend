'use strict';
const repo = require('./documentosRepositorio');
const types = require('../config/documentos-estructura');
const db = require('../config/baseDatos');
async function readMetadata(id, t) {
  const rows = await repo.select('SELECT d.* FROM public.solicitud_documento sd JOIN public.documento d USING(id_documento) WHERE sd.id_solicitud_conductor=:id', {
    id
  }, t);
  const ocr = {},
    rejected = [];
  for (const row of rows) {
    const type = row.tipo_documento,
      spec = types[type];
    if (row.estado_verificacion === 'rechazado') rejected.push(type);
    if (!spec) continue;
    const [detail] = await repo.select(`SELECT * FROM public.${spec.table} WHERE ${spec.primaryKey}=:id`, {
      id: row.id_documento
    }, t);
    if (!detail && row.texto_ocr == null) continue;
    const fields = Object.fromEntries(Object.entries(spec.fields).filter(([, col]) => detail?.[col] != null).map(([key, col]) => [key, detail[col]]));
    if (type === 'ticPhoto') fields.fullName = [fields.firstNames, fields.surnames]
      .map(value => String(value || '').trim()).filter(Boolean).join(' ');
    const missing = (require('./servicioOcr').REQUERIDOS_POR_TIPO[type] || []).filter(key => !String(fields[key] ?? '').trim());
    ocr[type] = {
      fields,
      text: row.texto_ocr || '',
      missing
    };
  }
  const license = ocr.licenseFront?.fields || {},
    ruat = ocr.ruatPhoto?.fields || {},
    soat = ocr.soatPhoto?.fields || {};
  return {
    metadata: {
      ...ruat,
      ...soat,
      licenseNumber: license.licenseNumber,
      licenseExpiryDate: license.licenseExpiryDate,
      licenseCategory: license.licenseCategory,
      licenseIssueDate: license.issueDate,
      licenseNationality: license.nationality,
      ocr
    },
    rejected
  };
}
async function saveMetadata(id, metadata, t) {
  if (!t) return db.transaction(transaction => saveMetadata(id, metadata, transaction));
  if (metadata.ocr?.ruatPhoto?.fields && metadata.vehicleType && !metadata.ocr.ruatPhoto.fields.vehicleType) metadata = {
    ...metadata,
    ocr: {
      ...metadata.ocr,
      ruatPhoto: {
        ...metadata.ocr.ruatPhoto,
        fields: {
          ...metadata.ocr.ruatPhoto.fields,
          vehicleType: metadata.vehicleType
        }
      }
    }
  };
  const rows = await repo.select('SELECT d.id_documento,d.tipo_documento FROM public.solicitud_documento sd JOIN public.documento d USING(id_documento) WHERE sd.id_solicitud_conductor=:id', {
    id
  }, t);
  for (const row of rows) {
    const type = row.tipo_documento;
    await repo.saveReading(row.id_documento, type, metadata.ocr?.[type], t);
  }
  const front = rows.find(r => r.tipo_documento === 'licenseFront'),
    back = rows.find(r => r.tipo_documento === 'licenseBack');
  if (front && back) await repo.update('documento', 'id_documento', back.id_documento, {
    id_documento_principal: front.id_documento
  }, t);
  await repo.update('solicitud_conductor', 'id_solicitud_conductor', id, {
    estado_ocr: metadata.ocrProcessingStatus,
    ocr_procesado_en: metadata.ocrProcessedAt,
  }, t);
}

function configure(model) {
  model.addHook('beforeFind', options => {
    if (Array.isArray(options.attributes)) {
      for (const key of ['id', 'status', 'ocrProcessingStatus', 'ocrProcessedAt'])
        if (!options.attributes.includes(key)) options.attributes.push(key);
    }
  });
  model.addHook('afterFind', async (result, options) => {
    for (const row of (Array.isArray(result) ? result : result ? [result] : [])) {
      const loaded = await readMetadata(row.id, options.transaction);
      row.setDataValue('metadata', {
        ...loaded.metadata,
        ocrProcessingStatus: row.ocrProcessingStatus,
        ocrProcessedAt: row.ocrProcessedAt,
        finalRejection: row.finalRejection
      });
      row.setDataValue('rejectedDocuments', loaded.rejected);
    }
  });
  const update = model.prototype.update;
  model.prototype.update = async function(values, options = {}) {
    if (!options.transaction) return db.transaction(transaction => this.update(values, {
      ...options,
      transaction
    }));
    const {
      metadata,
      rejectedDocuments,
      ...rest
    } = values;
    if (metadata) await saveMetadata(this.id, metadata, options.transaction);
    await update.call(this, rest, options);
    if (rejectedDocuments !== undefined) this.setDataValue('rejectedDocuments',rejectedDocuments);
    if (metadata) this.setDataValue('metadata', metadata);
    return this;
  };
}
module.exports = {
  readMetadata,
  saveMetadata,
  configure
};
