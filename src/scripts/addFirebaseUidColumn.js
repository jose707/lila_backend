// backend/src/scripts/addFirebaseUidColumn.js
const sequelize = require('../config/database');
const User = require('../models/User');

const migrateDatabase = async () => {
  try {
    console.log('Starting migration...');

    // Sync the database with the updated model
    // This will add new columns if they don't exist
    await sequelize.sync({ alter: true });

    console.log('✅ Migration completed successfully');
    console.log('✅ Added firebaseUid column to users table');
    console.log('✅ Updated role ENUM to include pasajero and conductor');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

migrateDatabase();
