'use strict';

/**
 * Seeder: Zonas de servicio (service_areas)
 *
 * Define los polígonos geográficos de las ciudades donde opera la app.
 * Las coordenadas son ejemplos representativos de Bolivia.
 * 
 * ⚠️  Ajusta las coordenadas de los polígonos a la ciudad real
 *     usando geojson.io para dibujar las zonas exactas.
 *
 * Corre con: npx sequelize-cli db:seed --seed 02-service-areas.js
 */
module.exports = {
  async up(queryInterface) {
    // Insertar con ST_GeomFromText porque Sequelize no puede insertar
    // geometrías PostGIS directamente en bulkInsert
    await queryInterface.sequelize.query(`
      INSERT INTO service_areas
        (id, name, boundary, is_active, base_fare, fare_per_km, fare_per_minute, currency, created_at, updated_at)
      VALUES
      (
        '22222222-0002-0002-0002-000000000001',
        'La Paz - Centro',
        ST_GeomFromText('POLYGON((
          -68.1800 -16.4800,
          -68.0900 -16.4800,
          -68.0900 -16.5400,
          -68.1800 -16.5400,
          -68.1800 -16.4800
        ))', 4326),
        true, 7.0, 2.5, 0.5, 'BOB', NOW(), NOW()
      ),
      (
        '22222222-0002-0002-0002-000000000002',
        'El Alto',
        ST_GeomFromText('POLYGON((
          -68.2300 -16.4700,
          -68.1300 -16.4700,
          -68.1300 -16.5400,
          -68.2300 -16.5400,
          -68.2300 -16.4700
        ))', 4326),
        true, 6.0, 2.2, 0.4, 'BOB', NOW(), NOW()
      ),
      (
        '22222222-0002-0002-0002-000000000003',
        'Cochabamba - Centro',
        ST_GeomFromText('POLYGON((
          -66.1800 -17.3500,
          -66.1200 -17.3500,
          -66.1200 -17.4200,
          -66.1800 -17.4200,
          -66.1800 -17.3500
        ))', 4326),
        true, 6.5, 2.3, 0.45, 'BOB', NOW(), NOW()
      ),
      (
        '22222222-0002-0002-0002-000000000004',
        'Santa Cruz - Centro',
        ST_GeomFromText('POLYGON((
          -63.2100 -17.7200,
          -63.1400 -17.7200,
          -63.1400 -17.8000,
          -63.2100 -17.8000,
          -63.2100 -17.7200
        ))', 4326),
        true, 7.0, 2.5, 0.5, 'BOB', NOW(), NOW()
      ),
      (
        '22222222-0002-0002-0002-000000000005',
        'Oruro - Centro',
        ST_GeomFromText('POLYGON((
          -67.1300 -17.9500,
          -67.0700 -17.9500,
          -67.0700 -18.0100,
          -67.1300 -18.0100,
          -67.1300 -17.9500
        ))', 4326),
        true, 6.0, 2.2, 0.4, 'BOB', NOW(), NOW()
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('service_areas', null, {});
  },
};
