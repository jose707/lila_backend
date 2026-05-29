// LineaLila Backend - PostgreSQL + Sequelize
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');

// Cargar variables de entorno PRIMERO (independiente del cwd)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const sequelize = require('./config/database');

// Importar modelos e inicializar asociaciones (todo en uno, desde index.js)
// models/index.js llama setupAssociations() internamente — no repetir aquí
require('./models');

// Inicializar Firebase Admin SDK (para push notifications)
require('./config/firebase').getFirebaseApp();

const { initializeSocket } = require('./socket');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de seguridad
app.use(helmet());

// Log simple de requests para depurar conexiones desde el móvil
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

// Servir archivos estáticos de uploads CON HEADERS ANTI-CACHE
app.use(
  '/uploads',
  (req, res, next) => {
    // Agregar headers para prevenir caching
    res.set(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    );
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
  },
  express.static(path.join(__dirname, './uploads')),
);

// Rutas
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/requests', require('./routes/requests')); // Nuevo: manejar requests versionadas
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
  // Errores de Multer (subida de archivos)
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      console.warn(`⚠️  Multer: campo inesperado "${err.field}"`);
      return res.status(400).json({
        error: `Campo de archivo no permitido: "${err.field}". Verifica que los nombres de los campos coincidan con los esperados.`,
      });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      console.warn(
        `⚠️  Multer: archivo demasiado grande en campo "${err.field}"`,
      );
      return res.status(400).json({
        error: 'El archivo excede el tamaño máximo permitido (10 MB).',
      });
    }
    console.warn('⚠️  Multer error:', err.code, err.message);
    return res.status(400).json({
      error: err.message || 'Error al procesar los archivos.',
    });
  }

  console.error('Error global:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor',
  });
});

// Sincronizar base de datos y iniciar servidor
const startServer = async () => {
  try {
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
      console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
      console.log(`Entorno: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Error al iniciar el servidor:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
