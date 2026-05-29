// backend/src/models/index.js
// Single entry point for all Sequelize models.
// Import from this file anywhere in the app instead of individual model files.

const sequelize           = require('../config/database');
const setupAssociations   = require('./associations');

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

// Wire all associations in one call
setupAssociations();

module.exports = {
  sequelize,
  User,
  Driver,
  Ride,
  RideOffer,
  Payment,
  Rating,
  Vehicle,
  DriverLocation,
  DriverRequest,
  RequestFile,
  Notification,
  PromoCode,
  CancellationReason,
  DriverEarning,
  CommissionSettlement,
  ServiceArea,
  PricingRule,
  AuditLog,
};
