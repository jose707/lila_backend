// backend/src/models/Pago.js
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");
const { v4: uuidv4 } = require('uuid');

const Pago = sequelize.define(
  'Payment',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: () => uuidv4(),
      primaryKey: true
    },
    rideId: {
      type: DatosTipos.UUID,
      allowNull: false,
      unique: "unico_viaje_pago", // Ensures only one payment per ride
      references: {
        model: "viaje",
        key: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      field: 'ride_id'
    },
    passengerId: { type: DatosTipos.VIRTUAL },
    passenger: { type: DatosTipos.VIRTUAL },
    amount: {
      type: DatosTipos.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0
      },
      comment: 'Payment amount in currency units'
    },
    currency: {
      type: DatosTipos.STRING(3),
      allowNull: false,
      defaultValue: 'BOB',
      validate: {
        len: [3, 3] // ISO 4217 currency codes are 3 letters
      }
    },
    // Valor de lectura obtenido de viaje; no se almacena en pago.
    payment_method: {
      type: DatosTipos.ENUM('efectivo', 'qr'),
      allowNull: true
    },
    payment_status: {
      type: DatosTipos.ENUM('pendiente', 'completado', 'fallido', 'reembolsado'),
      allowNull: false,
      defaultValue: 'pendiente'
    },
    transaction_id: {
      type: DatosTipos.STRING,
      allowNull: true,
      comment: 'External transaction ID from payment gateway'
    },
    paid_at: {
      type: DatosTipos.DATE,
      allowNull: true,
      comment: 'Timestamp when payment was completed/failed'
    }
  },
  {
    tableName: "pago",
    timestamps: true,
    indexes: [
    {
      fields: ['ride_id'],
      unique: true // Enforce via index
    },
    {
      fields: ['payment_status']
    },
    {
      fields: ['created_at']
    }]

  }
);

Pago.addHook('afterFind', async (result,options) => {
  for(const row of (Array.isArray(result)?result:result?[result]:[])) {
    const ride=row.ride || await require('./Viaje').findByPk(row.rideId,{attributes:['id','passengerId'],transaction:options.transaction});
    row.setDataValue('passengerId',ride?.passengerId);
    if(ride?.passenger)row.setDataValue('passenger',ride.passenger);
  }
});
module.exports = Pago;
