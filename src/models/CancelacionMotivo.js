// backend/src/models/CancelacionMotivo.js
'use strict';
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");

const CancelacionMotivo = sequelize.define(
  'CancellationReason',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: DatosTipos.UUIDV4,
      primaryKey: true
    },
    code: {
      type: DatosTipos.STRING(50),
      allowNull: false,
      unique: "motivo_cancelacion_codigo_unico",
      comment: 'Clave interna, ej: driver_no_show'
    },
    description: {
      type: DatosTipos.TEXT,
      allowNull: false,
      comment: 'Texto visible al usuario, ej: "El conductor no se presentó"'
    },
    applicable_to: {
      type: DatosTipos.ENUM('pasajero', 'conductor', 'ambos'),
      allowNull: true
      // null = aplica a ambos (no poner comment aquí — Sequelize genera SQL inválido para ENUMs con alter:true)
    },
    is_active: {
      type: DatosTipos.BOOLEAN,
      defaultValue: true,
      allowNull: false
    }
  },
  {
    tableName: "motivo_cancelacion",
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false // table only has created_at
  }
);

module.exports = CancelacionMotivo;
