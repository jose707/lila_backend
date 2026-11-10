'use strict';

const bcrypt = require('bcryptjs');
const sequelize = require("../config/baseDatos");
const Usuario = require("../models/Usuario");
const Conductor = require("../models/Conductor");
const Vehiculo = require("../models/Vehiculo");

const TEST_CONDUCTOR = {
  id: '00000000-0000-0000-0000-000000000002',
  email: 'conductor.prueba@linealila.test',
  phone: '+59179990001',
  password: 'Conductor123!'
};
const TEST_VEHICULO = {
  brand: 'Prueba',
  model: 'Taxi',
  year: 2020,
  color: 'Blanco',
  plate: 'TEST-0001',
  capacity: 4,
  vehicle_type: 'taxi',
  status: 'activo'
};

async function semillaTestConductor() {
  try {
    await sequelize.authenticate();
    await sequelize.transaction(async (transaccion) => {
      const contrasenaHash = await bcrypt.hash(TEST_CONDUCTOR.password, 10);
      let usuario = await Usuario.findOne({
        where: { email: TEST_CONDUCTOR.email },
        paranoid: false,
        transaction: transaccion
      });

      if (!usuario) {
        usuario = await Usuario.create({
          id: TEST_CONDUCTOR.id,
          firebaseUid: 'test-driver-seed',
          email: TEST_CONDUCTOR.email,
          phone: TEST_CONDUCTOR.phone,
          password: contrasenaHash,
          role: 'conductor',
          modoActual: 'conductor',
          isActive: true,
          phoneVerified: true
        }, { transaction: transaccion });
      } else {
        if (usuario.deleted_at) await usuario.restore({ transaction: transaccion });
        await usuario.update({
          firebaseUid: usuario.firebaseUid || 'test-driver-seed',
          phone: TEST_CONDUCTOR.phone,
          password: contrasenaHash,
          role: 'conductor',
          modoActual: 'conductor',
          isActive: true,
          phoneVerified: true
        }, { transaction: transaccion });
      }

      const [conductor] = await Conductor.findOrCreate({
        where: { userId: usuario.id },
        defaults: { status: 'aprobado', isAvailable: false },
        transaction: transaccion
      });
      if (conductor.deleted_at) await conductor.restore({ transaction: transaccion });
      await conductor.update({ status: 'aprobado', isAvailable: false }, { transaction: transaccion });

      const testVehiculo = await Vehiculo.findOne({
        where: { driver_id: conductor.id, plate: TEST_VEHICULO.plate },
        paranoid: false,
        transaction: transaccion
      });
      if (testVehiculo) {
        if (testVehiculo.deleted_at) await testVehiculo.restore({ transaction: transaccion });
        if (testVehiculo.status !== 'activo') await testVehiculo.update({ status: 'activo' }, { transaction: transaccion });
      } else {
        const activoTaxi = await Vehiculo.findOne({
          where: { driver_id: conductor.id, vehicle_type: 'taxi', status: 'activo' },
          transaction: transaccion
        });
        if (!activoTaxi) {
          const vehicle=await Vehiculo.create({driver_id:conductor.id,status:'activo'},{transaction:transaccion});
          const repo=require('../services/documentosRepositorio');
          const doc=await repo.createDocument({vehicleId:vehicle.id,tipo_documento:'ruatPhoto',ruta_archivo:'seed:ruat-prueba',origen_evidencia:'semilla_desarrollo',estado_verificacion:'verificado',verificado_en:new Date()},transaccion);
          await repo.insert('documento_ruat',{id_documento_ruat:doc,marca:TEST_VEHICULO.brand,modelo:TEST_VEHICULO.model,anio:String(TEST_VEHICULO.year),color:TEST_VEHICULO.color,placa:TEST_VEHICULO.plate,capacidad:String(TEST_VEHICULO.capacity),tipo_vehiculo:TEST_VEHICULO.vehicle_type},transaccion);
        }
      }
    });

    console.log('Conductor de prueba listo.');
    console.log(`Correo: ${TEST_CONDUCTOR.email}`);
    console.log(`Contraseña: ${TEST_CONDUCTOR.password}`);
  } catch (error) {
    console.error('No se pudo crear el conductor de prueba:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

semillaTestConductor();
