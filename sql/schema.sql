CREATE DATABASE IF NOT EXISTS smart_library
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE smart_library;

CREATE TABLE IF NOT EXISTS books (
  book_id        VARCHAR(10)  NOT NULL,
  title          VARCHAR(255) NOT NULL,
  author         VARCHAR(255) NOT NULL,
  dewey_decimal  VARCHAR(20)  NOT NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (book_id),
  INDEX idx_books_dewey (dewey_decimal)          -- fast category lookups
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  user_id    VARCHAR(10)  NOT NULL,
  name       VARCHAR(255) NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS borrow_records (
  record_id   INT          NOT NULL AUTO_INCREMENT,
  user_id     VARCHAR(10)  NOT NULL,
  book_id     VARCHAR(10)  NOT NULL,
  borrow_date DATE         NOT NULL,
  return_date DATE         DEFAULT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (record_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE,
  INDEX idx_borrow_user (user_id),   -- fast lookups by user
  INDEX idx_borrow_book (book_id)    -- fast lookups by book
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loans (
  loan_id     VARCHAR(10)  NOT NULL,
  user_id     VARCHAR(10)  NOT NULL,
  book_id     VARCHAR(10)  NOT NULL,
  borrowed_at DATE         NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (loan_id),
INDEX idx_loans_user_book  (user_id, book_id),
INDEX idx_loans_book_user  (book_id, user_id),
CONSTRAINT fk_loans_user FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT fk_loans_book FOREIGN KEY (book_id)
    REFERENCES books (book_id) ON DELETE CASCADE ON UPDATE CASCADE

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

