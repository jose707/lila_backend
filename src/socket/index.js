const { Server } = require('socket.io');
const { socketAuthMiddleware } = require('./middleware/auth');
const { registerRideHandlers } = require('./handlers/rideHandlers');
const { registerLocationHandlers } = require('./handlers/locationHandlers');

let io;

const initializeSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    const userId = socket.user?.id;
    console.log(`🔌 [Socket] Connected: user=${userId} socket=${socket.id}`);

    // Personal room for push events
    socket.join(`user:${userId}`);

    registerRideHandlers(io, socket);
    registerLocationHandlers(io, socket);

    socket.on('disconnect', (reason) => {
      console.log(`🔌 [Socket] Disconnected: user=${userId} reason=${reason}`);
    });

    socket.on('error', (err) => {
      console.error(`❌ [Socket] Error user=${userId}:`, err.message);
    });
  });

  console.log('🔌 [Socket.io] Initialized');
  return io;
};

const getIO = () => {
  if (!io) {
    // During startup race, return a no-op proxy instead of throwing
    console.warn('⚠️ [Socket] getIO() called before initialization');
    return {
      to: () => ({ emit: () => {} }),
      emit: () => {},
    };
  }
  return io;
};

module.exports = { initializeSocket, getIO };
