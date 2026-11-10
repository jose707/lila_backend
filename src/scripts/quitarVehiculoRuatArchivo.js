'use strict';

const sequelize = require("../config/baseDatos");
const { QueryTypes: ConsultaTipos } = require('sequelize');

(async () => {
  try {
    await sequelize.transaction(async (transaccion) => {
      const [estadoColumna] = await sequelize.query(`
        SELECT udt_name, data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'vehiculo' AND column_name = 'status'
      `, { type: ConsultaTipos.SELECT, transaction: transaccion });
      if (!estadoColumna || estadoColumna.data_type !== 'USER-DEFINED') {
        throw new Error('No se encontró el ENUM de vehicles.status.');
      }
      const [columna] = await sequelize.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'vehiculo' AND column_name = 'ruat_file'
      `, { type: ConsultaTipos.SELECT, transaction: transaccion });
      if (columna) {
        const [resultado] = await sequelize.query(`
        SELECT COUNT(*)::integer AS missing_count
        FROM vehiculo v
        JOIN conductor dr ON dr.id = v.driver_id
        WHERE v.ruat_file IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM documento d
            WHERE d.user_id = dr.user_id
              AND d.document_type = 'ruatPhoto'
              AND d.file_path = v.ruat_file
              AND d.driver_request_id = (
                SELECT r.id FROM solicitud_conductor r
                WHERE r.user_id = dr.user_id ORDER BY r.version DESC LIMIT 1
              )
          )
        `, { type: ConsultaTipos.SELECT, transaction: transaccion });
        if (resultado.missing_count > 0) {
          throw new Error(`${resultado.missing_count} RUAT tienen archivo solo en vehicles; conserva la columna y migra esos archivos a documents primero.`);
        }
      }
      const enumeracionNombre = `"${estadoColumna.udt_name.replace(/"/g, '""')}"`;
      await sequelize.query(`ALTER TYPE ${enumeracionNombre} ADD VALUE IF NOT EXISTS 'suspendido'`, { transaction: transaccion });
      await sequelize.query("ALTER TABLE vehiculo DROP COLUMN IF EXISTS ruat_file", { transaction: transaccion });
    });
    console.log('Estado suspended habilitado y vehicles.ruat_file eliminado; archivos conservados en documents.');
  } catch (error) {
    console.error('No se pudo actualizar vehicles:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
