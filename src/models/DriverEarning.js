// backend/src/models/DriverEarning.js
'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DriverEarning = sequelize.define(
  'DriverEarning',
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
    ride_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: 'driver_earnings_ride_id_unique',
      references: { model: 'rides', key: 'id' },
      comment: 'Un registro por viaje completado',
    },
    settlement_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'commission_settlements', key: 'id' },
      comment: 'NULL = pendiente de incluir en cobro mensual',
    },
    payment_method: {
      type: DataTypes.ENUM('cash', 'qr'),
      allowNull: false,
    },
    gross_amount: {
      type: DataTypes.DOUBLE,
      allowNull: false,
      comment: 'Lo que pagó el pasajero',
    },
    commission_rate: {
      type: DataTypes.DOUBLE,
      allowNull: false,
      comment: 'Tasa de comisión, ej: 0.20 = 20%',
    },
    commission_amount: {
      type: DataTypes.DOUBLE,
      allowNull: false,
      comment: 'gross_amount × commission_rate — lo que debe la plataforma',
    },
    net_amount: {
      type: DataTypes.DOUBLE,
      allowNull: false,
      comment: 'gross_amount - commission_amount — lo que se queda el conductor',
    },
    commission_status: {
      type: DataTypes.ENUM('pending', 'collected'),
      defaultValue: 'pending',
      allowNull: false,
    },
    commission_paid_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Cuándo se marcó como cobrada (al pagar el settlement)',
    },
  },
  {
    tableName: 'driver_earnings',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false,
  }
);

module.exports = DriverEarning;
