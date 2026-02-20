/**
 * db.js — Shared mysql2/promise connection pool
 * Import this wherever you need database access.
 */

'use strict';

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host    : process.env.DB_HOST     || '127.0.0.1',
  port    : Number(process.env.DB_PORT || 3306),
  user    : process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || 'anselemngo97$',        // ← your password here
  database: process.env.DB_NAME     || 'smart_library',
  waitForConnections: true,
  connectionLimit   : 10,
  queueLimit        : 0,
});

module.exports = pool;