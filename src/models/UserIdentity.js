const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserIdentity = sequelize.define('UserIdentity', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false, unique: true, field: 'user_id' },
  firstNames: { type: DataTypes.STRING, allowNull: false, field: 'first_names' },
  paternalSurname: { type: DataTypes.STRING, allowNull: true, field: 'paternal_surname' },
  maternalSurname: { type: DataTypes.STRING, allowNull: true, field: 'maternal_surname' },
  ciNumber: { type: DataTypes.STRING, allowNull: false, unique: true, field: 'ci_number' },
  birthDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'birth_date' },
  issueDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'issue_date' },
  expiryDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'expiry_date' },
  birthPlace: { type: DataTypes.STRING, allowNull: true, field: 'birth_place' },
  address: { type: DataTypes.STRING, allowNull: true }, occupation: { type: DataTypes.STRING, allowNull: true },
  maritalStatus: { type: DataTypes.STRING, allowNull: true, field: 'marital_status' },
  bloodType: { type: DataTypes.STRING, allowNull: true, field: 'blood_type' },
  verificationStatus: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending', field: 'verification_status' },
  verifiedAt: { type: DataTypes.DATE, allowNull: true, field: 'verified_at' },
  verifiedBy: { type: DataTypes.UUID, allowNull: true, field: 'verified_by' },
  rejectionReason: { type: DataTypes.TEXT, allowNull: true, field: 'rejection_reason' },
}, { tableName: 'user_identities', timestamps: true, underscored: true });

module.exports = UserIdentity;
