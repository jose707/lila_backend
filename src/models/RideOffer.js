// backend/src/models/RideOffer.js
'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RideOffer = sequelize.define(
  'RideOffer',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    ride_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'rides', key: 'id' },
    },
    driver_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'drivers', key: 'id' },
    },
    offered_price: {
      type: DataTypes.NUMERIC(10, 2),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('pending', 'accepted', 'rejected', 'expired', 'cancelled'),
      defaultValue: 'pending',
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    tableName: 'ride_offers',
    timestamps: true,
    underscored: true,
  }
);

module.exports = RideOffer;
