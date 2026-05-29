'use strict';

/**
 * Seeder: Razones de cancelación (catálogo inicial)
 * Tabla: cancellation_reasons
 *
 * Corre con: npx sequelize-cli db:seed --seed 01-cancellation-reasons.js
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('cancellation_reasons', [
      // ── Para pasajeros ───────────────────────────────────────────────
      {
        id:            '11111111-0001-0001-0001-000000000001',
        code:          'passenger_changed_mind',
        description:   'Cambié de opinión',
        applicable_to: 'passenger',
        is_active:     true,
        created_at:    new Date(),
      },
      {
        id:            '11111111-0001-0001-0001-000000000002',
        code:          'passenger_wait_too_long',
        description:   'El conductor tardó demasiado en llegar',
        applicable_to: 'passenger',
        is_active:     true,
        created_at:    new Date(),
      },
      {
        id:            '11111111-0001-0001-0001-000000000003',
        code:          'passenger_wrong_pickup',
        description:   'Me equivoqué en el punto de recogida',
        applicable_to: 'passenger',
        is_active:     true,
        created_at:    new Date(),
      },
      {
        id:            '11111111-0001-0001-0001-000000000004',
        code:          'passenger_found_other_transport',
        description:   'Encontré otro medio de transporte',
        applicable_to: 'passenger',
        is_active:     true,
        created_at:    new Date(),
      },
      {
        id:            '11111111-0001-0001-0001-000000000005',
        code:          'passenger_emergency',
        description:   'Tuve una emergencia',
        applicable_to: 'passenger',
        is_active:     true,
        created_at:    new Date(),
      },

      // ── Para conductores ─────────────────────────────────────────────
      {
        id:            '11111111-0001-0001-0001-000000000010',
        code:          'driver_passenger_no_show',
        description:   'El pasajero no se presentó',
        applicable_to: 'driver',
        is_active:     true,
        created_at:    new Date(),
      },
      {
        id:            '11111111-0001-0001-0001-000000000011',
        code:          'driver_passenger_unreachable',
        description:   'No pude comunicarme con el pasajero',
        applicable_to: 'driver',
        is_active:     true,
        created_at:    new Date(),
      },
      {
        id:            '11111111-0001-0001-0001-000000000012',
        code:          'driver_vehicle_issue',
        description:   'Tuve un problema con mi vehículo',
        applicable_to: 'driver',
        is_active:     true,
        created_at:    new Date(),
      },
      {
        id:            '11111111-0001-0001-0001-000000000013',
        code:          'driver_wrong_destination',
        description:   'El destino está fuera de mi zona',
        applicable_to: 'driver',
        is_active:     true,
        created_at:    new Date(),
      },
      {
        id:            '11111111-0001-0001-0001-000000000014',
        code:          'driver_emergency',
        description:   'Tuve una emergencia personal',
        applicable_to: 'driver',
        is_active:     true,
        created_at:    new Date(),
      },

      // ── Compartidas ──────────────────────────────────────────────────
      {
        id:            '11111111-0001-0001-0001-000000000020',
        code:          'mutual_agreement',
        description:   'Cancelación de mutuo acuerdo',
        applicable_to: 'both',
        is_active:     true,
        created_at:    new Date(),
      },
      {
        id:            '11111111-0001-0001-0001-000000000021',
        code:          'other',
        description:   'Otro motivo',
        applicable_to: 'both',
        is_active:     true,
        created_at:    new Date(),
      },
    ], {});
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('cancellation_reasons', null, {});
  },
};
