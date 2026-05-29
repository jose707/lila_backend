// socket/handlers/rideHandlers.js
// Nota: la notificación de ride:new_request a conductores se hace directamente
// en rideController.createRide (no-bloqueante con Promise.all).

const registerRideHandlers = (io, socket) => {
  // El pasajero se une al room de su viaje para recibir actualizaciones en tiempo real
  socket.on('join_ride', ({ rideId }) => {
    if (!rideId) return;
    socket.join(`ride:${rideId}`);
    console.log(`👥 [Socket] User ${socket.user.id} joined ride:${rideId}`);
  });

  socket.on('leave_ride', ({ rideId }) => {
    if (!rideId) return;
    socket.leave(`ride:${rideId}`);
  });
};

module.exports = { registerRideHandlers };
