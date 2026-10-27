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
    console.log('La base de datos ahora acepta el documento TIC.');
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error('No se pudo habilitar TIC:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
