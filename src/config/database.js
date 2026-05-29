// LineaLila Backend - PostgreSQL + Sequelize
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');
const { execSync } = require('child_process');

// Cargar variables de entorno PRIMERO
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// 🔥 FUNCIÓN: Ejecutar migraciones y seeders automáticamente
const runSetup = async () => {
  // Solo en producción (Render)
  if (process.env.NODE_ENV !== 'production') {
    console.log('⚠️ Modo desarrollo: omitiendo migraciones automáticas');
    return;
  }

  console.log('\n🚀 INICIANDO SETUP DE PRODUCCIÓN...');
  
  try {
    // 1. Verificar conexión a la base de datos
    const sequelizeCheck = require('./config/database');
    await sequelizeCheck.authenticate();
    console.log('✅ Conexión a base de datos verificada');

    // 2. Ejecutar migrate.js si existe
    const fs = require('fs');
    const migratePath = path.resolve(__dirname, '../migrate.js');
    
    if (fs.existsSync(migratePath)) {
      console.log('🔄 Ejecutando migrate.js...');
      try {
        require(migratePath);
        console.log('✅ Migración ejecutada correctamente');
      } catch (migrateError) {
        console.log('⚠️ La migración ya se ejecutó o no era necesaria:', migrateError.message);
      }
    } else {
      console.log('⚠️ No se encontró migrate.js, usando sync() básico');
      const sequelize = require('./config/database');
      await sequelize.sync({ alter: false });
      console.log('✅ Tablas creadas/verificadas con sync()');
    }

    // 3. Ejecutar seeders (solo si no hay datos)
    console.log('🔄 Verificando seeders...');
    const { Sequelize } = require('sequelize');
    const sequelizeSeed = require('./config/database');
    
    // Verificar si ya existe el usuario admin
    const [results] = await sequelizeSeed.query(
      `SELECT COUNT(*) as count FROM users WHERE role = 'admin'`
    );
    
    if (results[0].count === 0) {
      console.log('📦 Ejecutando seeders (no hay datos iniciales)...');
      try {
        execSync('npx sequelize-cli db:seed:all', { 
          stdio: 'inherit',
          cwd: path.resolve(__dirname, '..')
        });
        console.log('✅ Seeders ejecutados correctamente');
      } catch (seedError) {
        console.log('⚠️ Error en seeders (pueden ya estar ejecutados):', seedError.message);
      }
    } else {
      console.log('✅ Los datos iniciales ya existen, omitiendo seeders');
    }

    console.log('🎉 SETUP COMPLETADO EXITOSAMENTE\n');
  } catch (error) {
    console.error('❌ Error durante el setup:', error.message);
    console.log('⚠️ Continuando con el inicio normal del servidor...');
  }
};

// 🔥 VERIFICACIÓN CRÍTICA
if (process.env.NODE_ENV === 'production') {
  if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR CRÍTICO: DATABASE_URL no está definida en producción');
    console.error('   Render debe inyectar esta variable automáticamente.');
    console.error('   Verifica que esté configurada en Environment Variables.');
    process.exit(1);
  }
  console.log('✅ DATABASE_URL encontrada (modo producción)');
}

console.log(`🔌 Modo base de datos: ${process.env.DATABASE_URL ? '✅ Usando DATABASE_URL' : '⚠️ Usando variables separadas (modo desarrollo)'}`);

const sequelize = require('./config/database');

// Importar modelos e inicializar asociaciones
require('./models');

// Inicializar Firebase Admin SDK
require('./config/firebase').getFirebaseApp();

const { initializeSocket } = require('./socket');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de seguridad
app.use(helmet());

// Log simple de requests
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - startedAt;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// CORS
app.use(
  cors({
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      process.env.FRONTEND_MOBILE || 'http://localhost:8081',
    ],
    credentials: true,
  }),
);

// Parsear JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Servir archivos estáticos
app.use(
  '/uploads',
  (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
  },
  express.static(path.join(__dirname, './uploads')),
);

// Rutas
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/drivers', require('./routes/drivers'));
app.use('/api/rides', require('./routes/rides'));
app.use('/api/ratings', require('./routes/ratings'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/ride-offers', require('./routes/rideOffers'));
app.use('/api/driver-locations', require('./routes/driverLocations'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/notifications', require('./routes/notifications'));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: process.env.DATABASE_URL ? 'configured' : 'not configured',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    path: req.path,
  });
});

// Manejo de errores global
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      console.warn(`⚠️ Multer: campo inesperado "${err.field}"`);
      return res.status(400).json({
        error: `Campo de archivo no permitido: "${err.field}"`,
      });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'El archivo excede el tamaño máximo permitido (10 MB).',
      });
    }
    return res.status(400).json({ error: err.message });
  }

  console.error('Error global:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor',
  });
});

// Sincronizar base de datos e iniciar servidor
const startServer = async () => {
  try {
    // 🔥 EJECUTAR SETUP ANTES DE SINCRONIZAR
    await runSetup();
    
    console.log('🔄 Sincronizando base de datos...');
    const syncOptions = {
      alter: false,
      logging: false,
    };
    await sequelize.sync(syncOptions);
    console.log('✅ Base de datos sincronizada correctamente\n');

    const httpServer = http.createServer(app);
    initializeSocket(httpServer);
    httpServer.listen(PORT, () => {
      console.log(`\n🚀 Servidor ejecutándose en puerto ${PORT}`);
      console.log(`📍 Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🗄️  Base de datos: ${process.env.DATABASE_URL ? 'PostgreSQL (Render)' : 'PostgreSQL (Local)'}`);
      console.log(`✅ Health check: https://lila-backend-xpjy.onrender.com/health\n`);
    });
  } catch (error) {
    console.error('❌ Error al iniciar el servidor:', error);
    console.error('\n🔍 Posibles causas:');
    console.error('   1. DATABASE_URL no está configurada');
    console.error('   2. La base de datos no está accesible');
    console.error('   3. Las credenciales son incorrectas');
    process.exit(1);
  }
};

startServer();

module.exports = app;
