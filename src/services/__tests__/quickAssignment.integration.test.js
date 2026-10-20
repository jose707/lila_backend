'use strict';
// Creates and drops ONLY a fresh, uniquely named localhost database. Never migrates application data.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('dotenv').config();
const { Client } = require('pg');
const enabled = process.env.RUN_QUICK_DB_TESTS === '1';
let admin,
  db,
  service,
  Ride,
  created = false;
const database = `linealila_quick_test_${Date.now()}`;
let passenger, secondPassenger, nearDriver, farDriver;
const location = { latitude: -16.5, longitude: -68.15, address: 'Recogida' };
const input = () => ({
  pickupLocation: location,
  dropoffLocation: { ...location, latitude: -16.52, address: 'Destino' },
  vehicleTypeRequested: 'taxi',
  paymentMethod: 'cash',
  requestKey: randomUUID(),
  fare: 0,
  distance: 1,
  duration: 1,
});

before(async () => {
  if (!enabled) return;
  const host = process.env.DB_HOST || 'localhost';
  assert.ok(
    ['localhost', '127.0.0.1', '::1'].includes(host),
    'Tests only run against localhost',
  );
  admin = new Client({
    host,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
  });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  process.env.DB_NAME = database;
  db = require('../../config/database');
  await require('../../../migrations/00000000-initial-schema').up(
    db.getQueryInterface(),
    db.Sequelize,
  );
  require('../assignmentRouting').drivingRoute = async () => ({
    distance: 2000,
    duration: 240,
  });
  // Keep delivery out of these database tests, while exercising the actual transaction service.
  require('../../socket').getIO = () => ({ to: () => ({ emit() {} }) });
  service = require('../quickAssignmentService');
  require('../notificationService').notify = async () => {};
  Ride = require('../../models/Ride');
});
after(async () => {
  if (db) await db.close();
  if (created) {
    assert.match(database, /^linealila_quick_test_\d+$/);
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  }
  if (admin) await admin.end();
});
beforeEach(async () => {
  if (!enabled) return;
  require('../assignmentRouting').drivingRoute = async () => ({
    distance: 2000,
    duration: 240,
  });
  await db.query('TRUNCATE users CASCADE');
  passenger = randomUUID();
  secondPassenger = randomUUID();
  nearDriver = randomUUID();
  farDriver = randomUUID();
  for (const id of [passenger, secondPassenger]) {
    await db.query('INSERT INTO users(id, firebase_uid) VALUES (:id,:id)', {
      replacements: { id },
    });
  }
  for (const [id, latitude] of [
    [nearDriver, -16.501],
    [farDriver, -16.51],
  ]) {
    const user = randomUUID();
    await db.query(
      `INSERT INTO users(id,firebase_uid,role) VALUES (:user,:user,'driver');
      INSERT INTO drivers(id,user_id,status) VALUES (:id,:user,'approved');
      INSERT INTO vehicles(driver_id,brand,model,year,plate,vehicle_type,status) VALUES (:id,'Test','Test',2025,:plate,'taxi','active');
      INSERT INTO driver_locations(driver_id,location,is_online,location_recorded_at)
        VALUES (:id,ST_SetSRID(ST_MakePoint(-68.15,:latitude),4326),true,NOW());`,
      {
        replacements: { id, user, latitude, plate: id.slice(0, 10) },
      },
    );
  }
});
const dbTest = (name, action) => test(name, { skip: !enabled }, action);

dbTest(
  'selecciona al más cercano, calcula en servidor y repite sin duplicar',
  async () => {
    const request = input();
    const ride = await service.reserve(passenger, request);
    assert.equal(ride.driverId, nearDriver);
    assert.equal(ride.status, 'requested');
    assert.equal(ride.distance, 2000);
    assert.equal(Number(ride.pickupSurcharge), 2);
    assert.equal(Number(ride.finalFare), Number(ride.totalFare) + 2);
    assert.ok(new Date(ride.expiresAt) - Date.now() <= 20000);
    assert.equal((await service.reserve(passenger, request)).id, ride.id);
    assert.equal(await Ride.count(), 1);
  },
);
dbTest(
  'descarta ubicación antigua, desconectados, vehículos incompatibles y más de 3 km',
  async () => {
    await db.query(
      "UPDATE driver_locations SET location_recorded_at = NOW() - INTERVAL '2 minutes' WHERE driver_id = :id",
      { replacements: { id: nearDriver } },
    );
    assert.equal(
      (await service.reserve(passenger, input())).driverId,
      farDriver,
    );
    await db.query(
      "UPDATE rides SET status = 'expired'; UPDATE driver_locations SET is_online = false",
    );
    await assert.rejects(
      service.reserve(secondPassenger, input(), undefined, { searchWindowMs: 0 }),
      error => error.code === 'NO_DRIVERS',
    );
    await db.query(
      'UPDATE driver_locations SET is_online = true, location_recorded_at = NOW(), location = ST_SetSRID(ST_MakePoint(-68.15,-16.54),4326)',
    );
    await assert.rejects(
      service.reserve(secondPassenger, input(), undefined, { searchWindowMs: 0 }),
      error => error.code === 'NO_DRIVERS',
    );
    await db.query(
      "UPDATE driver_locations SET location = ST_SetSRID(ST_MakePoint(-68.15,-16.501),4326); UPDATE vehicles SET vehicle_type = 'motorcycle'",
    );
    await assert.rejects(
      service.reserve(secondPassenger, input(), undefined, { searchWindowMs: 0 }),
      error => error.code === 'NO_DRIVERS',
    );
  },
);
dbTest('espera brevemente y asigna apenas aparece un conductor', async () => {
  await db.query('UPDATE driver_locations SET is_online = false');
  const started = Date.now();
  const reservation = service.reserve(passenger, input(), undefined, {
    searchWindowMs: 1500,
    searchIntervalMs: 100,
  });
  await new Promise(resolve => setTimeout(resolve, 250));
  await db.query(
    'UPDATE driver_locations SET is_online = true, location_recorded_at = NOW() WHERE driver_id = :id',
    { replacements: { id: nearDriver } },
  );
  assert.equal((await reservation).driverId, nearDriver);
  assert.ok(Date.now() - started < 1500);
});
dbTest('termina la búsqueda al vencer el plazo sin conductores', async () => {
  await db.query('UPDATE driver_locations SET is_online = false');
  const started = Date.now();
  await assert.rejects(
    service.reserve(passenger, input(), undefined, {
      searchWindowMs: 250,
      searchIntervalMs: 50,
    }),
    error => error.code === 'NO_DRIVERS',
  );
  assert.ok(Date.now() - started >= 250);
});
dbTest('reservas concurrentes nunca comparten conductor', async () => {
  const results = await Promise.all([
    service.reserve(passenger, input()),
    service.reserve(secondPassenger, input()),
  ]);
  assert.notEqual(results[0].driverId, results[1].driverId);
});
dbTest(
  'un solo conductor, dos pasajeros concurrentes: solo uno obtiene reserva',
  async () => {
    await db.query(
      'UPDATE driver_locations SET is_online = false WHERE driver_id = :id',
      { replacements: { id: farDriver } },
    );
    const results = await Promise.allSettled([
      service.reserve(passenger, input(), undefined, { searchWindowMs: 0 }),
      service.reserve(secondPassenger, input(), undefined, { searchWindowMs: 0 }),
    ]);
    assert.equal(
      results.filter(result => result.status === 'fulfilled').length,
      1,
    );
  },
);
dbTest(
  'reserva bloquea otras asignaciones y ofertas de negociación en BD',
  async () => {
    const reserved = await service.reserve(passenger, input());
    const values = {
      ...reserved.toJSON(),
      id: randomUUID(),
      passengerId: secondPassenger,
      requestMode: 'negotiation',
      requestKey: null,
      status: 'accepted',
    };
    values.pickupLocation = { type: 'Point', coordinates: [-68.15, -16.5] };
    values.dropoffLocation = { type: 'Point', coordinates: [-68.15, -16.52] };
    await assert.rejects(
      Ride.create(values),
      error => error.original?.code === '23505',
    );
    values.id = randomUUID();
    values.driverId = null;
    values.status = 'requested';
    const negotiation = await Ride.create(values);
    await assert.rejects(
      db.query(
        `INSERT INTO ride_offers(id,ride_id,driver_id,offered_price,expires_at,status)
    VALUES (:id,:ride,:driver,20,NOW()+INTERVAL '1 minute','pending')`,
        {
          replacements: {
            id: randomUUID(),
            ride: negotiation.id,
            driver: reserved.driverId,
          },
        },
      ),
      error => error.original?.code === '23514',
    );
  },
);
dbTest('rechaza ofertas sobre asignación rápida', async () => {
  const ride = await service.reserve(passenger, input());
  await assert.rejects(
    db.query(
      `INSERT INTO ride_offers(id,ride_id,driver_id,offered_price,expires_at,status)
    VALUES (:id,:ride,:driver,20,NOW()+INTERVAL '1 minute','pending')`,
      {
        replacements: { id: randomUUID(), ride: ride.id, driver: farDriver },
      },
    ),
    error => error.original?.code === '23514',
  );
});
dbTest('vencimiento y cancelación liberan sin revivir la reserva', async () => {
  const ride = await service.reserve(passenger, input());
  await ride.update({ expiresAt: new Date(Date.now() - 1000) });
  assert.equal(
    (await service.finishReservation(passenger, ride.id, true)).status,
    'expired',
  );
  assert.equal(await service.current(passenger), null);
  const next = await service.reserve(passenger, input());
  assert.equal(next.driverId, nearDriver);
  assert.equal(
    (await service.finishReservation(passenger, next.id, false)).status,
    'cancelled',
  );
  assert.equal(
    (await service.finishReservation(passenger, next.id, true)).status,
    'cancelled',
  );
});
dbTest(
  'solo el pasajero dueño puede confirmar; desconexión invalida la confirmación',
  async () => {
    const ride = await service.reserve(passenger, input());
    await assert.rejects(
      service.finishReservation(secondPassenger, ride.id, true),
      error => error.status === 403,
    );
    const [[driver]] = await db.query(
      'SELECT user_id FROM drivers WHERE id = :id',
      { replacements: { id: ride.driverId } },
    );
    await assert.rejects(
      service.finishReservation(driver.user_id, ride.id, true),
      error => error.status === 403,
    );
    assert.equal((await service.current(driver.user_id, true)).id, ride.id);
    await db.query(
      'UPDATE driver_locations SET is_online = false WHERE driver_id = :id',
      { replacements: { id: ride.driverId } },
    );
    assert.equal(
      (await service.finishReservation(passenger, ride.id, true)).status,
      'expired',
    );
  },
);
dbTest(
  'confirmación automática e idempotente; cancelar tarde no desasigna',
  async () => {
    const ride = await service.reserve(passenger, input());
    assert.equal(
      (await service.finishReservation(passenger, ride.id, true)).status,
      'accepted',
    );
    assert.equal(
      (await service.finishReservation(passenger, ride.id, true)).status,
      'accepted',
    );
    assert.equal(
      (await service.finishReservation(passenger, ride.id, false)).status,
      'accepted',
    );
  },
);
dbTest(
  'dos solicitudes simultáneas del mismo pasajero obtienen una sola reserva',
  async () => {
    const [first, second] = await Promise.all([
      service.reserve(passenger, input()),
      service.reserve(passenger, input()),
    ]);
    assert.equal(first.id, second.id);
    assert.equal(await Ride.count(), 1);
  },
);
dbTest(
  'confirmación y cancelación simultáneas producen un único resultado',
  async () => {
    const ride = await service.reserve(passenger, input());
    const [first, second] = await Promise.all([
      service.finishReservation(passenger, ride.id, true),
      service.finishReservation(passenger, ride.id, false),
    ]);
    assert.equal(first.status, second.status);
    assert.ok(['accepted', 'cancelled'].includes(first.status));
  },
);
dbTest(
  'fallar la ruta de recogida revierte todo y no bloquea al conductor',
  async () => {
    let calls = 0;
    require('../assignmentRouting').drivingRoute = async () => {
      if (++calls === 2) throw new Error('routing unavailable');
      return { distance: 2000, duration: 240 };
    };
    await assert.rejects(service.reserve(passenger, input()));
    assert.equal(await Ride.count(), 0);
    require('../assignmentRouting').drivingRoute = async () => ({
      distance: 2000,
      duration: 240,
    });
    assert.equal(
      (await service.reserve(passenger, input())).driverId,
      nearDriver,
    );
  },
);
