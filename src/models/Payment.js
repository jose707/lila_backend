// backend/src/models/Payment.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const Payment = sequelize.define(
  'Payment',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: () => uuidv4(),
      primaryKey: true,
    },
    rideId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: 'unique_ride_payment', // Ensures only one payment per ride
      references: {
        model: 'rides',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      field: 'ride_id',
    },
    passengerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      field: 'passenger_id',
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0,
      },
      comment: 'Payment amount in currency units',
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'BOB',
      validate: {
        len: [3, 3], // ISO 4217 currency codes are 3 letters
      },
    },
    payment_method: {
      type: DataTypes.ENUM('cash', 'qr'),
      allowNull: false,
      defaultValue: 'cash',
    },
    payment_status: {
      type: DataTypes.ENUM('pending', 'completed', 'failed', 'refunded'),
      allowNull: false,
      defaultValue: 'pending',
    },
    transaction_id: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'External transaction ID from payment gateway',
    },
    paid_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Timestamp when payment was completed/failed',
    },
  },
  {
    tableName: 'payments',
    timestamps: true,
    indexes: [
      {
        fields: ['ride_id'],
        unique: true, // Enforce via index
      },
      {
        fields: ['passenger_id'],
      },
      {
        fields: ['payment_status'],
      },
      {
        fields: ['created_at'],
      },
    ],
  },
);

module.exports = Payment;
