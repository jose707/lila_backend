// backend/src/models/Vehiculo.js
'use strict';
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");

const Vehiculo = sequelize.define(
  'Vehicle',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: DatosTipos.UUIDV4,
      primaryKey: true
    },
    driver_id: {
      type: DatosTipos.UUID,
      allowNull: false,
      references: { model: "conductor", key: 'id' }
    },
    // Atributos de lectura obtenidos del RUAT vigente mediante la vista; no son columnas de vehiculo.
    brand: {
      type: DatosTipos.STRING(100),
      allowNull: true
    },
    model: {
      type: DatosTipos.STRING(100),
      allowNull: true
    },
    year: {
      type: DatosTipos.INTEGER,
      allowNull: true
    },
    color: {
      type: DatosTipos.STRING(50),
      allowNull: true
    },
    plate: {
      type: DatosTipos.STRING(20),
      allowNull: true,
    },
    capacity: {
      type: DatosTipos.INTEGER,
      allowNull: true
    },
    vehicle_type: {
      type: DatosTipos.ENUM('taxi', 'minibus', 'bus', 'motocicleta'),
      allowNull: true
    },
    registrationMunicipality: { type: DatosTipos.STRING(100), allowNull: true, field: 'registration_municipality' },
    crpvaNumber: { type: DatosTipos.STRING(50), allowNull: true, field: 'crpva_number' },
    ruatIssueDate: { type: DatosTipos.DATEONLY, allowNull: true, field: 'ruat_issue_date' },
    ownershipStartDate: { type: DatosTipos.DATEONLY, allowNull: true, field: 'ownership_start_date' },
    doorCount: { type: DatosTipos.INTEGER, allowNull: true, field: 'door_count' },
    serviceType: { type: DatosTipos.STRING(100), allowNull: true, field: 'service_type' },
    chassisNumber: { type: DatosTipos.STRING(50), allowNull: true, field: 'chassis_number' },
    engineNumber: { type: DatosTipos.STRING(50), allowNull: true, field: 'engine_number' },
    fuelType: { type: DatosTipos.STRING(100), allowNull: true, field: 'fuel_type' },
    engineDisplacement: { type: DatosTipos.STRING(50), allowNull: true, field: 'engine_displacement' },
    engineType: { type: DatosTipos.STRING(100), allowNull: true, field: 'engine_type' },
    legalObservations: { type: DatosTipos.TEXT, allowNull: true, field: 'legal_observations' },
    status: {
      type: DatosTipos.ENUM('activo', 'inactivo', 'pendiente_revision', 'suspendido'),
      defaultValue: 'activo',
      allowNull: false
    },
    ruatVerified: {
      type: DatosTipos.BOOLEAN,
      allowNull: true,
      field: 'ruat_verified',
      comment: 'true = RUAT aprobado por el admin (vehículo verificado)'
    },
    ruatVerifiedAt: {
      type: DatosTipos.DATE,
      allowNull: true,
      field: 'ruat_verified_at',
      comment: 'Cuándo el admin verificó el RUAT de este vehículo'
    },
    soatRosetteNumber: { type: DatosTipos.STRING, allowNull: true, field: 'soat_rosette_number' },
    soatStartDate: { type: DatosTipos.DATEONLY, allowNull: true, field: 'soat_start_date' },
    soatExpiryDate: { type: DatosTipos.DATEONLY, allowNull: true, field: 'soat_expiry_date' },
    soatUse: { type: DatosTipos.STRING(20), allowNull: true, field: 'soat_use' },
    soatVerificationStatus: { type: DatosTipos.STRING, allowNull: true, field: 'soat_verification_status' },
    soatVerifiedAt: { type: DatosTipos.DATE, allowNull: true, field: 'soat_verified_at' },
    deleted_at: {
      type: DatosTipos.DATE,
      allowNull: true
    }
  },
  {
    tableName: "vehiculo",
    timestamps: true,
    underscored: true,
    paranoid: true,
    deletedAt: 'deleted_at'
  }
);

module.exports = Vehiculo;
