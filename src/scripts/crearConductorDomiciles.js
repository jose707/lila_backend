'use strict';

const sequelize = require("../config/baseDatos");
const { QueryTypes: ConsultaTipos } = require('sequelize');

(async () => {
  try {
    let migrated = 0;
    let skipped = 0;
    await sequelize.transaction(async (transaccion) => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS documento_domicilio (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
          driver_request_id UUID NOT NULL UNIQUE REFERENCES solicitud_conductor(id) ON DELETE CASCADE,
          address VARCHAR(255) NOT NULL,
          location GEOMETRY(POINT, 4326) NOT NULL,
          verification_status VARCHAR(20) NOT NULL DEFAULT 'pendiente'
            CHECK (verification_status IN ('pendiente', 'verificado', 'rechazado')),
          verified_by UUID REFERENCES usuario(id),
          verified_at TIMESTAMPTZ,
          rejection_reason TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `, { transaction: transaccion });
      await sequelize.query("CREATE INDEX IF NOT EXISTS idx_driver_domiciles_user ON documento_domicilio(user_id)", { transaction: transaccion });
      await sequelize.query("CREATE INDEX IF NOT EXISTS idx_driver_domiciles_location ON documento_domicilio USING GIST(location)", { transaction: transaccion });

      const solicitudes = await sequelize.query(`
        SELECT r.id, r.user_id, r.metadata,
          d.verification_status AS proof_status, d.verified_by, d.verified_at, d.rejection_reason
        FROM solicitud_conductor r
        LEFT JOIN documento d ON d.driver_request_id = r.id AND d.document_type = 'domicileProof'
        WHERE r.metadata ? 'domicile'
      `, { type: ConsultaTipos.SELECT, transaction: transaccion });

      for (const solicitud of solicitudes) {
        const domicilio = solicitud.metadata?.domicile;
        const direccion = String(domicilio?.address || '').trim();
        const latitud = Number(domicilio?.latitude);
        const longitud = Number(domicilio?.longitude);
        if (direccion.length < 8 || direccion.length > 255 || domicilio?.latitude == null || domicilio?.longitude == null ||
        !Number.isFinite(latitud) || !Number.isFinite(longitud) ||
        latitud < -90 || latitud > 90 || longitud < -180 || longitud > 180) {
          skipped++;
          continue;
        }
        await sequelize.query(`
          INSERT INTO documento_domicilio
            (id, user_id, driver_request_id, address, location, verification_status,
             verified_by, verified_at, rejection_reason)
          VALUES (uuid_generate_v4(), :userId, :requestId, :address,
            ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326), :status,
            :verifiedBy, :verifiedAt, :rejectionReason)
          ON CONFLICT (driver_request_id) DO NOTHING
        `, { replacements: {
            userId: solicitud.user_id,
            requestId: solicitud.id,
            address: direccion,
            latitude: latitud,
            longitude: longitud,
            status: ['verificado', 'rechazado'].includes(solicitud.proof_status) ? solicitud.proof_status : 'pendiente',
            verifiedBy: solicitud.verified_by || null,
            verifiedAt: solicitud.verified_at || null,
            rejectionReason: solicitud.rejection_reason || null
          }, transaction: transaccion });
        await sequelize.query("UPDATE solicitud_conductor SET metadata = metadata - 'domicile' WHERE id = :requestId", {
          replacements: { requestId: solicitud.id }, transaction: transaccion
        });
        migrated++;
      }
    });
    console.log(`Domicilios migrados: ${migrated}. Registros inválidos conservados en metadata: ${skipped}.`);
  } catch (error) {
    console.error('No se pudo crear o completar driver_domiciles:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
