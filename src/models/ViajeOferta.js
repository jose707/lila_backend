// backend/src/models/ViajeOferta.js
'use strict';
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");

const ViajeOferta = sequelize.define(
  'RideOffer',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: DatosTipos.UUIDV4,
      primaryKey: true
    },
    ride_id: {
      type: DatosTipos.UUID,
      allowNull: false,
      references: { model: "viaje", key: 'id' }
    },
    driver_id: {
      type: DatosTipos.UUID,
      allowNull: false,
      references: { model: "conductor", key: 'id' }
    },
    offered_price: {
      type: DatosTipos.NUMERIC(10, 2),
      allowNull: false
    },
    status: {
      type: DatosTipos.ENUM('pendiente', 'aceptado', 'rechazado', 'vencido', 'cancelado'),
      defaultValue: 'pendiente',
      allowNull: false
    },
    message: {
      type: DatosTipos.TEXT,
      allowNull: true
    },
    expires_at: {
      type: DatosTipos.DATE,
      allowNull: false
    }
  },
  {
    tableName: "oferta_viaje",
    timestamps: true,
    underscored: true
  }
);

module.exports = ViajeOferta;
