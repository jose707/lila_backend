const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");

const ConductorDomicilio = sequelize.define('DriverDomicile', {
  id: { type: DatosTipos.UUID, defaultValue: DatosTipos.UUIDV4, primaryKey: true },
  userId: { type: DatosTipos.UUID, allowNull: false, field: 'user_id' },
  driverRequestId: { type: DatosTipos.UUID, allowNull: false, unique: true, field: 'driver_request_id' },
  address: { type: DatosTipos.STRING(255), allowNull: false },
  location: { type: DatosTipos.GEOMETRY('POINT', 4326), allowNull: false },
  verificationStatus: { type: DatosTipos.STRING(20), allowNull: false, defaultValue: 'pendiente', field: 'verification_status' },
  verifiedBy: { type: DatosTipos.UUID, allowNull: true, field: 'verified_by' },
  verifiedAt: { type: DatosTipos.DATE, allowNull: true, field: 'verified_at' },
  rejectionReason: { type: DatosTipos.TEXT, allowNull: true, field: 'rejection_reason' }
}, { tableName: "documento_domicilio", timestamps: true, underscored: true });

require('../services/documentosModelos').configureDomicile(ConductorDomicilio);
module.exports = ConductorDomicilio;
