Smart Book Discovery Engine 

An AI-Free, deterministic recommendation engine for libraries. This project uses pure relational algebra and set theory to suggest books based on borrowing behavior and "Reading DNA."

 Key Features
Transparent Recommendations: Uses Jaccard Similarity to find peer readers. No "black-box" neural networks.

Reading DNA: Analyzes borrowing patterns to categorize user interests via the Dewey Decimal System.

High Performance: Optimized for MySQL with composite indexing to handle self-join operations at scale.

Cold-Start Protection: Automatically falls back to library-wide trending books for new users.

 Tech Stack
Runtime: Node.js

Database: MySQL 8.0+

API Framework: Express.js

Driver: mysql2/promise

How the Algorithm WorksUnlike modern AI, this engine is deterministic. It calculates the similarity between User A and User B using the Jaccard Index:$$J(A, B) = \frac{|A \cap B|}{|A \cup B|}$$Intersection ($A \cap B$): Books both users have read.Union ($A \cup B$): Total unique books read by both users combined.Result: A score between 0 and 1. The higher the score, the more "peer-aligned" the users are.

Getting Started
 Prerequisites
Node.js installed.

A running MySQL instance.
 Database Setup
  Log into MySQL and run:
mysql -u root -p < sql/schema.sql

Installation
Bash
git clone https://github.com/your-username/smart-book-discovery.git
cd smart-book-discovery
npm install
Configuration
Create a .env file (see .env.example):

Code snippet
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=smart_library
 Seed Data
Populate the database with the provided library dataset:

Bash
node scripts/seed.js
 Run the Server
Bash
npm start
 API Endpoints
 Method,Endpoint,Description
GET,/api/v1/recommend/:userId,Get 5 personalized book matches.
` GET,/api/v1/patterns/:userId,Get a breakdown of Reading DNA/Interests.

Testing
To verify the recommendation logic against the test cases:

Bash
node tests/test-recommendations.js
