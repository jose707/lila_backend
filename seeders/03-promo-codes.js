'use strict';

/**
 * Seeder: Códigos promocionales (promo_codes)
 *
 * Códigos de ejemplo para desarrollo y pruebas.
 * ⚠️  Desactívalos o elimínalos antes de subir a producción.
 *
 * Corre con: npx sequelize-cli db:seed --seed 03-promo-codes.js
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('promo_codes', [
      {
        id:             '33333333-0003-0003-0003-000000000001',
        code:           'BIENVENIDO20',
        discount_type:  'percentage',   // 20% de descuento
        discount_value: 20,
        expires_at:     new Date('2026-12-31'),
        max_uses:       1000,
        uses_count:     0,
        is_active:      true,
        deleted_at:     null,
        created_at:     new Date(),
        updated_at:     new Date(),
      },
      {
        id:             '33333333-0003-0003-0003-000000000002',
        code:           'PRIMEROVIAJE',
        discount_type:  'percentage',   // 30% — solo primer viaje
        discount_value: 30,
        expires_at:     new Date('2026-12-31'),
        max_uses:       500,
        uses_count:     0,
        is_active:      true,
        deleted_at:     null,
        created_at:     new Date(),
        updated_at:     new Date(),
      },
      {
        id:             '33333333-0003-0003-0003-000000000003',
        code:           'DESCUENTO5',
        discount_type:  'fixed',        // Bs. 5 de descuento fijo
        discount_value: 5,
        expires_at:     new Date('2026-06-30'),
        max_uses:       200,
        uses_count:     0,
        is_active:      true,
        deleted_at:     null,
        created_at:     new Date(),
        updated_at:     new Date(),
      },
      {
        id:             '33333333-0003-0003-0003-000000000004',
        code:           'TEST100',
        discount_type:  'percentage',   // 100% para pruebas de desarrollo
        discount_value: 100,
        expires_at:     new Date('2026-12-31'),
        max_uses:       null,           // Ilimitado
        uses_count:     0,
        is_active:      true,           // ⚠️  Desactivar en producción
        deleted_at:     null,
        created_at:     new Date(),
        updated_at:     new Date(),
      },
    ], {});
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('promo_codes', null, {});
  },
};
