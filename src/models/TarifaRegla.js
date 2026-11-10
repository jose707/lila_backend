// backend/src/models/TarifaRegla.js
'use strict';
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");

const TarifasRegla = sequelize.define(
  'PricingRule',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: DatosTipos.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DatosTipos.STRING(100),
      allowNull: false,
      comment: 'Nombre descriptivo, ej: "Hora pico mañana centro"'
    },
    zone: {
      type: DatosTipos.GEOMETRY('POLYGON', 4326),
      allowNull: true,
      comment: 'Polígono PostGIS. NULL = aplica a toda la app'
    },
    multiplier: {
      type: DatosTipos.DOUBLE,
      allowNull: false,
      defaultValue: 1.0,
      comment: '1.5 = 50% más caro, 1.0 = sin cambio'
    },
    vehicle_type: {
      type: DatosTipos.ENUM('taxi', 'minibus', 'bus', 'motocicleta'),
      allowNull: true
    },
    day_of_week: {
      type: DatosTipos.SMALLINT,
      allowNull: true,
      validate: { isInt: true, min: 0, max: 6 },
      comment: '0=domingo,...,6=sábado. NULL = todos los días'
    },
    time_start: {
      type: DatosTipos.TIME,
      allowNull: true,
      comment: 'Hora de inicio, ej: 07:00:00'
    },
    time_end: {
      type: DatosTipos.TIME,
      allowNull: true,
      comment: 'Hora de fin, ej: 09:00:00'
    },
    is_active: {
      type: DatosTipos.BOOLEAN,
      defaultValue: true,
      allowNull: false
    },
    priority: {
      type: DatosTipos.INTEGER,
      defaultValue: 0,
      allowNull: false,
      comment: 'Cuando dos reglas se solapan, gana la de mayor prioridad'
    }
  },
  {
    tableName: "regla_tarifa",
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);

// No associations needed — pricing_rules is a standalone config table

module.exports = TarifasRegla;
