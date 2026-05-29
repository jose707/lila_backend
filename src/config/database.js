// backend/src/config/database.js
const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');

dotenv.config();

const sequelize = new Sequelize(
  process.env.DB_NAME || 'linea_lila',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'password',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    define: {
      underscored: true,
    },
    // SQL logging desactivado: en development generaba demasiado output por
    // consola (cada poll del driver imprimía ~10 queries/s), añadiendo I/O
    // overhead al event loop y enmascarando errores reales.
    logging: false,
    pool: {
      // max aumentado de 5 → 15: con el driver polling cada 2-3s
      // (rides/requests + rides/:id + ride-offers/:id) las 5 conexiones
      // se agotaban fácilmente, dejando createRide esperando hasta 30s.
      max: 15,
      min: 2,
      // acquire reducido de 30s → 10s: si no hay conexión disponible en
      // 10s, es mejor fallar rápido con un 500 claro que hacer esperar
      // al cliente hasta que su timeout de red dispare primero.
      acquire: 10000,
      idle: 10000,
    },
  },
);

module.exports = sequelize;
