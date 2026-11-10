'use strict';
const {
  DataTypes: D
} = require('sequelize');
const db = require('../config/baseDatos');
module.exports = db.define('Documento', {
  id: {
    type: D.UUID,
    field: 'id_documento',
    primaryKey: true,
    defaultValue: D.UUIDV4
  },
  type: {
    type: D.STRING,
    field: 'tipo_documento',
    allowNull: false
  },
  filename: {
    type: D.STRING,
    field: 'ruta_archivo'
  },
  evidenceOrigin: { type: D.STRING(100), field: 'origen_evidencia' },
  mimeType: {
    type: D.STRING,
    field: 'tipo_mime'
  },
  current: {
    type: D.BOOLEAN,
    field: 'vigente'
  },
  status: {
    type: D.STRING,
    field: 'estado_verificacion'
  },
  createdAt: {
    type: D.DATE,
    field: 'creado_en'
  },
  updatedAt: {
    type: D.DATE,
    field: 'actualizado_en'
  }
}, {
  schema: 'public',
  tableName: 'documento',
  timestamps: false
});
