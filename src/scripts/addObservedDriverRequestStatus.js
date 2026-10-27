'use strict';

const sequelize = require('../config/database');

(async () => {
  try {
    await sequelize.query("ALTER TYPE driver_request_status ADD VALUE IF NOT EXISTS 'observed' AFTER 'pending'");
    console.log('Estado observed habilitado para solicitudes de conductores.');
  } catch (error) {
    console.error('No se pudo agregar el estado observed:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
