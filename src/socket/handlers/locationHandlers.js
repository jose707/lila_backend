const { Driver, DriverLocation } = require('../../models');
const sequelize = require('../../config/database');

const registerLocationHandlers = (io, socket) => {
  socket.on('driver:location:update', async (data) => {
    try {
      const { rideId, latitude, longitude, heading, speed } = data || {};
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;

      const driver = await Driver.findOne({ where: { userId: socket.user.id } });
      if (!driver) return;

      const [location, created] = await DriverLocation.findOrCreate({
        where: { driver_id: driver.id },
        defaults: {
          driver_id: driver.id,
          location_recorded_at: new Date(),
          location: sequelize.fn('ST_GeomFromText', `POINT(${longitude} ${latitude})`, 4326),
          heading: heading ?? null,
          speed: speed ?? null,
          is_online: true,
        },
      });

      if (!created) {
        location.location_recorded_at = new Date();
        location.location = sequelize.fn('ST_GeomFromText', `POINT(${longitude} ${latitude})`, 4326);
        if (heading !== undefined) location.heading = heading;
        if (speed !== undefined) location.speed = speed;
        location.is_online = true;
        await location.save();
      }

      if (rideId) {
        io.to(`ride:${rideId}`).emit('driver:location:changed', {
          rideId,
          driverId: driver.id,
          latitude,
          longitude,
          heading: heading ?? null,
          speed: speed ?? null,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('❌ [Socket:location] Error:', error.message);
    }
  });

  socket.on('driver:go_online', async (data, acknowledge) => {
    try {
      const driver = await Driver.findOne({ where: { userId: socket.user.id } });
      if (!driver) {
        acknowledge?.({ ok: false });
        return;
      }
      socket.driverId = driver.id;

      // Usar coordenadas reales si el cliente las envía, de lo contrario mantener las existentes
      const { latitude, longitude } = data || {};
      const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
      const pointExpr = hasCoords
        ? sequelize.fn('ST_GeomFromText', `POINT(${longitude} ${latitude})`, 4326)
        : sequelize.fn('ST_GeomFromText', 'POINT(0 0)', 4326);

      const [location, created] = await DriverLocation.findOrCreate({
        where: { driver_id: driver.id },
        defaults: {
          driver_id: driver.id,
          location: pointExpr,
          location_recorded_at: hasCoords ? new Date() : null,
          is_online: true,
        },
      });

      if (!created) {
        if (hasCoords) {
          location.location_recorded_at = new Date();
          location.location = sequelize.fn('ST_GeomFromText', `POINT(${longitude} ${latitude})`, 4326);
        }
        location.is_online = true;
        await location.save();
      }

      socket.join('drivers:available');
      console.log(`🟢 [Socket] Driver ${driver.id} online${hasCoords ? ` @ (${latitude}, ${longitude})` : ''}`);
      acknowledge?.({ ok: true });
    } catch (error) {
      console.error('❌ [Socket:location] go_online error:', error.message);
      acknowledge?.({ ok: false });
    }
  });

  socket.on('driver:go_offline', async (data, acknowledge) => {
    const confirm = typeof data === 'function' ? data : acknowledge;
    try {
      const driver = await Driver.findOne({ where: { userId: socket.user.id } });
      if (!driver) {
        confirm?.({ ok: false });
        return;
      }
      await DriverLocation.update(
        { is_online: false },
        { where: { driver_id: driver.id } },
      );
      socket.leave('drivers:available');
      console.log(`🔴 [Socket] Driver ${socket.user.id} offline`);
      confirm?.({ ok: true });
    } catch (error) {
      console.error('❌ [Socket:location] go_offline error:', error.message);
      confirm?.({ ok: false });
    }
  });
};

module.exports = { registerLocationHandlers };
