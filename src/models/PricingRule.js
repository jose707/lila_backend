// backend/src/models/PricingRule.js
'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PricingRule = sequelize.define(
  'PricingRule',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Nombre descriptivo, ej: "Hora pico mañana centro"',
    },
    zone: {
      type: DataTypes.GEOMETRY('POLYGON', 4326),
      allowNull: true,
      comment: 'Polígono PostGIS. NULL = aplica a toda la app',
    },
    multiplier: {
      type: DataTypes.DOUBLE,
      allowNull: false,
      defaultValue: 1.0,
      comment: '1.5 = 50% más caro, 1.0 = sin cambio',
    },
    vehicle_type: {
      type: DataTypes.ENUM('taxi', 'minibus', 'bus', 'motorcycle'),
      allowNull: true,
    },
    day_of_week: {
      type: DataTypes.ARRAY(DataTypes.INTEGER),
      allowNull: true,
      comment: '0=domingo,...,6=sábado. NULL = todos los días',
    },
    time_start: {
      type: DataTypes.TIME,
      allowNull: true,
      comment: 'Hora de inicio, ej: 07:00:00',
    },
    time_end: {
      type: DataTypes.TIME,
      allowNull: true,
      comment: 'Hora de fin, ej: 09:00:00',
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
      comment: 'Cuando dos reglas se solapan, gana la de mayor prioridad',
    },
  },
  {
    tableName: 'pricing_rules',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);

// No associations needed — pricing_rules is a standalone config table

module.exports = PricingRule;
