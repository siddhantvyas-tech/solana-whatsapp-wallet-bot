const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

const createTable = `
  CREATE TABLE IF NOT EXISTS users (
    phone VARCHAR(15) PRIMARY KEY,
    public_key TEXT NOT NULL,
    secret_key TEXT NOT NULL
  );
`;

pool.query(createTable)
  .then(() => console.log('✅ Users table ready'))
  .catch(err => console.error('❌ Error creating table:', err));

module.exports = pool;
