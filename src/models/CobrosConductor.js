// backend/src/models/CobrosConductor.js
'use strict';
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");

const CobrosConductor = sequelize.define(
  'CobrosConductor',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: DatosTipos.UUIDV4,
      primaryKey: true
    },
    // Datos de lectura calculados desde viaje y pago; no son columnas físicas.
    driver_id: {
      type: DatosTipos.UUID,
      allowNull: true,
      references: { model: "conductor", key: 'id' }
    },
    ride_id: {
      type: DatosTipos.UUID,
      allowNull: false,
      unique: "ganancia_conductor_viaje_id_unico",
      references: { model: "viaje", key: 'id' },
      comment: 'Un registro por viaje completado'
    },
    settlement_id: {
      type: DatosTipos.UUID,
      allowNull: true,
      references: { model: "comision", key: 'id' },
      comment: 'NULL = pendiente de incluir en cobro mensual'
    },
    payment_method: {
      type: DatosTipos.ENUM('efectivo', 'qr'),
      allowNull: true
    },
    // Importes calculados por PostgreSQL; la tabla solo conserva la tasa aplicada.
    gross_amount: {
      type: DatosTipos.DOUBLE,
      allowNull: true,
      comment: 'Lo que pagó el pasajero'
    },
    commission_rate: {
      type: DatosTipos.DOUBLE,
      allowNull: true,
      comment: 'Tasa de comisión, ej: 0.20 = 20%'
    },
    commission_amount: {
      type: DatosTipos.DOUBLE,
      allowNull: true,
      comment: 'gross_amount × commission_rate — lo que debe la plataforma'
    },
    net_amount: {
      type: DatosTipos.DOUBLE,
      allowNull: true,
      comment: 'gross_amount - commission_amount — lo que se queda el conductor'
    },
    commission_status: {
      type: DatosTipos.ENUM('pendiente', 'cobrado'),
      allowNull: true
    },
    commission_paid_at: {
      type: DatosTipos.DATE,
      allowNull: true,
      comment: 'Cuándo se marcó como cobrada (al pagar el settlement)'
    }
  },
  {
    tableName: "cobros_conductor",
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);

module.exports = CobrosConductor;
