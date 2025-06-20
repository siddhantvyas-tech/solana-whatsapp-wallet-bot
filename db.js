// db.js
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'walletsdb',
  password: 'postgres',
  port: 5432,
});

// Create table if not exists
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
