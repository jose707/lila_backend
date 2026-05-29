// backend/src/models/CommissionSettlement.js
'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CommissionSettlement = sequelize.define(
  'CommissionSettlement',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    driver_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'drivers', key: 'id' },
    },
    period_start: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: 'Primer día del periodo, ej: 2024-01-01',
    },
    period_end: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: 'Último día del periodo, ej: 2024-01-31',
    },
    total_rides: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    gross_amount: {
      type: DataTypes.DOUBLE,
      allowNull: false,
      comment: 'Suma de todos los gross_amount del periodo',
    },
    total_commission: {
      type: DataTypes.DOUBLE,
      allowNull: false,
      comment: 'Suma de todas las comisiones del periodo',
    },
    amount_paid: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'Lo que pagó el conductor (puede ser parcial)',
    },
    status: {
      type: DataTypes.ENUM('open', 'pending_payment', 'paid', 'overdue'),
      defaultValue: 'open',
      allowNull: false,
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: 'Fecha límite de pago',
    },
    paid_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    payment_method: {
      type: DataTypes.ENUM('cash', 'qr', 'transfer'),
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Observaciones del admin',
    },
  },
  {
    tableName: 'commission_settlements',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = CommissionSettlement;
