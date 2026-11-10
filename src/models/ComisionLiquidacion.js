// backend/src/models/ComisionLiquidacion.js
'use strict';
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");

const ComisionLiquidacion = sequelize.define(
  'CommissionSettlement',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: DatosTipos.UUIDV4,
      primaryKey: true
    },
    driver_id: {
      type: DatosTipos.UUID,
      allowNull: false,
      references: { model: "conductor", key: 'id' }
    },
    period_start: {
      type: DatosTipos.DATEONLY,
      allowNull: false,
      comment: 'Primer día del periodo, ej: 2024-01-01'
    },
    period_end: {
      type: DatosTipos.DATEONLY,
      allowNull: true,
      comment: 'Último día del periodo, ej: 2024-01-31'
    },
    // Totales de lectura calculados desde los cobros vinculados; no son columnas físicas.
    total_rides: {
      type: DatosTipos.INTEGER,
      allowNull: true
    },
    gross_amount: {
      type: DatosTipos.DECIMAL(12, 2),
      allowNull: true,
      comment: 'Suma de todos los gross_amount del periodo'
    },
    total_commission: {
      type: DatosTipos.DECIMAL(12, 2),
      allowNull: true,
      comment: 'Suma de todas las comisiones del periodo'
    },
    amount_paid: {
      type: DatosTipos.DECIMAL(12, 2),
      allowNull: true,
      comment: 'Pago completo confirmado del periodo; no admite abonos parciales'
    },
    status: {
      type: DatosTipos.ENUM('abierto', 'pendiente_pago', 'pagado', 'atrasado'),
      
      allowNull: true
    },
    due_date: {
      type: DatosTipos.DATEONLY,
      allowNull: true,
      comment: 'Fecha límite de pago'
    },
    paid_at: {
      type: DatosTipos.DATE,
      allowNull: true
    },
    payment_method: {
      type: DatosTipos.ENUM('efectivo', 'qr', 'transferencia'),
      allowNull: true
    },
    notes: {
      type: DatosTipos.TEXT,
      allowNull: true,
      comment: 'Observaciones del admin'
    }
  },
  {
    tableName: "comision",
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);

module.exports = ComisionLiquidacion;
