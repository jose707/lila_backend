// backend/src/models/Driver.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const User = require('./User');

const Driver = sequelize.define(
  'Driver',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: () => uuidv4(),
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      field: 'user_id',
    },
    licenseNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: 'drivers_license_number_unique',
      field: 'license_number',
    },
    licenseExpiry: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'license_expiry',
    },
    licenseNationality: { type: DataTypes.STRING, allowNull: true, field: 'license_nationality' },
    licenseIssueDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'license_issue_date' },
    licenseCategory: { type: DataTypes.STRING, allowNull: true, field: 'license_category' },
    licenseWearsGlasses: { type: DataTypes.BOOLEAN, allowNull: true, field: 'license_wears_glasses' },
    licenseUsesHearingAid: { type: DataTypes.BOOLEAN, allowNull: true, field: 'license_uses_hearing_aid' },
    licenseVerificationStatus: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending', field: 'license_verification_status' },
    licenseVerifiedAt: { type: DataTypes.DATE, allowNull: true, field: 'license_verified_at' },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected', 'suspended'),
      defaultValue: 'pending',
    },
    rejectionReason: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'rejection_reason',
    },
    isAvailable: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_available',
    },

    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: 'drivers',
    paranoid: true,
    deletedAt: 'deleted_at',
  },
);

module.exports = Driver;
