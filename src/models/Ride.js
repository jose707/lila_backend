// backend/src/models/Ride.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const Ride = sequelize.define(
  'Ride',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: () => uuidv4(),
      primaryKey: true,
    },
    passengerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      field: 'passenger_id',
    },
    driverId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'drivers',
        key: 'id',
      },
      comment:
        'Referencia a Driver.id (solo conductores aprobados pueden tener rides)',
      field: 'driver_id',
    },
    pickupLocation: {
      type: DataTypes.GEOMETRY('POINT', 4326),
      allowNull: false,
      comment: 'Pickup location as PostGIS point (longitude, latitude) - WGS84',
      field: 'pickup_location',
    },
    pickup_address: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Human-readable pickup address',
    },
    dropoffLocation: {
      type: DataTypes.GEOMETRY('POINT', 4326),
      allowNull: false,
      comment:
        'Dropoff location as PostGIS point (longitude, latitude) - WGS84',
      field: 'dropoff_location',
    },
    dropoff_address: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Human-readable dropoff address',
    },
    distance: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    duration: {
      type: DataTypes.INTEGER, // 🔥 En SEGUNDOS (no minutos)
      allowNull: false,
    },
    baseFare: {
      type: DataTypes.FLOAT,
      defaultValue: 3.0,
      field: 'base_fare',
    },
    farePerKm: {
      type: DataTypes.FLOAT,
      defaultValue: 1.2,
      field: 'fare_per_km',
    },
    farePerMinute: {
      type: DataTypes.FLOAT,
      defaultValue: 0.15,
      field: 'fare_per_minute',
    },
    totalFare: {
      type: DataTypes.FLOAT,
      allowNull: false,
      field: 'total_fare',
    },
    discountAmount: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
      field: 'discount_amount',
    },
    finalFare: {
      type: DataTypes.FLOAT,
      allowNull: false,
      field: 'final_fare',
    },
    status: {
      type: DataTypes.ENUM(
        'requested',
        'offered', // at least one driver made an offer
        'accepted',
        'arrived',
        'in_progress',
        'completed',
        'cancelled',
        'expired',
      ),
      defaultValue: 'requested',
    },
    vehicle_type_requested: {
      type: DataTypes.ENUM('taxi', 'minibus', 'bus', 'motorcycle'),
      allowNull: true,
    },
    paymentMethod: {
      type: DataTypes.ENUM('cash', 'qr'),
      allowNull: false,
      defaultValue: 'cash',
      field: 'payment_method',
      comment: 'Método de pago seleccionado por el pasajero: cash o qr',
    },
    service_area_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'service_areas', key: 'id' },
      comment:
        'Zona donde ocurrió el viaje. NULL = dato histórico previo a zonas',
    },
    promo_code_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'promo_codes', key: 'id' },
    },
    cancellation_reason_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'cancellation_reasons', key: 'id' },
    },
    expiresAt: {
      type: DataTypes.DATE,
      defaultValue: () => new Date(Date.now() + 2 * 60 * 1000), // 2 minutos desde ahora
      comment:
        'Fecha de expiración de la solicitud (120 segundos después de requestedAt)',
      field: 'expires_at',
    },
    acceptedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'accepted_at',
    },
    arrivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fecha cuando el conductor llegó al punto de recogida',
      field: 'arrived_at',
    },
    passengerReadyAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fecha cuando el pasajero confirmó que está listo',
      field: 'passenger_ready_at',
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'started_at',
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'completed_at',
    },
    cancelledBy: {
      type: DataTypes.ENUM('passenger', 'driver', 'system'),
      allowNull: true,
      field: 'cancelled_by',
    },
    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'cancelled_at',
    },

    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: 'rides',
    paranoid: true,
    deletedAt: 'deleted_at',
  },
);

module.exports = Ride;
