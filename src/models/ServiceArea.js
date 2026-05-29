// backend/src/models/ServiceArea.js
'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ServiceArea = sequelize.define(
  'ServiceArea',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Nombre de la zona, ej: La Paz, El Alto, Cochabamba',
    },
    boundary: {
      type: DataTypes.GEOMETRY('POLYGON', 4326),
      allowNull: false,
      comment: 'Polígono PostGIS que define los límites operativos',
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    },
    base_fare: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'NULL = usar tarifa global',
    },
    fare_per_km: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'NULL = usar tarifa global',
    },
    fare_per_minute: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'NULL = usar tarifa global',
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'BOB',
    },
  },
  {
    tableName: 'service_areas',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = ServiceArea;
