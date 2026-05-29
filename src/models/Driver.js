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
