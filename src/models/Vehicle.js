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
    registrationMunicipality: { type: DataTypes.STRING(100), allowNull: true, field: 'registration_municipality' },
    crpvaNumber: { type: DataTypes.STRING(50), allowNull: true, field: 'crpva_number' },
    ruatIssueDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'ruat_issue_date' },
    ownershipStartDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'ownership_start_date' },
    doorCount: { type: DataTypes.INTEGER, allowNull: true, field: 'door_count' },
    serviceType: { type: DataTypes.STRING(100), allowNull: true, field: 'service_type' },
    chassisNumber: { type: DataTypes.STRING(50), allowNull: true, field: 'chassis_number' },
    engineNumber: { type: DataTypes.STRING(50), allowNull: true, field: 'engine_number' },
    fuelType: { type: DataTypes.STRING(100), allowNull: true, field: 'fuel_type' },
    engineDisplacement: { type: DataTypes.STRING(50), allowNull: true, field: 'engine_displacement' },
    engineType: { type: DataTypes.STRING(100), allowNull: true, field: 'engine_type' },
    legalObservations: { type: DataTypes.TEXT, allowNull: true, field: 'legal_observations' },
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
    soatRosetteNumber: { type: DataTypes.STRING, allowNull: true, field: 'soat_rosette_number' },
    soatStartDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'soat_start_date' },
    soatExpiryDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'soat_expiry_date' },
    soatUse: { type: DataTypes.STRING(20), allowNull: true, field: 'soat_use' },
    soatVerificationStatus: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending', field: 'soat_verification_status' },
    soatVerifiedAt: { type: DataTypes.DATE, allowNull: true, field: 'soat_verified_at' },
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
