'use strict';
const db = require('../config/baseDatos');
const {
  randomUUID
} = require('crypto');
const types = require('../config/documentos-estructura');
const query = (sql, replacements = {}, transaction) => db.query(sql, {
  replacements,
  transaction,
  esquemaFisico: true
});
const select = async (sql, replacements = {}, transaction) => (await query(sql, replacements, transaction))[0];
async function insert(table, values, transaction) {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const columns = entries.map(([k]) => `"${k}"`);
  const args = Object.fromEntries(entries.map(([, v], i) => ['v' + i, v]));
  return select(`INSERT INTO public."${table}" (${columns}) VALUES (${entries.map((_,i) => ':v'+i)}) RETURNING *`, args, transaction);
}
async function update(table, idColumn, id, values, transaction) {
  const entries = Object.entries(values).filter(([k, v]) => v !== undefined && k !== idColumn);
  if (!entries.length) return;
  await query(`UPDATE public."${table}" SET ${entries.map(([k],i) => `"${k}"=:v${i}`)} WHERE "${idColumn}"=:id`, {
    id,
    ...Object.fromEntries(entries.map(([, v], i) => ['v' + i, v]))
  }, transaction);
}
async function createDocument(values, transaction) {
  if (!transaction) return db.transaction(t => createDocument(values, t));
  const {
    userId,
    requestId,
    driverId,
    vehicleId,
    ...data
  } = values;
  data.id_documento ||= randomUUID();
  await insert('documento', data, transaction);
  if (requestId) await insert('solicitud_documento', {
    id_solicitud_conductor: requestId,
    id_documento: data.id_documento
  }, transaction);
  else if (vehicleId) await insert('vehiculo_documento', {
    id_vehiculo: vehicleId,
    id_documento: data.id_documento
  }, transaction);
  else if (driverId) await insert('conductor_documento', {
    id_conductor: driverId,
    id_documento: data.id_documento
  }, transaction);
  else if (userId) await insert('usuario_documento', {
    id_usuario: userId,
    id_documento: data.id_documento
  }, transaction);
  return data.id_documento;
}
async function saveReading(id, type, reading = {}, transaction) {
  const spec = types[type];
  const data = {
    texto_ocr: reading.text
  };
  await update('documento', 'id_documento', id, data, transaction);
  if (spec && reading.fields) {
    const values = Object.fromEntries(Object.entries(spec.fields).map(([key, column]) => [column, reading.fields[key] == null ? null : String(reading.fields[key])]));
    await query(`INSERT INTO public.${spec.table}(${spec.primaryKey}) VALUES(:id) ON CONFLICT DO NOTHING`, {
      id
    }, transaction);
    await update(spec.table, spec.primaryKey, id, values, transaction);
  }
}
// El origen de cámara/archivo lo declara la aplicación; los orígenes internos no se aceptan del cliente.
function origenAdjunto(body, tipo) {
  const origen = body?.[tipo + 'Origen'];
  if (!['captura_camara','archivo_subido'].includes(origen)) {
    throw Object.assign(new Error('Indica un origen válido para ' + tipo + ': captura_camara o archivo_subido.'), {status:400});
  }
  return origen;
}
function origenesAdjuntos(body, files) {
  return Object.fromEntries(Object.entries(files || {}).filter(([,items]) => items?.length)
    .map(([tipo]) => [tipo,origenAdjunto(body,tipo)]));
}
module.exports = {
  origenAdjunto,
  origenesAdjuntos,
  query,
  select,
  insert,
  update,
  createDocument,
  saveReading
};
