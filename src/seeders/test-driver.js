'use strict';

const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');
const User = require('../models/User');
const Driver = require('../models/Driver');
const Vehicle = require('../models/Vehicle');

const TEST_DRIVER = {
  id: '00000000-0000-0000-0000-000000000002',
  email: 'conductor.prueba@linealila.test',
  phone: '+59179990001',
  password: 'Conductor123!',
};
const TEST_VEHICLE = {
  brand: 'Prueba',
  model: 'Taxi',
  year: 2020,
  color: 'Blanco',
  plate: 'TEST-0001',
  capacity: 4,
  vehicle_type: 'taxi',
  status: 'active',
};

async function seedTestDriver() {
  try {
    await sequelize.authenticate();
    await sequelize.transaction(async transaction => {
      const passwordHash = await bcrypt.hash(TEST_DRIVER.password, 10);
      let user = await User.findOne({
        where: { email: TEST_DRIVER.email },
        paranoid: false,
        transaction,
      });

      if (!user) {
        user = await User.create({
          id: TEST_DRIVER.id,
          firebaseUid: 'test-driver-seed',
          email: TEST_DRIVER.email,
          phone: TEST_DRIVER.phone,
          password: passwordHash,
          role: 'driver',
          currentMode: 'driver',
          isActive: true,
          phoneVerified: true,
        }, { transaction });
      } else {
        if (user.deleted_at) await user.restore({ transaction });
        await user.update({
          firebaseUid: user.firebaseUid || 'test-driver-seed',
          phone: TEST_DRIVER.phone,
          password: passwordHash,
          role: 'driver',
          currentMode: 'driver',
          isActive: true,
          phoneVerified: true,
        }, { transaction });
      }

      const [driver] = await Driver.findOrCreate({
        where: { userId: user.id },
        defaults: { status: 'approved', isAvailable: false },
        transaction,
      });
      if (driver.deleted_at) await driver.restore({ transaction });
      await driver.update({ status: 'approved', isAvailable: false }, { transaction });

      const testVehicle = await Vehicle.findOne({
        where: { driver_id: driver.id, plate: TEST_VEHICLE.plate },
        paranoid: false,
        transaction,
      });
      if (testVehicle) {
        if (testVehicle.deleted_at) await testVehicle.restore({ transaction });
        if (testVehicle.status !== 'active') await testVehicle.update({ status: 'active' }, { transaction });
      } else {
        const activeTaxi = await Vehicle.findOne({
          where: { driver_id: driver.id, vehicle_type: 'taxi', status: 'active' },
          transaction,
        });
        if (!activeTaxi) {
          await Vehicle.create({ driver_id: driver.id, ...TEST_VEHICLE }, { transaction });
        }
      }
    });

    console.log('Conductor de prueba listo.');
    console.log(`Correo: ${TEST_DRIVER.email}`);
    console.log(`Contraseña: ${TEST_DRIVER.password}`);
  } catch (error) {
    console.error('No se pudo crear el conductor de prueba:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

seedTestDriver();
