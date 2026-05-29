// backend/src/models/Vehicle.js
'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Vehicle = sequelize.define(
  'Vehicle',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    driver_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'drivers', key: 'id' },
    },
    brand: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    model: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    color: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    plate: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: 'vehicles_plate_unique',
    },
    capacity: {
      type: DataTypes.INTEGER,
      defaultValue: 4,
      allowNull: false,
    },
    vehicle_type: {
      type: DataTypes.ENUM('taxi', 'minibus', 'bus', 'motorcycle'),
      defaultValue: 'taxi',
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'suspended'),
      defaultValue: 'active',
      allowNull: false,
    },
    ruatFile: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'ruat_file',
      comment:
        'Archivo RUAT del vehículo. Temporal mientras está en revisión, permanente una vez aprobado.',
    },
    ruatVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      field: 'ruat_verified',
      comment: 'true = RUAT aprobado por el admin (vehículo verificado)',
    },
    ruatVerifiedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'ruat_verified_at',
      comment: 'Cuándo el admin verificó el RUAT de este vehículo',
    },
    ruatRequired: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      field: 'ruat_required',
      comment:
        'true cuando el admin exige que se envíe el RUAT de este vehículo',
    },
    ruatRequiredReason: {
      type: DataTypes.ENUM(
        'accident',
        'vehicle_mismatch',
        'suspension_reactivation',
        'criminal_record',
      ),
      allowNull: true,
      field: 'ruat_required_reason',
      comment: 'Motivo por el que se requirió la verificación del RUAT',
    },
    ruatRequiredAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'ruat_required_at',
      comment: 'Cuándo el admin activó el requerimiento de RUAT',
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'vehicles',
    timestamps: true,
    underscored: true,
    paranoid: true,
    deletedAt: 'deleted_at',
  },
);

module.exports = Vehicle;
