const { Conductor: Conductor, ConductorUbicacion: ConductorUbicacion } = require('../../models');
const sequelize = require("../../config/baseDatos");
const { registrarPunto } = require('../../services/rutaRecorrida');

const registrarUbicacionHandlers = (io, socket) => {
  socket.on('driver:location:update', async (datos) => {
    try {
      const { rideId: viajeId, latitude: latitud, longitude: longitud, heading: rumbo, speed: velocidad } = datos || {};
      if (!Number.isFinite(latitud) || !Number.isFinite(longitud) || Math.abs(latitud) > 90 || Math.abs(longitud) > 180) return;

      const conductor = await Conductor.findOne({ where: { userId: socket.user.id } });
      if (!conductor) return;

      const [ubicacion, creado] = await ConductorUbicacion.findCreateFind({
        where: { driver_id: conductor.id },
        defaults: {
          driver_id: conductor.id,
          location_recorded_at: new Date(),
          location: sequelize.fn('ST_GeomFromText', `POINT(${longitud} ${latitud})`, 4326),
          heading: rumbo ?? null,
          speed: velocidad ?? null,
          is_online: true
        }
      });

      if (!creado) {
        ubicacion.location_recorded_at = new Date();
        ubicacion.location = sequelize.fn('ST_GeomFromText', `POINT(${longitud} ${latitud})`, 4326);
        if (rumbo !== undefined) ubicacion.heading = rumbo;
        if (velocidad !== undefined) ubicacion.speed = velocidad;
        ubicacion.is_online = true;
        await ubicacion.save();
      }

      if (viajeId) {
        await registrarPunto(viajeId, conductor.id, latitud, longitud);
        io.to(`ride:${viajeId}`).emit('driver:location:changed', {
          rideId: viajeId,
          driverId: conductor.id,
          latitude: latitud,
          longitude: longitud,
          heading: rumbo ?? null,
          speed: velocidad ?? null,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('❌ [Socket:location] Error:', error.message);
    }
  });

  socket.on('driver:go_online', async (datos, acknowledge) => {
    try {
      const conductor = await Conductor.findOne({ where: { userId: socket.user.id } });
      if (!conductor) {
        acknowledge?.({ ok: false });
        return;
      }
      socket.driverId = conductor.id;

      // Usar coordenadas reales si el cliente las envía, de lo contrario mantener las existentes
      const { latitude: latitud, longitude: longitud } = datos || {};
      const tieneCoordenadas = Number.isFinite(latitud) && Number.isFinite(longitud) && Math.abs(latitud) <= 90 && Math.abs(longitud) <= 180;
      const puntoExpr = tieneCoordenadas ?
      sequelize.fn('ST_GeomFromText', `POINT(${longitud} ${latitud})`, 4326) :
      sequelize.fn('ST_GeomFromText', 'POINT(0 0)', 4326);

      // findCreateFind inserta sin la función temporal que usa el tipo de la tabla física.
      const [ubicacion, creado] = await ConductorUbicacion.findCreateFind({
        where: { driver_id: conductor.id },
        defaults: {
          driver_id: conductor.id,
          location: puntoExpr,
          location_recorded_at: tieneCoordenadas ? new Date() : null,
          is_online: true
        }
      });

      if (!creado) {
        if (tieneCoordenadas) {
          ubicacion.location_recorded_at = new Date();
          ubicacion.location = sequelize.fn('ST_GeomFromText', `POINT(${longitud} ${latitud})`, 4326);
        }
        ubicacion.is_online = true;
        await ubicacion.save();
      }

      socket.join('drivers:available');
      console.log(`🟢 [Socket] Conductor ${conductor.id} conectado${tieneCoordenadas ? ` en (${latitud}, ${longitud})` : ''}`);
      acknowledge?.({ ok: true });
    } catch (error) {
      console.error('❌ [Socket:ubicacion] No se pudo conectar al conductor:', error.message);
      acknowledge?.({ ok: false });
    }
  });

  socket.on('driver:go_offline', async (datos, acknowledge) => {
    const confirmar = typeof datos === 'function' ? datos : acknowledge;
    try {
      const conductor = await Conductor.findOne({ where: { userId: socket.user.id } });
      if (!conductor) {
        confirmar?.({ ok: false });
        return;
      }
      await ConductorUbicacion.update(
        { is_online: false },
        { where: { driver_id: conductor.id } }
      );
      socket.leave('drivers:available');
      console.log(`🔴 [Socket] Driver ${socket.user.id} offline`);
      confirmar?.({ ok: true });
    } catch (error) {
      console.error('❌ [Socket:location] go_offline error:', error.message);
      confirmar?.({ ok: false });
    }
  });
};

module.exports = { registrarUbicacionHandlers: registrarUbicacionHandlers };
