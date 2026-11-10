const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");

const UsuarioIdentidad = sequelize.define('UserIdentity', {
  id: { type: DatosTipos.UUID, defaultValue: DatosTipos.UUIDV4, primaryKey: true },
  userId: { type: DatosTipos.UUID, allowNull: false, unique: true, field: 'user_id' },
  firstNames: { type: DatosTipos.STRING, allowNull: false, field: 'first_names' },
  paternalSurname: { type: DatosTipos.STRING, allowNull: true, field: 'paternal_surname' },
  maternalSurname: { type: DatosTipos.STRING, allowNull: true, field: 'maternal_surname' },
  ciNumber: { type: DatosTipos.STRING, allowNull: false, unique: true, field: 'ci_number' },
  birthDate: { type: DatosTipos.DATEONLY, allowNull: false, field: 'birth_date' },
  issueDate: { type: DatosTipos.DATEONLY, allowNull: true, field: 'issue_date' },
  expiryDate: { type: DatosTipos.DATEONLY, allowNull: true, field: 'expiry_date' },
  birthPlace: { type: DatosTipos.STRING, allowNull: true, field: 'birth_place' },
  address: { type: DatosTipos.STRING, allowNull: true }, occupation: { type: DatosTipos.STRING, allowNull: true },
  maritalStatus: { type: DatosTipos.STRING, allowNull: true, field: 'marital_status' },
  bloodType: { type: DatosTipos.STRING, allowNull: true, field: 'blood_type' },
  verificationStatus: { type: DatosTipos.STRING, allowNull: false, defaultValue: 'pendiente', field: 'verification_status' },
  verifiedAt: { type: DatosTipos.DATE, allowNull: true, field: 'verified_at' },
  verifiedBy: { type: DatosTipos.UUID, allowNull: true, field: 'verified_by' },
  rejectionReason: { type: DatosTipos.TEXT, allowNull: true, field: 'rejection_reason' }
}, { tableName: "documento_ci", timestamps: true, underscored: true });

require('../services/documentosModelos').configureIdentity(UsuarioIdentidad);
module.exports = UsuarioIdentidad;
