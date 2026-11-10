// backend/src/models/ConductorUbicacion.js
'use strict';
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");

const ConductorUbicacion = sequelize.define(
  'DriverLocation',
  {
    driver_id: {
      type: DatosTipos.UUID,
      primaryKey: true,
      references: { model: "conductor", key: 'id' }
    },
    location: {
      type: DatosTipos.GEOMETRY('POINT', 4326),
      allowNull: false,
      comment: 'Geospatial point (longitude, latitude) - WGS84'
    },
    heading: {
      type: DatosTipos.DOUBLE,
      allowNull: true,
      comment: 'Direction in degrees (0=north, 90=east, 180=south, 270=west)'
    },
    speed: {
      type: DatosTipos.DOUBLE,
      allowNull: true,
      comment: 'Speed in km/h'
    },
    is_online: {
      type: DatosTipos.BOOLEAN,
      defaultValue: true,
      allowNull: false
    },
    location_recorded_at: { type: DatosTipos.DATE, allowNull: true }
  },
  {
    tableName: "ubicacion_conductor",
    timestamps: false,
    updatedAt: 'updated_at',
    createdAt: false
  }
);

module.exports = ConductorUbicacion;
