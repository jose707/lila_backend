// backend/src/config/database.js
const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');

dotenv.config();

let sequelize;

// Si existe DATABASE_URL (producción en Render), úsala
if (process.env.DATABASE_URL) {
  console.log('📡 Conectando a PostgreSQL usando DATABASE_URL (modo producción)');
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
  console.log('💻 Conectando a PostgreSQL usando variables separadas (modo desarrollo local)');
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

// ✅ ELIMINA CUALQUIER OTRO `require` O CÓDIGO ADICIONAL DESDE LA LÍNEA 93 EN ADELANTE
// Especialmente elimina cualquier línea que intente hacer `require('./config/database')` de nuevo

module.exports = sequelize;
