// backend/src/models/RideWaypoint.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const RideWaypoint = sequelize.define(
  'RideWaypoint',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: () => uuidv4(),
      primaryKey: true,
    },
    ride_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'rides',
        key: 'id',
      },
      field: 'ride_id',
    },
    sequence: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      comment: 'Número de secuencia de la parada (1, 2, 3, 4...)',
    },
    location: {
      type: DataTypes.GEOMETRY('POINT', 4326),
      allowNull: false,
      comment: 'Ubicación de la parada intermedia (POINT WGS84)',
      field: 'location',
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Dirección legible de la parada',
      field: 'address',
    },
    arrived_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fecha/hora de llegada a la parada',
      field: 'arrived_at',
    },
    departed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fecha/hora de salida de la parada',
      field: 'departed_at',
    },
  },
  {
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    tableName: 'ride_waypoints',
  },
);

module.exports = RideWaypoint;
