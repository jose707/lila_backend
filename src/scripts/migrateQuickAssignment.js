'use strict';
const sequelize = require('../config/database');
const migration = require('../../migrations/00000005-quick-assignment');
(async () => {
  try {
    await migration.up(sequelize.getQueryInterface());
    console.log('Asignación rápida: migración aplicada.');
  } catch (error) {
    console.error('No se aplicó la migración:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
