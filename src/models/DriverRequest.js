const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DriverRequest = sequelize.define(
  'DriverRequest',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: true,
      // Para vincular solicitudes del mismo usuario (v1, v2, v3...)
      field: 'user_id',
    },
    driverId: {
      type: DataTypes.UUID,
      allowNull: true,
      // Se asigna cuando se aprueba la solicitud
      field: 'driver_id',
    },
    version: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected'),
      allowNull: false,
      defaultValue: 'pending',
    },
    rejectionReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'rejection_reason',
    },
    rejectedDocuments: {
      type: DataTypes.JSON,
      allowNull: true,
      field: 'rejected_documents',
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    tableName: 'driver_requests',
    timestamps: true,
    underscored: true,
  },
);

module.exports = DriverRequest;
