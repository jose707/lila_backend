'use strict';

// Actualiza bases existentes. La migración maestra ya crea el esquema nuevo.
const sequelize = require('../config/database');

async function removeRetiredSchema() {
  try {
    await sequelize.transaction(async transaction => {
      await sequelize.query(
        'ALTER TABLE IF EXISTS rides DROP COLUMN IF EXISTS promo_code_id',
        { transaction },
      );
      await sequelize.query(
        'DROP TABLE IF EXISTS trusted_contacts, panic_events, promo_codes',
        { transaction },
      );
      await sequelize.query('DROP TYPE IF EXISTS discount_type', { transaction });
    });
    console.log('Esquema anterior retirado correctamente.');
  } finally {
    await sequelize.close();
  }
}

removeRetiredSchema().catch(error => {
  console.error('No se pudo retirar el esquema anterior:', error.message);
  process.exitCode = 1;
});
