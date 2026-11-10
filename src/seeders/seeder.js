// backend/src/seeders/seeder.js
const sequelize = require("../config/baseDatos");
const Usuario = require("../models/Usuario");
const Conductor = require("../models/Conductor");
const ConductorSolicitud = require("../models/ConductorSolicitud");
const SolicitudArchivo = require("../models/SolicitudArchivo");
const Viaje = require("../models/Viaje");
const configurarAsociaciones = require('../models/associations');
const bcrypt = require('bcryptjs');

const semillaBaseDatos = async () => {
  try {
    // Configurar asociaciones
    configurarAsociaciones();

    // Sincronizar base de datos - COMENTADO si ya existen las tablas
    // await sequelize.sync({ force: false });
    // console.log('✅ Base de datos sincronizada');

    // Crear usuario admin
    const hashedContrasena = await bcrypt.hash('admin123', 10);

    const administradorUsuario = await Usuario.create({
      name: 'Administrador LineaLila',
      email: 'admin@linealila.com',
      phone: '+573001234567',
      password: hashedContrasena,
      role: 'administrador',
      // Campos requeridos por el esquema normalizado
      firebaseUid: 'admin-seed-firebase-uid',
      isActive: true,
      phoneVerified: true,
      modoActual: 'pasajero',
      profilePhoto: null
    });

    console.log('\n✅ Admin creado exitosamente:');
    console.log('   ID:', administradorUsuario.id);
    console.log('   Nombre:', administradorUsuario.name);
    console.log('   Email:', administradorUsuario.email);
    console.log('   Teléfono:', administradorUsuario.phone);
    console.log('   Rol:', administradorUsuario.role);

    console.log('\n✅ Base de datos configurada correctamente');
    console.log('\n📋 Credenciales de administrador:');
    console.log('   Email: admin@linealila.com');
    console.log('   Contraseña: admin123');
    console.log('   Teléfono: +573001234567');
    console.log('\n📊 Estado:');
    console.log('   - Todas las tablas creadas');
    console.log('   - Usuario admin creado');
    console.log('   - Listo para usar');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error al configurar la base de datos:', error);
    process.exit(1);
  }
};

semillaBaseDatos();
