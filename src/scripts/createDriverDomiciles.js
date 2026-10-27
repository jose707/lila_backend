'use strict';

const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

(async () => {
  try {
    let migrated = 0;
    let skipped = 0;
    await sequelize.transaction(async transaction => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS driver_domiciles (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          driver_request_id UUID NOT NULL UNIQUE REFERENCES driver_requests(id) ON DELETE CASCADE,
          address VARCHAR(255) NOT NULL,
          location GEOMETRY(POINT, 4326) NOT NULL,
          verification_status VARCHAR(20) NOT NULL DEFAULT 'pending'
            CHECK (verification_status IN ('pending', 'verified', 'rejected')),
          verified_by UUID REFERENCES users(id),
          verified_at TIMESTAMPTZ,
          rejection_reason TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `, { transaction });
      await sequelize.query('CREATE INDEX IF NOT EXISTS idx_driver_domiciles_user ON driver_domiciles(user_id)', { transaction });
      await sequelize.query('CREATE INDEX IF NOT EXISTS idx_driver_domiciles_location ON driver_domiciles USING GIST(location)', { transaction });

      const requests = await sequelize.query(`
        SELECT r.id, r.user_id, r.metadata,
          d.verification_status AS proof_status, d.verified_by, d.verified_at, d.rejection_reason
        FROM driver_requests r
        LEFT JOIN documents d ON d.driver_request_id = r.id AND d.document_type = 'domicileProof'
        WHERE r.metadata ? 'domicile'
      `, { type: QueryTypes.SELECT, transaction });

      for (const request of requests) {
        const domicile = request.metadata?.domicile;
        const address = String(domicile?.address || '').trim();
        const latitude = Number(domicile?.latitude);
        const longitude = Number(domicile?.longitude);
        if (address.length < 8 || address.length > 255 || domicile?.latitude == null || domicile?.longitude == null ||
            !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
          skipped++;
          continue;
        }
        await sequelize.query(`
          INSERT INTO driver_domiciles
            (id, user_id, driver_request_id, address, location, verification_status,
             verified_by, verified_at, rejection_reason)
          VALUES (uuid_generate_v4(), :userId, :requestId, :address,
            ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326), :status,
            :verifiedBy, :verifiedAt, :rejectionReason)
          ON CONFLICT (driver_request_id) DO NOTHING
        `, { replacements: {
          userId: request.user_id,
          requestId: request.id,
          address,
          latitude,
          longitude,
          status: ['verified', 'rejected'].includes(request.proof_status) ? request.proof_status : 'pending',
          verifiedBy: request.verified_by || null,
          verifiedAt: request.verified_at || null,
          rejectionReason: request.rejection_reason || null,
        }, transaction });
        await sequelize.query("UPDATE driver_requests SET metadata = metadata - 'domicile' WHERE id = :requestId", {
          replacements: { requestId: request.id }, transaction,
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
