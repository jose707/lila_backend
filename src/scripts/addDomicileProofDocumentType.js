'use strict';

const sequelize = require('../config/database');

(async () => {
  let transaction;
  try {
    transaction = await sequelize.transaction();
    await sequelize.query(
      'ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_document_type_check',
      { transaction },
    );
    await sequelize.query(`
      ALTER TABLE documents ADD CONSTRAINT documents_document_type_check
        CHECK (document_type IN (
          'ciFront', 'ciBack', 'profilePhoto', 'licenseFront', 'licenseBack',
          'ticPhoto', 'antecedentsPhoto', 'ruatPhoto', 'soatPhoto', 'domicileProof',
          'carFront', 'carBack', 'carLeft', 'carRight'
        ))
    `, { transaction });
    await transaction.commit();
    console.log('La base de datos ahora acepta comprobantes de domicilio.');
  } catch (error) {
    if (transaction && !transaction.finished) await transaction.rollback();
    console.error('No se pudo habilitar el comprobante de domicilio:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
