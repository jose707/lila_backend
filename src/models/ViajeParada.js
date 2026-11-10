// backend/src/models/ViajeParada.js
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");
const { v4: uuidv4 } = require('uuid');

const ViajeParada = sequelize.define(
  'RideWaypoint',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: () => uuidv4(),
      primaryKey: true
    },
    ride_id: {
      type: DatosTipos.UUID,
      allowNull: false,
      references: {
        model: "viaje",
        key: 'id'
      },
      field: 'ride_id'
    },
    sequence: {
      type: DatosTipos.SMALLINT,
      allowNull: false,
      comment: 'Número de secuencia de la parada (1, 2, 3, 4...)'
    },
    location: {
      type: DatosTipos.GEOMETRY('POINT', 4326),
      allowNull: false,
      comment: 'Ubicación de la parada intermedia (POINT WGS84)',
      field: 'location'
    },
    address: {
      type: DatosTipos.TEXT,
      allowNull: false,
      comment: 'Dirección legible de la parada',
      field: 'address'
    },
    arrived_at: {
      type: DatosTipos.DATE,
      allowNull: true,
      comment: 'Fecha/hora de llegada a la parada',
      field: 'arrived_at'
    },
    departed_at: {
      type: DatosTipos.DATE,
      allowNull: true,
      comment: 'Fecha/hora de salida de la parada',
      field: 'departed_at'
    }
  },
  {
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    tableName: "parada_viaje"
  }
);

module.exports = ViajeParada;
