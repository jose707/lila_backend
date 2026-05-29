// backend/src/config/database.js
const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');

dotenv.config();

let sequelize;

// Si existe DATABASE_URL (producción en Render), úsala
if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    define: {
      underscored: true,
    },
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false  // Necesario para Render
      }
    },
    pool: {
      max: 15,
      min: 2,
      acquire: 10000,
      idle: 10000,
    },
  });
} else {
  // Entorno local (desarrollo)
  sequelize = new Sequelize(
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
      logging: false,
      pool: {
        max: 15,
        min: 2,
        acquire: 10000,
        idle: 10000,
      },
    }
  );
}

module.exports = sequelize;
