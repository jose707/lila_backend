const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DriverDomicile = sequelize.define('DriverDomicile', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
  driverRequestId: { type: DataTypes.UUID, allowNull: false, unique: true, field: 'driver_request_id' },
  address: { type: DataTypes.STRING(255), allowNull: false },
  location: { type: DataTypes.GEOMETRY('POINT', 4326), allowNull: false },
  verificationStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending', field: 'verification_status' },
  verifiedBy: { type: DataTypes.UUID, allowNull: true, field: 'verified_by' },
  verifiedAt: { type: DataTypes.DATE, allowNull: true, field: 'verified_at' },
  rejectionReason: { type: DataTypes.TEXT, allowNull: true, field: 'rejection_reason' },
}, { tableName: 'driver_domiciles', timestamps: true, underscored: true });

module.exports = DriverDomicile;
