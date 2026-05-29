// backend/src/models/DriverLocation.js
'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DriverLocation = sequelize.define(
  'DriverLocation',
  {
    driver_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      references: { model: 'drivers', key: 'id' },
    },
    location: {
      type: DataTypes.GEOMETRY('POINT', 4326),
      allowNull: false,
      comment: 'Geospatial point (longitude, latitude) - WGS84',
    },
    heading: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'Direction in degrees (0=north, 90=east, 180=south, 270=west)',
    },
    speed: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'Speed in km/h',
    },
    is_online: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    },
  },
  {
    tableName: 'driver_locations',
    timestamps: false,
    updatedAt: 'updated_at',
    createdAt: false,
  }
);

module.exports = DriverLocation;
