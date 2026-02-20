/**
 * test-recommendations.js
 * Runs both Recommendation and Reading DNA tests for several users.
 *
 * Usage:
 *   node test-recommendations.js
 */

'use strict';

const pool             = require('./db');
const DiscoveryService = require('./Discoveryservice');

const service = new DiscoveryService(pool);

const DIVIDER = '='.repeat(70);
const LINE    = '-'.repeat(70);

// Test users
const TEST_USERS = [
  { userId: 'U001', label: 'Amaka Okoro  (heavy reader - 7 loans, CS + Business)' },
  { userId: 'U004', label: 'David Ibrahim (humanities - history, psychology)'      },
  { userId: 'U005', label: 'Fatima Yusuf  (finance + business reader)'             },
  { userId: 'U010', label: 'Ibrahim Musa  (single loan - cold-start edge case)'    },
];

function bar(percentage) {
  const filled = Math.round(parseFloat(percentage) / 5);
  return '#'.repeat(filled) + '.'.repeat(20 - filled);
}

async function runTests() {

  // SECTION 1: RECOMMENDATIONS
  console.log('\n' + DIVIDER);
  console.log('  SMART BOOK DISCOVERY ENGINE -- RECOMMENDATIONS');
  console.log(DIVIDER);

  for (const { userId, label } of TEST_USERS) {
    console.log('\n  User: ' + label);
    console.log(LINE);

    const recs = await service.getRecommendations(userId, { limit: 5 });

    if (recs.length === 0) {
      console.log('   No recommendations found.');
      continue;
    }

    recs.forEach((r, i) => {
      const fallback = r.fallback         ? ' [' + r.fallback + ']'          : '';
      const peers    = r.recommended_by.length
        ? ' | peers: ' + r.recommended_by.join(', ')
        : '';
      console.log(
        '  ' + (i + 1) + '. [score: ' + r.match_score.toFixed(4) + ']  ' +
        '"' + r.title + '" by ' + r.author + '  (Dewey: ' + r.dewey_decimal + ')' +
        peers + fallback
      );
    });
  }

  // SECTION 2: READING DNA
  console.log('\n\n' + DIVIDER);
  console.log('  READING DNA -- INTEREST BREAKDOWN BY SUBJECT CATEGORY');
  console.log(DIVIDER);

  for (const { userId } of TEST_USERS) {
    const dna = await service.getReadingDNA(userId);

    console.log('\n  User: ' + dna.name + ' (' + dna.userId + ') -- ' + dna.totalBooks + ' book(s) total');
    console.log(LINE);

    if (dna.totalBooks === 0) {
      console.log('   No reading history found.');
      continue;
    }

    dna.breakdown.forEach(b => {
      const label = b.category.padEnd(38, ' ');
      console.log(
        '  ' + label + ' [' + bar(b.percentage) + ']  ' +
        b.percentage.padStart(6) + '  (' + b.count + ' book' + (b.count > 1 ? 's' : '') + ')'
      );
    });

    console.log('\n  Summary: ' + dna.summary);
  }

  console.log('\n\n' + DIVIDER);
  console.log('  All tests complete.');
  console.log(DIVIDER + '\n');

  await pool.end();
}

runTests().catch(err => {
  console.error('\nTest failed: ' + err.message);
  console.error(err.stack);
  pool.end();
  process.exit(1);
});