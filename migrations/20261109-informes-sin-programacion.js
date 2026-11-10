'use strict';

async function up(db) {
  await db.query('ALTER TABLE public.evaluacion_psicologica ALTER COLUMN programada_en DROP NOT NULL', {
    esquemaFisico: true
  });
  await db.query('ALTER TABLE public.documento_informe_psicologico ALTER COLUMN fecha_emision DROP NOT NULL', {
    esquemaFisico: true
  });
}

if (require.main === module) {
  const db = require('../src/config/baseDatos');
  up(db).then(() => console.log('Informes habilitados con PDF y resultado, sin programación ni fecha de emisión obligatoria.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => db.close());
}

module.exports = { up };
