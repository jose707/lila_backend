// backend/src/models/Viaje.js
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");
const { v4: uuidv4 } = require('uuid');

const Viaje = sequelize.define(
  'Ride',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: () => uuidv4(),
      primaryKey: true
    },
    passengerId: {
      type: DatosTipos.UUID,
      allowNull: false,
      references: {
        model: "usuario",
        key: 'id'
      },
      field: 'passenger_id'
    },
    driverId: {
      type: DatosTipos.UUID,
      allowNull: true,
      references: {
        model: "conductor",
        key: 'id'
      },
      comment:
      'Referencia a Driver.id (solo conductores aprobados pueden tener rides)',
      field: 'driver_id'
    },
    pickupLocation: {
      type: DatosTipos.GEOMETRY('POINT', 4326),
      allowNull: false,
      comment: 'Pickup location as PostGIS point (longitude, latitude) - WGS84',
      field: 'pickup_location'
    },
    pickup_address: {
      type: DatosTipos.TEXT,
      allowNull: false,
      comment: 'Human-readable pickup address'
    },
    dropoffLocation: {
      type: DatosTipos.GEOMETRY('POINT', 4326),
      allowNull: false,
      comment:
      'Dropoff location as PostGIS point (longitude, latitude) - WGS84',
      field: 'dropoff_location'
    },
    dropoff_address: {
      type: DatosTipos.TEXT,
      allowNull: false,
      comment: 'Human-readable dropoff address'
    },
    distance: {
      type: DatosTipos.FLOAT,
      allowNull: false
    },
    duration: {
      type: DatosTipos.INTEGER, // 🔥 En SEGUNDOS (no minutos)
      allowNull: false
    },
    baseFare: {
      type: DatosTipos.FLOAT,
      defaultValue: 3.0,
      field: 'base_fare'
    },
    farePerKm: {
      type: DatosTipos.FLOAT,
      defaultValue: 1.2,
      field: 'fare_per_km'
    },
    farePerMinute: {
      type: DatosTipos.FLOAT,
      defaultValue: 0.15,
      field: 'fare_per_minute'
    },
    totalFare: {
      type: DatosTipos.FLOAT,
      allowNull: false,
      field: 'total_fare'
    },
    finalFare: {
      type: DatosTipos.FLOAT,
      allowNull: false,
      field: 'final_fare'
    },
    status: {
      type: DatosTipos.ENUM(
        'solicitado',
        'ofertado', // at least one driver made an offer
        'aceptado',
        'llegado',
        'en_curso',
        'completado',
        'cancelado',
        'vencido'
      ),
      defaultValue: 'solicitado'
    },
    requestMode: { type: DatosTipos.STRING, allowNull: false, defaultValue: 'negociacion', field: 'request_mode' },
    requestKey: { type: DatosTipos.STRING, field: 'request_key' },
    pickupDistance: { type: DatosTipos.DOUBLE, field: 'pickup_distance' },
    pickupDuration: { type: DatosTipos.INTEGER, field: 'pickup_duration' },
    vehicle_type_requested: {
      type: DatosTipos.ENUM('taxi', 'minibus', 'bus', 'motocicleta'),
      allowNull: true
    },
    paymentMethod: {
      type: DatosTipos.ENUM('efectivo', 'qr'),
      allowNull: false,
      defaultValue: 'efectivo',
      field: 'payment_method',
      comment: 'Método de pago seleccionado por el pasajero: cash o qr'
    },
    service_area_id: {
      type: DatosTipos.UUID,
      allowNull: true,
      references: { model: "zona_servicio", key: 'id' },
      comment:
      'Zona donde ocurrió el viaje. NULL = dato histórico previo a zonas'
    },
    cancellation_reason_id: {
      type: DatosTipos.UUID,
      allowNull: true,
      references: { model: "motivo_cancelacion", key: 'id' }
    },
    expiresAt: {
      type: DatosTipos.DATE,
      defaultValue: () => new Date(Date.now() + 2 * 60 * 1000), // 2 minutos desde ahora
      comment:
      'Fecha de expiración de la solicitud (120 segundos después de requestedAt)',
      field: 'expires_at'
    },
    acceptedAt: {
      type: DatosTipos.DATE,
      allowNull: true,
      field: 'accepted_at'
    },
    arrivedAt: {
      type: DatosTipos.DATE,
      allowNull: true,
      comment: 'Fecha cuando el conductor llegó al punto de recogida',
      field: 'arrived_at'
    },
    passengerReadyAt: {
      type: DatosTipos.DATE,
      allowNull: true,
      comment: 'Fecha cuando el pasajero confirmó que está listo',
      field: 'passenger_ready_at'
    },
    startedAt: {
      type: DatosTipos.DATE,
      allowNull: true,
      field: 'started_at'
    },
    rutaRecorrida: {
      type: DatosTipos.GEOMETRY('LINESTRING', 4326),
      allowNull: true,
      field: 'ruta_recorrida'
    },
    completedAt: {
      type: DatosTipos.DATE,
      allowNull: true,
      field: 'completed_at'
    },
    cancelledBy: {
      type: DatosTipos.ENUM('pasajero', 'conductor', 'sistema'),
      allowNull: true,
      field: 'cancelled_by'
    },
    cancelledAt: {
      type: DatosTipos.DATE,
      allowNull: true,
      field: 'cancelled_at'
    },

    deleted_at: {
      type: DatosTipos.DATE,
      allowNull: true
    }
  },
  {
    timestamps: true,
    tableName: "viaje",
    paranoid: true,
    deletedAt: 'deleted_at'
  }
);

module.exports = Viaje;
