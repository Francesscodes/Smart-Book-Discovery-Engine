/**
 * seed.js — Smart Book Discovery Engine
 * Reads library_dataset.json and populates MySQL via mysql2/promise.
 *
 * Usage:
 *   node seed.js
 *
 * Environment variables (or edit the config object below):
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 */

'use strict';

const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const DB = {
  host    : '127.0.0.1',
  port    : 3306,
  user    : 'root',
  password: 'anselemngo97$',  // ← put your real password
  database: 'smart_library',
};
// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Chunk an array into batches of `size`.
 * @param {any[]} arr
 * @param {number} size
 * @returns {any[][]}
 */
function chunk(arr, size) {
  const batches = [];
  for (let i = 0; i < arr.length; i += size) {
    batches.push(arr.slice(i, i + size));
  }
  return batches;
}

/**
 * Bulk-insert rows into `table` using a single multi-row INSERT … ON DUPLICATE KEY UPDATE.
 *
 * @param {mysql.Pool}  pool
 * @param {string}      table     - target table name
 * @param {string[]}    columns   - column names in insertion order
 * @param {any[][]}     rows      - array of value arrays matching `columns`
 * @param {string}      label     - display label for logging
 */
async function bulkInsert(pool, table, columns, rows, label) {
  if (!rows.length) {
    console.log(`  ⚠  No ${label} to insert.`);
    return;
  }

  const batchSize = 100;
  const batches   = chunk(rows, batchSize);

  // Build the ON DUPLICATE KEY UPDATE clause so re-running the seeder is safe
  const updateClause = columns
    .map(c => `\`${c}\` = VALUES(\`${c}\`)`)
    .join(', ');

  const placeholders = `(${columns.map(() => '?').join(', ')})`;

  let inserted = 0;

  for (const batch of batches) {
    const flatValues = batch.flat();
    const rowPlaceholders = batch.map(() => placeholders).join(',\n  ');
    const sql = `
      INSERT INTO \`${table}\` (\`${columns.join('`, `')}\`)
      VALUES
        ${rowPlaceholders}
      ON DUPLICATE KEY UPDATE
        ${updateClause};
    `;

    await pool.execute(sql, flatValues);
    inserted += batch.length;
  }

  console.log(`  ✅  ${label}: ${inserted} row(s) upserted into \`${table}\`.`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function seed() {
  // 1. Load dataset
  const dataPath = path.join(__dirname, 'library_dataset.json');
  if (!fs.existsSync(dataPath)) {
    console.error(`❌  Cannot find library_dataset.json at: ${dataPath}`);
    process.exit(1);
  }

  const { books, users, loans } = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  console.log(`📚  Loaded dataset: ${books.length} books, ${users.length} users, ${loans.length} loans.`);

  // 2. Connect
  console.log(`\n🔌  Connecting to MySQL at ${DB.host}:${DB.port} / ${DB.database} …`);
  const pool = mysql.createPool(DB);

  // Quick connectivity check
  const conn = await pool.getConnection();
  console.log('    Connection OK.\n');
  conn.release();

  // 3. Seed tables in FK-safe order: users → books → loans
  console.log('🌱  Seeding …');

  await bulkInsert(
    pool,
    'users',
    ['user_id', 'name'],
    users.map(u => [u.user_id, u.name]),
    'Users'
  );

  await bulkInsert(
    pool,
    'books',
    ['book_id', 'title', 'author', 'dewey_decimal'],
    books.map(b => [b.book_id, b.title, b.author, b.dewey_decimal]),
    'Books'
  );

  await bulkInsert(
    pool,
    'loans',
    ['loan_id', 'user_id', 'book_id', 'borrowed_at'],
    loans.map(l => [l.loan_id, l.user_id, l.book_id, l.borrowed_at]),
    'Loans'
  );

  // 4. Verify
  console.log('\n🔎  Verification counts:');
  for (const table of ['users', 'books', 'loans']) {
    const [[{ cnt }]] = await pool.execute(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
    console.log(`    ${table}: ${cnt} row(s)`);
  }

  await pool.end();
  console.log('\n🎉  Seeding complete!\n');
}

seed().catch(err => {
  console.error('\n❌  Seeding failed:', err.message);
  process.exit(1);
});