const Database = require("better-sqlite3");
const db = new Database("database.db");

db.exec(`
CREATE TABLE IF NOT EXISTS telegram_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  balance REAL DEFAULT 0,
  step TEXT,
  state TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_service_id TEXT UNIQUE,
  category_name TEXT,
  name TEXT,
  rate REAL DEFAULT 0,
  min INTEGER DEFAULT 1,
  max INTEGER DEFAULT 1,
  refill INTEGER DEFAULT 0,
  cancel INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT,
  service_id INTEGER,
  provider_order_id TEXT,
  service_name TEXT,
  link TEXT,
  quantity INTEGER,
  price REAL,
  status TEXT DEFAULT 'Pending',
  charge TEXT,
  start_count TEXT,
  remains TEXT,
  currency TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT,
  amount REAL,
  type TEXT,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  action TEXT,
  response TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT,
  method TEXT,
  amount REAL DEFAULT 0,
  receipt_file_id TEXT,
  receipt_type TEXT,
  status TEXT DEFAULT 'pending',
  admin_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

module.exports = db;
