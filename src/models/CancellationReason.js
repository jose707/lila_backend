// backend/src/models/CancellationReason.js
'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CancellationReason = sequelize.define(
  'CancellationReason',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: 'cancellation_reasons_code_unique',
      comment: 'Clave interna, ej: driver_no_show',
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Texto visible al usuario, ej: "El conductor no se presentó"',
    },
    applicable_to: {
      type: DataTypes.ENUM('passenger', 'driver', 'both'),
      allowNull: true,
      // null = aplica a ambos (no poner comment aquí — Sequelize genera SQL inválido para ENUMs con alter:true)
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    },
  },
  {
    tableName: 'cancellation_reasons',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false,   // table only has created_at
  }
);

module.exports = CancellationReason;
