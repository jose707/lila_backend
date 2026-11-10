// backend/src/models/ServiceZona.js
'use strict';
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");

const ServicioZona = sequelize.define(
  'ServiceArea',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: DatosTipos.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DatosTipos.STRING(100),
      allowNull: false,
      comment: 'Nombre de la zona, ej: La Paz, El Alto, Cochabamba'
    },
    boundary: {
      type: DatosTipos.GEOMETRY('POLYGON', 4326),
      allowNull: false,
      comment: 'Polígono PostGIS que define los límites operativos'
    },
    is_active: {
      type: DatosTipos.BOOLEAN,
      defaultValue: true,
      allowNull: false
    },
    base_fare: {
      type: DatosTipos.DOUBLE,
      allowNull: true,
      comment: 'NULL = usar tarifa global'
    },
    fare_per_km: {
      type: DatosTipos.DOUBLE,
      allowNull: true,
      comment: 'NULL = usar tarifa global'
    },
    fare_per_minute: {
      type: DatosTipos.DOUBLE,
      allowNull: true,
      comment: 'NULL = usar tarifa global'
    },
    commission_rate: { type: DatosTipos.DECIMAL(9,6), allowNull:false, defaultValue:0.02, field:'tasa_comision', validate:{min:0,max:1} },
    currency: {
      type: DatosTipos.STRING(10),
      allowNull: false,
      defaultValue: 'BOB'
    }
  },
  {
    tableName: "zona_servicio",
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);

module.exports = ServicioZona;
