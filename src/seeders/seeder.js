// backend/src/seeders/seeder.js
const sequelize = require('../config/database');
const User = require('../models/User');
const Driver = require('../models/Driver');
const DriverRequest = require('../models/DriverRequest');
const RequestFile = require('../models/RequestFile');
const Ride = require('../models/Ride');
const setupAssociations = require('../models/associations');
const bcrypt = require('bcryptjs');

const seedDatabase = async () => {
  try {
    // Configurar asociaciones
    setupAssociations();

    // Sincronizar base de datos - COMENTADO si ya existen las tablas
    // await sequelize.sync({ force: false });
    // console.log('✅ Base de datos sincronizada');

    // Crear usuario admin
    const hashedPassword = await bcrypt.hash('admin123', 10);

    const adminUser = await User.create({
      name: 'Administrador LineaLila',
      email: 'admin@linealila.com',
      phone: '+573001234567',
      password: hashedPassword,
      role: 'admin',
      // Campos requeridos por el esquema normalizado
      firebaseUid: 'admin-seed-firebase-uid',
      isActive: true,
      isVerified: true,
      currentMode: 'passenger',
      profilePhoto: null,
    });

    console.log('\n✅ Admin creado exitosamente:');
    console.log('   ID:', adminUser.id);
    console.log('   Nombre:', adminUser.name);
    console.log('   Email:', adminUser.email);
    console.log('   Teléfono:', adminUser.phone);
    console.log('   Rol:', adminUser.role);

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

seedDatabase();
