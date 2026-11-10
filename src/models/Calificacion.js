// backend/src/models/Calificacion.js
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");
const { v4: uuidv4 } = require('uuid');

const Calificacion = sequelize.define(
  'Rating',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: () => uuidv4(),
      primaryKey: true
    },
    rideId: {
      type: DatosTipos.UUID,
      allowNull: false,
      references: {
        model: "viaje",
        key: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      field: 'ride_id'
    },
    rating: {
      type: DatosTipos.FLOAT,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      },
      comment: 'Rating from 1 to 5 stars'
    },
    raterType: {
      type: DatosTipos.ENUM('conductor', 'pasajero'),
      allowNull: false,
      defaultValue: 'pasajero',
      field: 'rater_type'
    },
    comment: {
      type: DatosTipos.TEXT,
      allowNull: true
    },
    createdAt: {
      type: DatosTipos.DATE,
      allowNull: false,
      defaultValue: DatosTipos.NOW,
      field: 'created_at'
    },
    updatedAt: {
      type: DatosTipos.DATE,
      allowNull: false,
      defaultValue: DatosTipos.NOW,
      field: 'updated_at'
    }
  },
  {
    tableName: "calificacion",
    timestamps: true,
    indexes: [
    { unique: true, fields: ['ride_id', 'rater_type'] },
    {
      fields: ['ride_id']
    },
    {
      fields: ['created_at']
    }]

  }
);

module.exports = Calificacion;
