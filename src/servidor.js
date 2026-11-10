// LineaLila Backend - PostgreSQL + Sequelize
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const ruta = require('path');

// Cargar variables de entorno PRIMERO (independiente del cwd)
dotenv.config({ path: ruta.resolve(__dirname, '../.env') });

if (process.env.NODE_ENV === 'production') {
  require("./services/identidadSessionCrypto").almacenamientoClave();
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('Configure a strong JWT_SECRET before starting production');
}

const sequelize = require("./config/baseDatos");

// Importar modelos e inicializar asociaciones (todo en uno, desde index.js)
// models/index.js llama setupAssociations() internamente — no repetir aquí
require('./models');

// Inicializar Firebase Admin SDK (para push notifications)
require('./config/firebase').obtenerAplicacionFirebase();

const { inicializarSocket: inicializarSocket } = require('./socket');

const aplicacion = express();
const PORT = process.env.PORT || 3000;

// Middleware de seguridad
aplicacion.use(helmet());

// Log simple de requests para depurar conexiones desde el móvil
aplicacion.use((solicitud, respuesta, siguiente) => {
  const iniciadoEn = Date.now();
  respuesta.on('finish', () => {
    const milisegundos = Date.now() - iniciadoEn;
    console.log(`${solicitud.method} ${solicitud.originalUrl} ${respuesta.statusCode} ${milisegundos}ms`);
  });
  siguiente();
});

// CORS
aplicacion.use(
  cors({
    origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    process.env.FRONTEND_MOBILE || 'http://localhost:8081'],

    credentials: true
  })
);

// Parsear JSON
aplicacion.use(express.json({ limit: '10mb' }));
aplicacion.use(express.urlencoded({ limit: '10mb', extended: true }));

// Servir archivos estáticos de uploads CON HEADERS ANTI-CACHE
aplicacion.use(
  ['/archivos', '/uploads'],
  require("./middleware/autenticacion").autenticacionIntermediario,
  require("./middleware/documentoAccess"),
  (solicitud, respuesta, siguiente) => {
    // Agregar headers para prevenir caching
    respuesta.set(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
    );
    respuesta.set('Pragma', 'no-cache');
    respuesta.set('Expires', '0');
    solicitud.url = solicitud.url.replace(/^\/conductores(?=\/)/, '/drivers');
    siguiente();
  },
  express.static(ruta.join(__dirname, './uploads'))
);

// Rutas
aplicacion.use('/api/autenticacion', require("./routes/autenticacion"));
aplicacion.use('/api/usuarios', require('./routes/usuarios'));
aplicacion.use('/api/solicitudes', require('./routes/solicitudes'));
aplicacion.use('/api/conductores', require('./routes/conductores'));
aplicacion.use('/api/viajes', require("./routes/viajes"));
aplicacion.use('/api/lugares', require('./routes/lugares'));
aplicacion.use('/api/calificaciones', require('./routes/calificaciones'));
aplicacion.use('/api/vehiculos', require('./routes/vehiculos'));
aplicacion.use('/api/ofertas-viaje', require("./routes/ofertasViaje"));
aplicacion.use('/api/ubicaciones-conductores', require("./routes/ubicacionesConductores"));
aplicacion.use('/api/pagos', require('./routes/pagos'));
aplicacion.use('/api/administracion', require('./routes/administracion'));
aplicacion.use('/api/notificaciones', require('./routes/notificaciones'));

// Health check
aplicacion.get('/salud', (solicitud, respuesta) => {
  respuesta.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// Manejo de rutas no encontradas
aplicacion.use((solicitud, respuesta) => {
  respuesta.status(404).json({
    error: 'Ruta no encontrada',
    path: solicitud.path
  });
});

// Manejo de errores global
aplicacion.use((error, solicitud, respuesta, siguiente) => {
  // Errores de Multer (subida de archivos)
  if (error && error.name === 'MulterError') {
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      console.warn(`⚠️  Multer: campo inesperado "${error.field}"`);
      return respuesta.status(400).json({
        error: `Campo de archivo no permitido: "${error.field}". Verifica que los nombres de los campos coincidan con los esperados.`
      });
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      console.warn(
        `⚠️  Multer: archivo demasiado grande en campo "${error.field}"`
      );
      return respuesta.status(400).json({
        error: 'El archivo excede el tamaño máximo permitido (10 MB).'
      });
    }
    console.warn('⚠️  Multer error:', error.code, error.message);
    return respuesta.status(400).json({
      error: error.message || 'Error al procesar los archivos.'
    });
  }

  console.error('Error global:', error);
  respuesta.status(error.status || 500).json({
    error: error.message || 'Error interno del servidor'
  });
});

// El esquema se instala con npm run migrate antes de iniciar el servidor.
const inicioServidor = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Conexión a la base de datos establecida\n');

    // Marcar como expirados los rides vencidos que quedaron huérfanos
    await sequelize.query(`
      UPDATE viaje
      SET status = 'vencido'
      WHERE status IN ('solicitado', 'ofertado') AND expires_at < NOW()
    `);

    require("./controllers/solicitudControlador").reanudarPendienteConductorOcr().
    catch((error) => console.error('No se pudo reanudar el OCR pendiente:', error));

    const httpServidor = http.createServer(aplicacion);
    inicializarSocket(httpServidor);
    const { vencerReservas: vencerReservas } = require("./services/rapidaAsignacionServicio");
    const reservaTemporizador = setInterval(() => {
      vencerReservas().catch((error) => console.error('Reservation expiry:', error.message));
    }, 1000);
    reservaTemporizador.unref();
    httpServidor.listen(PORT, () => {
      require('./jobs/liquidacionJobs').iniciarCronJobs();
      console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
      console.log(`Entorno: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Error al iniciar el servidor:', error);
    process.exit(1);
  }
};

inicioServidor();

module.exports = aplicacion;
