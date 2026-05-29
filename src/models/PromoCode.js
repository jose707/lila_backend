// backend/src/models/PromoCode.js
'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PromoCode = sequelize.define(
  'PromoCode',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: 'promo_codes_code_unique',
      comment: 'Código que escribe el usuario, ej: BIENVENIDO20',
    },
    discount_type: {
      type: DataTypes.ENUM('percentage', 'fixed'),
      allowNull: false,
    },
    discount_value: {
      type: DataTypes.DOUBLE,
      allowNull: false,
      comment: '20 = 20% descuento, o 5 = BOB 5 de descuento fijo',
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    max_uses: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'NULL = ilimitado',
    },
    uses_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'promo_codes',
    timestamps: true,
    underscored: true,
    paranoid: true,       // enables soft delete via deleted_at
    deletedAt: 'deleted_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = PromoCode;
