// backend/src/config/database.js
const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');

// Cargar variables de entorno
dotenv.config();

let sequelize;

// Si existe DATABASE_URL (producción en Render), úsala
if (process.env.DATABASE_URL) {
  console.log('📡 Conectando a PostgreSQL usando DATABASE_URL (modo producción)');
  
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    define: {
      underscored: true,           // Convierte camelCase a snake_case
      timestamps: true,            // Agrega created_at y updated_at
      paranoid: true,              // Agrega deleted_at para soft deletes
    },
    logging: false,                // Desactiva logs SQL en consola
    dialectOptions: {
      ssl: {
        require: true,             // Requiere SSL para Render
        rejectUnauthorized: false  // Necesario para certificados autofirmados
      }
    },
    pool: {
      max: 15,                     // Máximo de conexiones en el pool
      min: 2,                      // Mínimo de conexiones en el pool
      acquire: 10000,              // Tiempo máximo para adquirir conexión (ms)
      idle: 10000                  // Tiempo máximo que una conexión puede estar inactiva
    },
    retry: {
      max: 3,                      // Número máximo de reintentos
      match: [
        /SequelizeConnectionError/,
        /SequelizeConnectionRefusedError/,
        /TimeoutError/
      ]
    }
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
        timestamps: true,
        paranoid: true,
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

// Función para probar la conexión
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Conexión a la base de datos establecida correctamente');
    return true;
  } catch (error) {
    console.error('❌ Error de conexión a la base de datos:', error.message);
    return false;
  }
};

// Exportar la conexión y la función de prueba
module.exports = sequelize;
module.exports.testConnection = testConnection;
