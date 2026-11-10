'use strict';

// Actualiza bases existentes. La migración maestra ya crea el esquema nuevo.
const sequelize = require("../config/baseDatos");

async function quitarRetiredEsquema() {
  try {
    await sequelize.transaction(async (transaccion) => {
      await sequelize.query(
        "ALTER TABLE IF EXISTS viaje DROP COLUMN IF EXISTS promo_code_id",
        { transaction: transaccion }
      );
      await sequelize.query(
        "DROP TABLE IF EXISTS trusted_contacts, panic_events, promo_codes",
        { transaction: transaccion }
      );
      await sequelize.query("DROP TYPE IF EXISTS discount_type", { transaction: transaccion });
    });
    console.log('Esquema anterior retirado correctamente.');
  } finally {
    await sequelize.close();
  }
}

quitarRetiredEsquema().catch((error) => {
  console.error('No se pudo retirar el esquema anterior:', error.message);
  process.exitCode = 1;
});
