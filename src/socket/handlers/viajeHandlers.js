// socket/handlers/rideHandlers.js
// Nota: la notificación de ride:new_request a conductores se hace directamente
// en rideController.createRide (no-bloqueante con Promise.all).

const registrarViajeHandlers = (io, socket) => {
  // El pasajero se une al room de su viaje para recibir actualizaciones en tiempo real
  socket.on('join_ride', ({ rideId: viajeId }) => {
    if (!viajeId) return;
    socket.join(`ride:${viajeId}`);
    console.log(`👥 [Socket] El usuario ${socket.user.id} se unió al canal del viaje ${viajeId}`);
  });

  socket.on('leave_ride', ({ rideId: viajeId }) => {
    if (!viajeId) return;
    socket.leave(`ride:${viajeId}`);
  });
};

module.exports = { registrarViajeHandlers: registrarViajeHandlers };
