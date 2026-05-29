// backend/src/models/AuditLog.js
'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AuditLog = sequelize.define(
  'AuditLog',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    table_name: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Tabla que fue modificada',
    },
    record_id: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'ID del registro modificado',
    },
    action: {
      type: DataTypes.ENUM('INSERT', 'UPDATE', 'DELETE'),
      allowNull: false,
    },
    old_values: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: 'Valores anteriores al cambio',
    },
    new_values: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: 'Valores nuevos tras el cambio',
    },
    changed_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      comment: 'Usuario que realizó la acción',
    },
    changed_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'audit_logs',
    timestamps: false,   // only changed_at, no createdAt/updatedAt
  }
);

module.exports = AuditLog;
