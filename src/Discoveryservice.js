/**
 * DiscoveryService.js — Smart Book Discovery Engine
 * ─────────────────────────────────────────────────
 * Deterministic, AI-free recommendation engine using Jaccard Similarity.
 *
 * Algorithm Overview:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  1. Fetch the target user's borrowed book set  (Set A)          │
 * │  2. Fetch every other user's borrowed book set (Set B)          │
 * │  3. Compute Jaccard(A, B) = |A ∩ B| / |A ∪ B|  for each peer  │
 * │  4. Keep peers whose score > MIN_SIMILARITY threshold           │
 * │  5. Collect books peers read that target user has NOT read      │
 * │  6. Rank candidates by weighted peer match score                │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Usage:
 *   const pool    = require('./db');          // mysql2/promise pool
 *   const service = new DiscoveryService(pool);
 *   const results = await service.getRecommendations('U001');
 */

'use strict';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Peers with Jaccard score below this threshold are ignored. */
const MIN_SIMILARITY  = 0.1;

/** Maximum number of peer users to consider (avoids O(n²) blowup at scale). */
const MAX_PEERS       = 50;

/** Maximum number of book recommendations to return. */
const MAX_RESULTS     = 10;


// ── DiscoveryService ───────────────────────────────────────────────────────────

class DiscoveryService {
  /**
   * @param {import('mysql2/promise').Pool} pool  — mysql2 connection pool
   */
  constructor(pool) {
    if (!pool) throw new Error('DiscoveryService requires a mysql2 pool instance.');
    this.pool = pool;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns personalised book recommendations for a user.
   *
   * @param  {string}  userId          — e.g. "U001"
   * @param  {object}  [opts]
   * @param  {number}  [opts.limit]    — max results (default MAX_RESULTS)
   * @param  {number}  [opts.minScore] — min Jaccard score (default MIN_SIMILARITY)
   * @returns {Promise<RecommendationResult[]>}
   */
  async getRecommendations(userId, opts = {}) {
    const limit    = opts.limit    ?? MAX_RESULTS;
    const minScore = opts.minScore ?? MIN_SIMILARITY;

    // ── Step 1: Load all loan data in two efficient queries ──────────────────

    const targetBooks = await this._getBorrowedBooks(userId);

    if (targetBooks.size === 0) {
      // Cold-start: user has no history → fall back to popularity ranking
      return this._coldStartFallback(userId, limit);
    }

    const allUserBooks = await this._getAllUserBooks(userId);

    if (Object.keys(allUserBooks).length === 0) {
      return [];
    }

    // ── Step 2: Compute Jaccard Similarity for every peer ────────────────────

    const peers = this._scorePeers(targetBooks, allUserBooks, minScore);

    if (peers.length === 0) {
      // No similar peers found → fall back to Dewey category popularity
      return this._deweyFallback(userId, targetBooks, limit);
    }

    // ── Step 3: Aggregate candidate books from top peers ─────────────────────

    const candidates = this._aggregateCandidates(
      peers.slice(0, MAX_PEERS),
      targetBooks
    );

    // ── Step 4: Enrich with book metadata and return ranked list ─────────────

    return this._enrichAndRank(candidates, limit);
  }

  // ── Private: Data Fetching ─────────────────────────────────────────────────

  /**
   * Returns the Set of book_ids borrowed by `userId`.
   * Hits the composite index (user_id, book_id) — covering scan.
   *
   * @param  {string} userId
   * @returns {Promise<Set<string>>}
   */
  async _getBorrowedBooks(userId) {
    const [rows] = await this.pool.execute(
      `SELECT book_id
         FROM loans
        WHERE user_id = ?`,
      [userId]
    );
    return new Set(rows.map(r => r.book_id));
  }

  /**
   * Returns a map of { peerId → Set<book_id> } for every user EXCEPT `userId`.
   * Single query, processed in JS — avoids N+1 queries.
   *
   * @param  {string} excludeUserId
   * @returns {Promise<Record<string, Set<string>>>}
   */
  async _getAllUserBooks(excludeUserId) {
    // ORDER BY user_id lets us stream-group results if needed at scale
    const [rows] = await this.pool.execute(
      `SELECT user_id, book_id
         FROM loans
        WHERE user_id <> ?
        ORDER BY user_id`,
      [excludeUserId]
    );

    // Group into { userId → Set<bookId> }
    return rows.reduce((map, { user_id, book_id }) => {
      if (!map[user_id]) map[user_id] = new Set();
      map[user_id].add(book_id);
      return map;
    }, {});
  }

  // ── Private: Jaccard Similarity ────────────────────────────────────────────

  /**
   * Computes Jaccard Similarity between two Sets.
   *
   *   Jaccard(A, B) = |A ∩ B| / |A ∪ B|
   *
   * Range: 0.0 (no overlap) → 1.0 (identical sets)
   *
   * @param  {Set<string>} setA
   * @param  {Set<string>} setB
   * @returns {number}
   */
  _jaccard(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 0;

    let intersectionCount = 0;
    // Iterate the smaller set for efficiency
    const [smaller, larger] = setA.size <= setB.size
      ? [setA, setB]
      : [setB, setA];

    for (const item of smaller) {
      if (larger.has(item)) intersectionCount++;
    }

    const unionCount = setA.size + setB.size - intersectionCount;
    return intersectionCount / unionCount;
  }

  /**
   * Scores all peers against the target user's book set.
   * Returns peers sorted by descending Jaccard score, filtered by minScore.
   *
   * @param  {Set<string>}            targetBooks
   * @param  {Record<string,Set>}     allUserBooks
   * @param  {number}                 minScore
   * @returns {{ peerId: string, score: number, books: Set<string> }[]}
   */
  _scorePeers(targetBooks, allUserBooks, minScore) {
    const scored = [];

    for (const [peerId, peerBooks] of Object.entries(allUserBooks)) {
      const score = this._jaccard(targetBooks, peerBooks);
      if (score >= minScore) {
        scored.push({ peerId, score, books: peerBooks });
      }
    }

    // Sort descending by similarity score
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  // ── Private: Candidate Aggregation ────────────────────────────────────────

  /**
   * Collects books from peers that the target user has NOT read.
   * Each candidate accumulates a weighted score = sum of peer Jaccard scores.
   *
   * This means a book recommended by a 0.9-similarity peer outranks
   * the same book recommended by a 0.3-similarity peer.
   *
   * @param  {{ peerId, score, books }[]} peers
   * @param  {Set<string>}               targetBooks  — books to exclude
   * @returns {Map<string, { weightedScore: number, recommendedBy: string[] }>}
   */
  _aggregateCandidates(peers, targetBooks) {
    const candidates = new Map();

    for (const { peerId, score, books } of peers) {
      for (const bookId of books) {
        if (targetBooks.has(bookId)) continue;   // user already read this

        if (!candidates.has(bookId)) {
          candidates.set(bookId, { weightedScore: 0, recommendedBy: [] });
        }
        const entry = candidates.get(bookId);
        entry.weightedScore  += score;           // accumulate similarity weight
        entry.recommendedBy.push(peerId);
      }
    }

    return candidates;
  }

  // ── Private: Enrichment & Ranking ─────────────────────────────────────────

  /**
   * Fetches book metadata for all candidate book_ids, merges with scores,
   * and returns the top `limit` results sorted by weightedScore descending.
   *
   * @param  {Map<string, object>} candidates
   * @param  {number}              limit
   * @returns {Promise<RecommendationResult[]>}
   */
  async _enrichAndRank(candidates, limit) {
    if (candidates.size === 0) return [];

    const bookIds      = [...candidates.keys()];
    const placeholders = bookIds.map(() => '?').join(', ');

    const [books] = await this.pool.execute(
      `SELECT book_id, title, author, dewey_decimal
         FROM books
        WHERE book_id IN (${placeholders})`,
      bookIds
    );

    const results = books.map(book => {
      const { weightedScore, recommendedBy } = candidates.get(book.book_id);
      return {
        book_id      : book.book_id,
        title        : book.title,
        author       : book.author,
        dewey_decimal: book.dewey_decimal,
        match_score  : parseFloat(weightedScore.toFixed(4)),
        recommended_by: recommendedBy,
      };
    });

    // Sort by match score descending, break ties alphabetically by title
    results.sort((a, b) =>
      b.match_score - a.match_score || a.title.localeCompare(b.title)
    );

    return results.slice(0, limit);
  }

  // ── Private: Fallbacks ─────────────────────────────────────────────────────

  /**
   * Cold-start fallback: returns the most-borrowed books globally
   * for users with zero loan history.
   *
   * @param  {string} userId
   * @param  {number} limit
   * @returns {Promise<RecommendationResult[]>}
   */
  async _coldStartFallback(userId, limit) {
    const [rows] = await this.pool.execute(
      `SELECT b.book_id, b.title, b.author, b.dewey_decimal,
              COUNT(l.loan_id) AS borrow_count
         FROM books b
         JOIN loans l ON l.book_id = b.book_id
        GROUP BY b.book_id
        ORDER BY borrow_count DESC
        LIMIT ?`,
      [limit]
    );

    return rows.map(r => ({
      book_id       : r.book_id,
      title         : r.title,
      author        : r.author,
      dewey_decimal : r.dewey_decimal,
      match_score   : 0,
      recommended_by: [],
      fallback      : 'cold_start_popularity',
    }));
  }

  /**
   * Dewey Decimal fallback: when no similar peers are found, recommend
   * popular books in the same subject categories the user already reads.
   *
   * @param  {string}      userId
   * @param  {Set<string>} targetBooks
   * @param  {number}      limit
   * @returns {Promise<RecommendationResult[]>}
   */
  async _deweyFallback(userId, targetBooks, limit) {
    const bookIdList   = [...targetBooks];
    const placeholders = bookIdList.map(() => '?').join(', ');

    const [rows] = await this.pool.execute(
      `SELECT b2.book_id, b2.title, b2.author, b2.dewey_decimal,
              COUNT(l.loan_id) AS borrow_count
         FROM books b1
         JOIN books b2
           ON b2.dewey_decimal = b1.dewey_decimal
          AND b2.book_id NOT IN (${placeholders})
         JOIN loans l ON l.book_id = b2.book_id
        WHERE b1.book_id IN (${placeholders})
        GROUP BY b2.book_id
        ORDER BY borrow_count DESC
        LIMIT ?`,
      [...bookIdList, ...bookIdList, limit]
    );

    return rows.map(r => ({
      book_id       : r.book_id,
      title         : r.title,
      author        : r.author,
      dewey_decimal : r.dewey_decimal,
      match_score   : 0,
      recommended_by: [],
      fallback      : 'dewey_category_popularity',
    }));
  }

  // ── Public: Reading DNA ────────────────────────────────────────────────────

  /**
   * Analyses a user's full loan history and returns a percentage breakdown
   * of their reading interests by Dewey Decimal subject category.
   *
   * Example output:
   * {
   *   userId      : 'U001',
   *   name        : 'Amaka Okoro',
   *   totalBooks  : 7,
   *   breakdown   : [
   *     { category: 'Technology & Computer Science', dewey: '005', count: 3, percentage: '42.86%' },
   *     { category: 'Business & Management',         dewey: '658', count: 2, percentage: '28.57%' },
   *     ...
   *   ],
   *   summary     : '42.86% Technology & Computer Science, 28.57% Business & Management, ...'
   * }
   *
   * @param  {string} userId  — e.g. "U001"
   * @returns {Promise<ReadingDNA>}
   */
  async getReadingDNA(userId) {
    // ── Step 1: Fetch user name + all their loans joined with book categories ──
    const [rows] = await this.pool.execute(
      `SELECT u.name,
              b.dewey_decimal,
              COUNT(*) AS book_count
         FROM users u
         JOIN loans  l ON l.user_id = u.user_id
         JOIN books  b ON b.book_id = l.book_id
        WHERE u.user_id = ?
        GROUP BY b.dewey_decimal
        ORDER BY book_count DESC`,
      [userId]
    );

    // ── Step 2: Handle unknown user or zero loans ─────────────────────────────
    if (rows.length === 0) {
      return {
        userId,
        name      : 'Unknown',
        totalBooks: 0,
        breakdown : [],
        summary   : 'No reading history found.',
      };
    }

    const userName  = rows[0].name;
    const totalBooks = rows.reduce((sum, r) => sum + Number(r.book_count), 0);

    // ── Step 3: Map each Dewey code to a human-readable category name ─────────
    const breakdown = rows.map(r => {
      const dewey      = String(r.dewey_decimal);
      const category   = DiscoveryService._deweyCategory(dewey);
      const count      = Number(r.book_count);
      const percentage = ((count / totalBooks) * 100).toFixed(2) + '%';

      return { category, dewey, count, percentage };
    });

    // ── Step 4: Build the human-readable summary string ───────────────────────
    const summary = breakdown
      .map(b => `${b.percentage} ${b.category}`)
      .join(', ');

    return { userId, name: userName, totalBooks, breakdown, summary };
  }

  // ── Private: Dewey Decimal Category Resolver ──────────────────────────────

  /**
   * Maps a Dewey Decimal number string to a subject category label.
   * Uses the top-level hundred class with known sub-class overrides
   * for the most common library subjects.
   *
   * @param  {string} dewey  — e.g. "005.1", "658.4"
   * @returns {string}       — human-readable category name
   */
  static _deweyCategory(dewey) {
    const num = parseFloat(dewey);

    // ── Specific sub-class overrides (checked first, most precise) ────────────
    const specific = {
      '005' : 'Technology & Computer Science',
      '153' : 'Cognitive Psychology',
      '155' : 'Developmental Psychology',
      '158' : 'Applied Psychology & Self-Help',
      '302' : 'Social Influences & Behaviour',
      '332' : 'Finance & Economics',
      '658' : 'Business & Management',
      '745' : 'Design & Decorative Arts',
      '909' : 'World History',
      '921' : 'Biography & Memoir',
    };

    // Match on the first 3 digits of the Dewey number
    const prefix = String(Math.floor(num)).padStart(3, '0').slice(0, 3);
    if (specific[prefix]) return specific[prefix];

    // ── Fallback: broad hundred-class divisions ───────────────────────────────
    if (num < 100) return 'General & Computer Science';
    if (num < 200) return 'Philosophy & Psychology';
    if (num < 300) return 'Religion & Theology';
    if (num < 400) return 'Social Sciences';
    if (num < 500) return 'Language & Linguistics';
    if (num < 600) return 'Pure Science';
    if (num < 700) return 'Applied Science & Technology';
    if (num < 800) return 'Arts & Recreation';
    if (num < 900) return 'Literature';
    return 'History, Geography & Biography';
  }
}


// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = DiscoveryService;


/**
 * @typedef {object} RecommendationResult
 * @property {string}   book_id         — e.g. "B005"
 * @property {string}   title           — book title
 * @property {string}   author          — author name
 * @property {string}   dewey_decimal   — Dewey Decimal class
 * @property {number}   match_score     — weighted Jaccard score (higher = better)
 * @property {string[]} recommended_by  — peer user_ids who read this book
 * @property {string}   [fallback]      — set if a fallback strategy was used
 */

/**
 * @typedef {object} ReadingDNA
 * @property {string}             userId      — user ID
 * @property {string}             name        — user's full name
 * @property {number}             totalBooks  — total books borrowed
 * @property {ReadingDNAEntry[]}  breakdown   — per-category breakdown
 * @property {string}             summary     — human-readable summary string
 */

/**
 * @typedef {object} ReadingDNAEntry
 * @property {string} category    — human-readable Dewey category name
 * @property {string} dewey       — raw Dewey Decimal value
 * @property {number} count       — number of books in this category
 * @property {string} percentage  — formatted percentage string e.g. "42.86%"
 */