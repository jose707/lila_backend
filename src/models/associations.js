// backend/src/models/associations.js
// Central place to declare all Sequelize associations.
// Loaded once from index.js — do NOT call sequelize.define() here.

const User                = require('./User');
const Driver              = require('./Driver');
const Ride                = require('./Ride');
const RideOffer           = require('./RideOffer');
const Payment             = require('./Payment');
const Rating              = require('./Rating');
const Vehicle             = require('./Vehicle');
const DriverLocation      = require('./DriverLocation');
const DriverRequest       = require('./DriverRequest');
const RequestFile         = require('./RequestFile');
const Notification        = require('./Notification');
const PromoCode           = require('./PromoCode');
const CancellationReason  = require('./CancellationReason');
const DriverEarning       = require('./DriverEarning');
const CommissionSettlement = require('./CommissionSettlement');
const ServiceArea         = require('./ServiceArea');
const PricingRule         = require('./PricingRule');
const AuditLog            = require('./AuditLog');

const setupAssociations = () => {

  // ─────────────────────────────────────────
  // USER ↔ DRIVER
  // ─────────────────────────────────────────
  User.hasOne(Driver, { foreignKey: 'userId', as: 'driverProfile' });
  Driver.belongsTo(User, { foreignKey: 'userId', as: 'user' });

  // ─────────────────────────────────────────
  // USER ↔ RIDE (as passenger)
  // ─────────────────────────────────────────
  User.hasMany(Ride, { foreignKey: 'passengerId', as: 'ridesAsPassenger' });
  Ride.belongsTo(User, { foreignKey: 'passengerId', as: 'passenger' });

  // ─────────────────────────────────────────
  // DRIVER ↔ RIDE
  // ─────────────────────────────────────────
  Driver.hasMany(Ride, { foreignKey: 'driverId', as: 'ridesAsDriver' });
  Ride.belongsTo(Driver, { foreignKey: 'driverId', as: 'driver' });

  // ─────────────────────────────────────────
  // DRIVER ↔ VEHICLE
  // ─────────────────────────────────────────
  Driver.hasMany(Vehicle, { foreignKey: 'driver_id', as: 'vehicles', onDelete: 'CASCADE' });
  Vehicle.belongsTo(Driver, { foreignKey: 'driver_id', as: 'driver' });

  // ─────────────────────────────────────────
  // DRIVER ↔ DRIVER LOCATION (1-to-1)
  // ─────────────────────────────────────────
  Driver.hasOne(DriverLocation, { foreignKey: 'driver_id', as: 'location', onDelete: 'CASCADE' });
  DriverLocation.belongsTo(Driver, { foreignKey: 'driver_id', as: 'driver' });

  // ─────────────────────────────────────────
  // DRIVER ↔ DRIVER REQUEST
  // ─────────────────────────────────────────
  Driver.hasMany(DriverRequest, { foreignKey: 'driverId', onDelete: 'CASCADE' });
  DriverRequest.belongsTo(Driver, { foreignKey: 'driverId' });
  User.hasMany(DriverRequest, { foreignKey: 'userId' });
  DriverRequest.belongsTo(User, { foreignKey: 'userId' });

  // ─────────────────────────────────────────
  // DRIVER REQUEST ↔ REQUEST FILE
  // ─────────────────────────────────────────
  DriverRequest.hasMany(RequestFile, { foreignKey: 'requestId', onDelete: 'CASCADE' });
  RequestFile.belongsTo(DriverRequest, { foreignKey: 'requestId' });

  // ─────────────────────────────────────────
  // RIDE ↔ RIDE OFFER
  // ─────────────────────────────────────────
  Ride.hasMany(RideOffer, { foreignKey: 'ride_id', as: 'offers', onDelete: 'CASCADE' });
  RideOffer.belongsTo(Ride, { foreignKey: 'ride_id', as: 'ride' });
  Driver.hasMany(RideOffer, { foreignKey: 'driver_id', as: 'rideOffers', onDelete: 'CASCADE' });
  RideOffer.belongsTo(Driver, { foreignKey: 'driver_id', as: 'driver' });

  // ─────────────────────────────────────────
  // RIDE ↔ PAYMENT (1-to-1)
  // ─────────────────────────────────────────
  Ride.hasOne(Payment, { foreignKey: 'rideId', as: 'payment', onDelete: 'CASCADE' });
  Payment.belongsTo(Ride, { foreignKey: 'rideId', as: 'ride' });
  User.hasMany(Payment, { foreignKey: 'passengerId', as: 'payments', onDelete: 'CASCADE' });
  Payment.belongsTo(User, { foreignKey: 'passengerId', as: 'passenger' });

  // ─────────────────────────────────────────
  // RIDE ↔ RATING
  // ─────────────────────────────────────────
  Ride.hasMany(Rating, { foreignKey: 'rideId', as: 'ratings', onDelete: 'CASCADE' });
  Rating.belongsTo(Ride, { foreignKey: 'rideId', as: 'ride' });
  Driver.hasMany(Rating, { foreignKey: 'driverId', as: 'ratingsReceived', onDelete: 'CASCADE' });
  Rating.belongsTo(Driver, { foreignKey: 'driverId', as: 'driver' });
  User.hasMany(Rating, { foreignKey: 'passengerId', as: 'ratingsGiven', onDelete: 'CASCADE' });
  Rating.belongsTo(User, { foreignKey: 'passengerId', as: 'passenger' });

  // ─────────────────────────────────────────
  // USER ↔ NOTIFICATION
  // ─────────────────────────────────────────
  User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications' });
  Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

  // ─────────────────────────────────────────
  // PROMO CODE ↔ RIDE
  // ─────────────────────────────────────────
  PromoCode.hasMany(Ride, { foreignKey: 'promo_code_id', as: 'rides' });
  Ride.belongsTo(PromoCode, { foreignKey: 'promo_code_id', as: 'promoCode' });

  // ─────────────────────────────────────────
  // CANCELLATION REASON ↔ RIDE
  // ─────────────────────────────────────────
  CancellationReason.hasMany(Ride, { foreignKey: 'cancellation_reason_id', as: 'rides' });
  Ride.belongsTo(CancellationReason, { foreignKey: 'cancellation_reason_id', as: 'cancellationReason' });

  // ─────────────────────────────────────────
  // SERVICE AREA ↔ RIDE
  // ─────────────────────────────────────────
  ServiceArea.hasMany(Ride, { foreignKey: 'service_area_id', as: 'rides' });
  Ride.belongsTo(ServiceArea, { foreignKey: 'service_area_id', as: 'serviceArea' });

  // ─────────────────────────────────────────
  // DRIVER ↔ DRIVER EARNING
  // ─────────────────────────────────────────
  Driver.hasMany(DriverEarning, { foreignKey: 'driver_id', as: 'earnings' });
  DriverEarning.belongsTo(Driver, { foreignKey: 'driver_id', as: 'driver' });
  Ride.hasOne(DriverEarning, { foreignKey: 'ride_id', as: 'earning' });
  DriverEarning.belongsTo(Ride, { foreignKey: 'ride_id', as: 'ride' });

  // ─────────────────────────────────────────
  // DRIVER ↔ COMMISSION SETTLEMENT
  // ─────────────────────────────────────────
  Driver.hasMany(CommissionSettlement, { foreignKey: 'driver_id', as: 'settlements' });
  CommissionSettlement.belongsTo(Driver, { foreignKey: 'driver_id', as: 'driver' });
  CommissionSettlement.hasMany(DriverEarning, { foreignKey: 'settlement_id', as: 'earnings' });
  DriverEarning.belongsTo(CommissionSettlement, { foreignKey: 'settlement_id', as: 'settlement' });

  // ─────────────────────────────────────────
  // AUDIT LOG ↔ USER
  // ─────────────────────────────────────────
  User.hasMany(AuditLog, { foreignKey: 'changed_by', as: 'auditLogs' });
  AuditLog.belongsTo(User, { foreignKey: 'changed_by', as: 'changedBy' });
};

module.exports = setupAssociations;
