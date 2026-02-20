
'use strict';

const express          = require('express');
const pool             = require('./db');
const DiscoveryService = require('./Discoveryservice');


const app     = express();
const service = new DiscoveryService(pool);
const PORT    = process.env.PORT || 3000;

app.use(express.json());


const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};


function isValidUserId(userId) {
  return /^U\d{3}$/.test(userId);
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/recommend/:userId
 *
 * Returns the top 5 book recommendations for a given user, ranked by
 * Jaccard similarity match score. Each recommendation includes a
 * human-readable reason string: "Readers with similar tastes also enjoyed…"
 *
 * Response 200:
 * {
 *   "success"  : true,
 *   "userId"   : "U001",
 *   "count"    : 5,
 *   "recommendations": [
 *     {
 *       "rank"         : 1,
 *       "book_id"      : "B020",
 *       "title"        : "Rework",
 *       "author"       : "Jason Fried",
 *       "dewey_decimal": "658.1",
 *       "match_score"  : 1.2,
 *       "reason"       : "Readers with similar tastes also enjoyed this book (matched by 2 peer reader(s))"
 *     },
 *     ...
 *   ]
 * }
 */
app.get(
  '/api/v1/recommend/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!isValidUserId(userId)) {
      return res.status(400).json({
        success: false,
        error  : `Invalid userId format. Expected format: U001, U002, … Got: "${userId}"`,
      });
    }

    const raw = await service.getRecommendations(userId, { limit: 5 });

    // Shape each result with a human-readable reason
    const recommendations = raw.map((book, index) => {
      const peerCount  = book.recommended_by.length;
      const isFallback = !!book.fallback;

      let reason;
      if (isFallback && book.fallback === 'cold_start_popularity') {
        reason = 'Trending in the library — popular with all readers right now';
      } else if (isFallback && book.fallback === 'dewey_category_popularity') {
        reason = 'Popular in subjects you already enjoy reading';
      } else {
        reason =
          `Readers with similar tastes also enjoyed this book` +
          ` (matched by ${peerCount} peer reader${peerCount !== 1 ? 's' : ''})`;
      }

      return {
        rank          : index + 1,
        book_id       : book.book_id,
        title         : book.title,
        author        : book.author,
        dewey_decimal : book.dewey_decimal,
        match_score   : book.match_score,
        reason,
      };
    });

    return res.status(200).json({
      success        : true,
      userId,
      count          : recommendations.length,
      recommendations,
    });
  })
);


/**
 * GET /api/v1/patterns/:userId
 *
 * Returns a full Reading DNA breakdown for the user — percentage
 * distribution of their borrowing history across Dewey Decimal categories.
 *
 * Response 200:
 * {
 *   "success"   : true,
 *   "userId"    : "U001",
 *   "name"      : "Amaka Okoro",
 *   "totalBooks": 7,
 *   "summary"   : "42.86% Technology & Computer Science, 28.57% Business...",
 *   "breakdown" : [
 *     { "category": "Technology & Computer Science", "dewey": "005", "count": 3, "percentage": "42.86%" },
 *     ...
 *   ]
 * }
 */
app.get(
  '/api/v1/patterns/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!isValidUserId(userId)) {
      return res.status(400).json({
        success: false,
        error  : `Invalid userId format. Expected format: U001, U002, … Got: "${userId}"`,
      });
    }

    const dna = await service.getReadingDNA(userId);

    if (dna.totalBooks === 0) {
      return res.status(404).json({
        success: false,
        userId,
        error  : `No reading history found for user "${userId}".`,
      });
    }

    return res.status(200).json({
      success   : true,
      userId    : dna.userId,
      name      : dna.name,
      totalBooks: dna.totalBooks,
      summary   : dna.summary,
      breakdown : dna.breakdown,
    });
  })
);


// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', asyncHandler(async (_req, res) => {
  // Ping the DB to confirm connectivity
  await pool.execute('SELECT 1');
  res.status(200).json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
}));


// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error  : 'Route not found. Available: GET /api/v1/recommend/:userId  |  GET /api/v1/patterns/:userId',
  });
});


// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({
    success: false,
    error  : 'Internal server error. Please try again.',
  });
});


// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n');
  console.log('   Smart Book Discovery Engine — API Server               ');
  console.log('');
  console.log(`   Listening on   http://localhost:${PORT}                   `);
  console.log('                                                          ');
  console.log('   GET /api/v1/recommend/:userId                          ');
  console.log('   GET /api/v1/patterns/:userId                           ');
  console.log('   GET /health                                            ');
  console.log('\n');
});

module.exports = app;