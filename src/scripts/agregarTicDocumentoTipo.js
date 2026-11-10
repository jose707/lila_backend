'use strict';

const sequelize = require("../config/baseDatos");

(async () => {
  let transaccion;
  try {
    transaccion = await sequelize.transaction();
    await sequelize.query(
      "ALTER TABLE documento DROP CONSTRAINT IF EXISTS documents_document_type_check",
      { transaction: transaccion }
    );
    await sequelize.query(`
      ALTER TABLE documento ADD CONSTRAINT documents_document_type_check
        CHECK (document_type IN (
          'ciFront', 'ciBack', 'profilePhoto', 'licenseFront', 'licenseBack',
          'ticPhoto', 'antecedentsPhoto', 'ruatPhoto', 'soatPhoto', 'domicileProof',
          'carFront', 'carBack', 'carLeft', 'carRight'
        ))
    `, { transaction: transaccion });
    await transaccion.commit();
    console.log('La base de datos ahora acepta el documento TIC.');
  } catch (error) {
    if (transaccion) await transaccion.rollback();
    console.error('No se pudo habilitar TIC:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
