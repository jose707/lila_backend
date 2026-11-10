'use strict';

const sequelize = require("../config/baseDatos");
const { QueryTypes: ConsultaTipos } = require('sequelize');

const columnas = ['license_wears_glasses', 'license_uses_hearing_aid'];

(async () => {
  try {
    await sequelize.transaction(async (transaccion) => {
      for (const columna of columnas) {
        const [encontrado] = await sequelize.query(`
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'conductor' AND column_name = :column
        `, { replacements: { column: columna }, type: ConsultaTipos.SELECT, transaction: transaccion });
        if (!encontrado) continue;
        const [resultado] = await sequelize.query(`
          SELECT COUNT(*)::integer AS used_count FROM conductor WHERE ${columna} IS NOT NULL
        `, { type: ConsultaTipos.SELECT, transaction: transaccion });
        if (resultado.used_count > 0) {
          throw new Error(`${columna} contiene ${resultado.used_count} valores. No se eliminó ninguna columna.`);
        }
      }
      for (const columna of columnas) {
        await sequelize.query(`ALTER TABLE conductor DROP COLUMN IF EXISTS ${columna}`, { transaction: transaccion });
      }
    });
    console.log('Columnas de lentes y audífonos eliminadas de drivers.');
  } catch (error) {
    console.error('No se pudieron eliminar las columnas:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
