// backend/src/models/associations.js
// Central place to declare all Sequelize associations.
// Loaded once from index.js — do NOT call sequelize.define() here.

const Usuario = require("./Usuario");
const UsuarioIdentidad = require("./UsuarioIdentidad");
const Conductor = require("./Conductor");
const Viaje = require("./Viaje");
const ViajeOferta = require("./ViajeOferta");
const Pago = require("./Pago");
const Calificacion = require("./Calificacion");
const Vehiculo = require("./Vehiculo");
const ConductorUbicacion = require("./ConductorUbicacion");
const ConductorSolicitud = require("./ConductorSolicitud");
const ConductorDomicilio = require("./ConductorDomicilio");
const SolicitudArchivo = require("./SolicitudArchivo");
const Notificacion = require("./Notificacion");
const CancelacionMotivo = require("./CancelacionMotivo");
const CobrosConductor = require("./CobrosConductor");
const ComisionLiquidacion = require("./ComisionLiquidacion");
const ServicioZona = require("./ServiceZona");
const TarifasRegla = require("./TarifaRegla");
const AuditoriaRegistro = require("./AuditRegistro");
const ViajeParada = require("./ViajeParada");

const configurarAsociaciones = () => {

  // ─────────────────────────────────────────
  // USER ↔ DRIVER
  // ─────────────────────────────────────────
  Usuario.hasOne(Conductor, { foreignKey: 'userId', as: 'driverProfile' });
  Conductor.belongsTo(Usuario, { foreignKey: 'userId', as: 'user' });
  Usuario.hasOne(UsuarioIdentidad, { foreignKey: 'userId', as: 'identity', onDelete: 'CASCADE' });
  UsuarioIdentidad.belongsTo(Usuario, { foreignKey: 'userId', as: 'user' });

  // ─────────────────────────────────────────
  // USER ↔ RIDE (as passenger)
  // ─────────────────────────────────────────
  Usuario.hasMany(Viaje, { foreignKey: 'passengerId', as: 'ridesAsPassenger' });
  Viaje.belongsTo(Usuario, { foreignKey: 'passengerId', as: 'passenger' });

  // ─────────────────────────────────────────
  // DRIVER ↔ RIDE
  // ─────────────────────────────────────────
  Conductor.hasMany(Viaje, { foreignKey: 'driverId', as: 'ridesAsDriver' });
  Viaje.belongsTo(Conductor, { foreignKey: 'driverId', as: 'driver' });

  // ─────────────────────────────────────────
  // DRIVER ↔ VEHICLE
  // ─────────────────────────────────────────
  Conductor.hasMany(Vehiculo, { foreignKey: 'driver_id', as: 'vehicles', onDelete: 'CASCADE' });
  Vehiculo.belongsTo(Conductor, { foreignKey: 'driver_id', as: 'driver' });

  // ─────────────────────────────────────────
  // DRIVER ↔ DRIVER LOCATION (1-to-1)
  // ─────────────────────────────────────────
  Conductor.hasOne(ConductorUbicacion, { foreignKey: 'driver_id', as: 'location', onDelete: 'CASCADE' });
  ConductorUbicacion.belongsTo(Conductor, { foreignKey: 'driver_id', as: 'driver' });

  // ─────────────────────────────────────────
  // DRIVER ↔ DRIVER REQUEST
  // ─────────────────────────────────────────
  Usuario.hasMany(ConductorSolicitud, { foreignKey: 'userId' });
  ConductorSolicitud.belongsTo(Usuario, { foreignKey: 'userId' });
  Usuario.hasMany(ConductorDomicilio, { foreignKey: 'userId', as: 'driverDomiciles' });
  ConductorDomicilio.belongsTo(Usuario, { foreignKey: 'userId', as: 'user' });
  ConductorSolicitud.hasOne(ConductorDomicilio, { foreignKey: 'driverRequestId', as: 'domicile', onDelete: 'CASCADE' });
  ConductorDomicilio.belongsTo(ConductorSolicitud, { foreignKey: 'driverRequestId', as: 'request' });

  // ─────────────────────────────────────────
  // DRIVER REQUEST ↔ DOCUMENTS
  // RequestFile es el modelo de compatibilidad que usa la tabla documents.
  // ─────────────────────────────────────────
  ConductorSolicitud.hasMany(SolicitudArchivo, { foreignKey: 'requestId', onDelete: 'CASCADE' });
  SolicitudArchivo.belongsTo(ConductorSolicitud, { foreignKey: 'requestId' });

  // ─────────────────────────────────────────
  // RIDE ↔ RIDE OFFER
  // ─────────────────────────────────────────
  Viaje.hasMany(ViajeOferta, { foreignKey: 'ride_id', as: 'offers', onDelete: 'CASCADE' });
  ViajeOferta.belongsTo(Viaje, { foreignKey: 'ride_id', as: 'ride' });
  Conductor.hasMany(ViajeOferta, { foreignKey: 'driver_id', as: 'rideOffers', onDelete: 'CASCADE' });
  ViajeOferta.belongsTo(Conductor, { foreignKey: 'driver_id', as: 'driver' });

  // ─────────────────────────────────────────
  // RIDE ↔ PAYMENT (1-to-1)
  // ─────────────────────────────────────────
  Viaje.hasOne(Pago, { foreignKey: 'rideId', as: 'payment', onDelete: 'CASCADE' });
  Pago.belongsTo(Viaje, { foreignKey: 'rideId', as: 'ride' });

  // ─────────────────────────────────────────
  // RIDE ↔ RATING
  // ─────────────────────────────────────────
  Viaje.hasMany(Calificacion, { foreignKey: 'rideId', as: 'ratings', onDelete: 'CASCADE' });
  Calificacion.belongsTo(Viaje, { foreignKey: 'rideId', as: 'ride' });

  // ─────────────────────────────────────────
  // USER ↔ NOTIFICATION
  // ─────────────────────────────────────────
  Usuario.hasMany(Notificacion, { foreignKey: 'user_id', as: 'notifications' });
  Notificacion.belongsTo(Usuario, { foreignKey: 'user_id', as: 'user' });

  // ─────────────────────────────────────────
  // CANCELLATION REASON ↔ RIDE
  // ─────────────────────────────────────────
  CancelacionMotivo.hasMany(Viaje, { foreignKey: 'cancellation_reason_id', as: 'rides' });
  Viaje.belongsTo(CancelacionMotivo, { foreignKey: 'cancellation_reason_id', as: 'cancellationReason' });

  // ─────────────────────────────────────────
  // SERVICE AREA ↔ RIDE
  // ─────────────────────────────────────────
  ServicioZona.hasMany(Viaje, { foreignKey: 'service_area_id', as: 'rides' });
  Viaje.belongsTo(ServicioZona, { foreignKey: 'service_area_id', as: 'serviceArea' });

  // ─────────────────────────────────────────
  // DRIVER ↔ DRIVER EARNING
  // ─────────────────────────────────────────
  Conductor.hasMany(CobrosConductor, { foreignKey: 'driver_id', as: 'earnings' });
  CobrosConductor.belongsTo(Conductor, { foreignKey: 'driver_id', as: 'driver' });
  Viaje.hasOne(CobrosConductor, { foreignKey: 'ride_id', as: 'earning' });
  CobrosConductor.belongsTo(Viaje, { foreignKey: 'ride_id', as: 'ride' });

  // ─────────────────────────────────────────
  // DRIVER ↔ COMMISSION SETTLEMENT
  // ─────────────────────────────────────────
  Conductor.hasMany(ComisionLiquidacion, { foreignKey: 'driver_id', as: 'settlements' });
  ComisionLiquidacion.belongsTo(Conductor, { foreignKey: 'driver_id', as: 'driver' });
  ComisionLiquidacion.hasMany(CobrosConductor, { foreignKey: 'settlement_id', as: 'earnings' });
  CobrosConductor.belongsTo(ComisionLiquidacion, { foreignKey: 'settlement_id', as: 'settlement' });

  // ─────────────────────────────────────────
  // AUDIT LOG ↔ USER
  // ─────────────────────────────────────────
  Usuario.hasMany(AuditoriaRegistro, { foreignKey: 'changed_by', as: 'auditLogs' });
  AuditoriaRegistro.belongsTo(Usuario, { foreignKey: 'changed_by', as: 'changedBy' });

  // ─────────────────────────────────────────
  // RIDE ↔ RIDE WAYPOINT (paradas intermedias)
  // ─────────────────────────────────────────
  Viaje.hasMany(ViajeParada, { foreignKey: 'ride_id', as: 'waypoints', onDelete: 'CASCADE' });
  ViajeParada.belongsTo(Viaje, { foreignKey: 'ride_id', as: 'ride' });

};

module.exports = configurarAsociaciones;
