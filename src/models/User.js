// backend/src/models/User.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const User = sequelize.define(
  'User',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: () => uuidv4(),
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: 'users_email_unique',
      validate: {
        isEmail: true,
      },
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: 'users_phone_unique',
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    firebaseUid: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: 'users_firebase_uid_unique',
      field: 'firebase_uid',
    },
    fcmToken: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'fcm_token',
      comment: 'Firebase Cloud Messaging Device Token for Push Notifications',
    },
    role: {
      type: DataTypes.ENUM({
        values: ['passenger', 'driver', 'admin'],
      }),
      defaultValue: 'passenger',
    },
    profilePhoto: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'profile_photo',
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active',
    },
    isVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_verified',
    },
    lastLogin: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'last_login',
    },
    currentMode: {
      type: DataTypes.STRING(20),
      defaultValue: 'passenger',
      comment: 'Modo actual: passenger (pasajero) o driver (conductor)',
      field: 'current_mode',
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: 'users',
    paranoid: true,
    deletedAt: 'deleted_at',
  },
);


module.exports = User;
