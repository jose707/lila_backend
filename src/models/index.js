// backend/src/models/index.js
// Single entry point for all Sequelize models.
// Import from this file anywhere in the app instead of individual model files.

const sequelize           = require('../config/database');
const setupAssociations   = require('./associations');

const User                = require('./User');
const UserIdentity        = require('./UserIdentity');
const Driver              = require('./Driver');
const Ride                = require('./Ride');
const RideOffer           = require('./RideOffer');
const Payment             = require('./Payment');
const Rating              = require('./Rating');
const Vehicle             = require('./Vehicle');
const DriverLocation      = require('./DriverLocation');
const DriverRequest       = require('./DriverRequest');
const DriverDomicile      = require('./DriverDomicile');
const RequestFile         = require('./RequestFile');
const Notification        = require('./Notification');
const CancellationReason  = require('./CancellationReason');
const DriverEarning       = require('./DriverEarning');
const CommissionSettlement = require('./CommissionSettlement');
const ServiceArea         = require('./ServiceArea');
const PricingRule         = require('./PricingRule');
const AuditLog            = require('./AuditLog');
const RideWaypoint        = require('./RideWaypoint');

// Wire all associations in one call
setupAssociations();

module.exports = {
  sequelize,
  User,
  UserIdentity,
  Driver,
  Ride,
  RideOffer,
  Payment,
  Rating,
  Vehicle,
  DriverLocation,
  DriverRequest,
  DriverDomicile,
  RequestFile,
  Notification,
  CancellationReason,
  DriverEarning,
  CommissionSettlement,
  ServiceArea,
  PricingRule,
  AuditLog,
  RideWaypoint,
};
