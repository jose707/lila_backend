'use strict';

const RADIUS_METERS = 3000;
const RESERVATION_SECONDS = 20;
const LOCATION_MAX_AGE_SECONDS = 60;
const ACTIVE_STATUSES = ['accepted', 'arrived', 'in_progress'];
const roundMoney = value => Math.round(value * 100) / 100;
const fail = (status, message, code) =>
  Object.assign(new Error(message), { status, code });

function pickupSurcharge(meters) {
  const perKm = Number(process.env.QUICK_PICKUP_FEE_PER_KM ?? 2);
  const maximum = Number(process.env.QUICK_PICKUP_FEE_MAX ?? 4);
  if (
    ![meters, perKm, maximum].every(Number.isFinite) ||
    meters < 0 ||
    perKm < 0 ||
    maximum < 0
  ) {
    throw fail(503, 'La tarifa de recogida no está configurada correctamente.');
  }
  return roundMoney(
    Math.min(maximum, (Math.max(0, meters - 1000) / 1000) * perKm),
  );
}

function validatePoint(point) {
  return (
    point &&
    typeof point.latitude === 'number' &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180 &&
    typeof point.address === 'string' &&
    point.address.trim().length > 0
  );
}

module.exports = {
  RADIUS_METERS,
  RESERVATION_SECONDS,
  LOCATION_MAX_AGE_SECONDS,
  ACTIVE_STATUSES,
  pickupSurcharge,
  roundMoney,
  fail,
  validatePoint,
};
