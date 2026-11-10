const { Server: Servidor } = require('socket.io');
const { socketAutenticacionIntermediario: socketAutenticacionIntermediario } = require("./middleware/autenticacion");
const { registrarViajeHandlers: registrarViajeHandlers } = require("./handlers/viajeHandlers");
const { registrarUbicacionHandlers: registrarUbicacionHandlers } = require("./handlers/ubicacionHandlers");

let io;

const inicializarSocket = (httpServidor) => {
  io = new Servidor(httpServidor, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
  });

  io.use(socketAutenticacionIntermediario);

  io.on('connection', (socket) => {
    const usuarioId = socket.user?.id;
    console.log(`🔌 [Socket] Connected: user=${usuarioId} socket=${socket.id}`);

    // Personal room for push events
    socket.join(`user:${usuarioId}`);

    registrarViajeHandlers(io, socket);
    registrarUbicacionHandlers(io, socket);

    socket.on('disconnect', async (motivo) => {
      console.log(`🔌 [Socket] Disconnected: user=${usuarioId} reason=${motivo}`);
      try {
        // A second device/session may still be connected for this user.
        const restante = await io.in(`user:${usuarioId}`).fetchSockets();
        if (restante.length === 0) {
          const { Conductor: Conductor, ConductorUbicacion: ConductorUbicacion } = require('../models');
          const conductor = await Conductor.findOne({ where: { userId: usuarioId } });
          if (conductor) await ConductorUbicacion.update({ is_online: false }, { where: { driver_id: conductor.id } });
        }
      } catch (error) {
        console.warn('Driver disconnect availability:', error.message);
      }
    });

    socket.on('error', (error) => {
      console.error(`❌ [Socket] Error user=${usuarioId}:`, error.message);
    });
  });

  console.log('🔌 [Socket.io] Initialized');
  return io;
};

const obtenerIo = () => {
  if (!io) {
    // During startup race, return a no-op proxy instead of throwing
    console.warn('⚠️ [Socket] getIO() called before initialization');
    return {
      to: () => ({ emit: () => {} }),
      emit: () => {}
    };
  }
  return io;
};

module.exports = { inicializarSocket: inicializarSocket, obtenerIo: obtenerIo };
