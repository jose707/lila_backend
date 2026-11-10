'use strict';

const sequelize = require("../config/baseDatos");

(async () => {
  try {
    await sequelize.query("ALTER TYPE driver_request_status ADD VALUE IF NOT EXISTS 'observado' AFTER 'pendiente'");
    console.log('Estado observed habilitado para solicitudes de conductores.');
  } catch (error) {
    console.error('No se pudo agregar el estado observed:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
