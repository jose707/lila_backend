'use strict';

require('dotenv').config();

const localConfig = () => ({
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'linea_lila',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  dialect: process.env.DB_DIALECT || 'postgres',
});

module.exports = {
  development: localConfig(),
  test: localConfig(),
  production: {
    use_env_variable: 'DATABASE_URL',
    dialect: process.env.DB_DIALECT || 'postgres',
    dialectOptions: process.env.DB_SSL === 'false'
      ? {}
      : { ssl: { require: true, rejectUnauthorized: false } },
  },
};
