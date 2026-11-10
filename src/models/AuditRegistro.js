'use strict';
const {
  DataTypes: D
} = require('sequelize');
const db = require('../config/baseDatos');
const Detalle = db.define('RegistroAuditoriaDetalle', {
  auditId: {
    type: D.UUID,
    field: 'id_registro_auditoria',
    primaryKey: true
  },
  fieldName: {
    type: D.STRING(100),
    field: 'nombre_campo',
    primaryKey: true
  },
  previous: {
    type: D.TEXT,
    field: 'valor_anterior'
  },
  next: {
    type: D.TEXT,
    field: 'valor_nuevo'
  }
}, {
  tableName: 'registro_auditoria_detalle',
  timestamps: false
});
const Registro = db.define('AuditLog', {
  id: {
    type: D.UUID,
    defaultValue: D.UUIDV4,
    primaryKey: true
  },
  table_name: {
    type: D.STRING,
    allowNull: false
  },
  record_id: {
    type: D.UUID,
    allowNull: false
  },
  action: {
    type: D.STRING,
    allowNull: false
  },
  changed_by: D.UUID,
  changed_at: {
    type: D.DATE,
    defaultValue: D.NOW,
    allowNull: false
  },
  motivo: D.TEXT,
  // Objetos de transporte en memoria; se persiste una fila por campo.
  old_values: D.VIRTUAL,
  new_values: D.VIRTUAL
}, {
  tableName: 'registro_auditoria',
  timestamps: false
});
Registro.hasMany(Detalle, {
  as: 'details',
  foreignKey: 'auditId'
});

function scalar(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') throw new TypeError('Auditoría: cada campo debe ser un valor escalar.');
  return String(value);
}
const create = Registro.create.bind(Registro);
Registro.create = async (values, options = {}) => {
  if (!options.transaction) return db.transaction(transaction => Registro.create(values, {
    ...options,
    transaction
  }));
  const before = values.old_values || {},
    after = values.new_values || {};
  const details = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => scalar(before[key]) !== scalar(after[key]))
    .map(key => ({
      fieldName: key,
      previous: scalar(before[key]),
      next: scalar(after[key])
    }));
  const row = await create(values, options);
  await Detalle.bulkCreate(details.map(detail => ({
    ...detail,
    auditId: row.id
  })), options);
  return row;
};
Registro.addHook('afterFind', async (result, options) => {
  const rows = Array.isArray(result) ? result : result ? [result] : [];
  if (!rows.length) return;
  const details = await Detalle.findAll({
    where: {
      auditId: rows.map(row => row.id)
    },
    transaction: options.transaction
  });
  for (const row of rows) {
    row.setDataValue('old_values', Object.fromEntries(details.filter(d => d.auditId === row.id).map(d => [d.fieldName, d.getDataValue('previous')])));
    row.setDataValue('new_values', Object.fromEntries(details.filter(d => d.auditId === row.id).map(d => [d.fieldName, d.fieldName === 'isActive' ? d.next === 'true' : d.next])));
  }
});
Registro.eventFilter = event => ({
  model: Detalle,
  as: 'details',
  attributes: [],
  required: true,
  where: {
    fieldName: 'tipo',
    next: event
  }
});
module.exports = Registro;
