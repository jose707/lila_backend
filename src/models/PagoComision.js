'use strict';
const {
  DataTypes: D
} = require('sequelize');
const db = require('../config/baseDatos');
const PagoComision = db.define('PagoComision', {
  id: {
    type: D.UUID,
    primaryKey: true,
    defaultValue: D.UUIDV4,
    field: 'id_pago_comision'
  },
  commissionId: {
    type: D.UUID,
    allowNull: false,
    field: 'id_comision'
  },
  documentId: {
    type: D.UUID,
    field: 'id_documento_comprobante'
  },
  amount: {
    type: D.DECIMAL(12, 2),
    allowNull: false,
    field: 'importe'
  },
  method: {
    type: D.STRING,
    allowNull: false,
    field: 'metodo_pago'
  },
  reference: {
    type: D.STRING(100),
    field: 'referencia'
  },
  status: {
    type: D.STRING,
    allowNull: false,
    field: 'estado'
  },
  submittedAt: {
    type: D.DATE,
    defaultValue: D.NOW,
    field: 'presentado_en'
  },
  reviewedAt: {
    type: D.DATE,
    field: 'revisado_en'
  },
  reviewerId: {
    type: D.UUID,
    field: 'id_usuario_revisor'
  },
  rejectionReason: {
    type: D.TEXT,
    field: 'motivo_rechazo'
  }
}, {
  tableName: 'pago_comision',
  timestamps: false
});
PagoComision.belongsTo(require('./Usuario'), {
  as: 'reviewer',
  foreignKey: 'reviewerId'
});
PagoComision.belongsTo(require('./Documento'), {
  as: 'document',
  foreignKey: 'documentId'
});
module.exports = PagoComision;
