'use strict';

const bcrypt = require('bcryptjs');

module.exports = {
  async up(queryInterface) {
    const hashedPassword = await bcrypt.hash('admin123', 10);

    await queryInterface.bulkInsert('users', [
      {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'admin@linealila.com',
        phone: '+59170000001',
        password: hashedPassword,
        role: 'admin',
        is_active: true,
        phone_verified: true,
        current_mode: 'admin',
        firebase_uid: 'admin_firebase_001',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ], {});
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('users', { role: 'admin' }, {});
  },
};
