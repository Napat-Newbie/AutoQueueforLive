const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data.sqlite');
const db = new Database(dbPath);

// Enable WAL mode for high performance and concurrency
db.pragma('journal_mode = WAL');

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS configs (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS slips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL DEFAULT 0,
    draws INTEGER DEFAULT 0,
    sender_name TEXT,
    line_name TEXT,
    line_id TEXT,
    trans_date TEXT,
    trans_time TEXT,
    qr_payload TEXT,
    status TEXT DEFAULT 'waiting',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS customers (
    line_id TEXT PRIMARY KEY,
    name TEXT,
    balance REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_id TEXT UNIQUE
  );
`);

console.log('📦 Local SQLite Database Initialized:', dbPath);

// Helper Query Builder to seamlessly match Supabase client interface
function query(tableName) {
  let _selectFields = '*';
  let _whereClauses = [];
  let _params = [];
  let _orders = [];
  let _limit = null;
  let _single = false;

  const builder = {
    select(fields = '*') {
      _selectFields = fields;
      return builder;
    },
    eq(col, val) {
      _whereClauses.push(`${col} = ?`);
      _params.push(val);
      return builder;
    },
    neq(col, val) {
      _whereClauses.push(`${col} != ?`);
      _params.push(val);
      return builder;
    },
    in(col, arr) {
      if (!arr || arr.length === 0) {
        _whereClauses.push(`1 = 0`);
      } else {
        const placeholders = arr.map(() => '?').join(',');
        _whereClauses.push(`${col} IN (${placeholders})`);
        _params.push(...arr);
      }
      return builder;
    },
    like(col, pattern) {
      _whereClauses.push(`${col} LIKE ?`);
      _params.push(pattern);
      return builder;
    },
    ilike(col, pattern) {
      _whereClauses.push(`${col} LIKE ?`);
      _params.push(pattern);
      return builder;
    },
    gte(col, val) {
      _whereClauses.push(`${col} >= ?`);
      _params.push(val);
      return builder;
    },
    lte(col, val) {
      _whereClauses.push(`${col} <= ?`);
      _params.push(val);
      return builder;
    },
    or(conditionsStr) {
      // e.g. "sender_name.ilike.TEST%,sender_name.ilike.%จำลอง%,qr_payload.ilike.SIMULATE%"
      const parts = conditionsStr.split(',');
      const orClauses = [];
      parts.forEach(part => {
        const p = part.trim();
        if (p.includes('.ilike.')) {
          const [col, pat] = p.split('.ilike.');
          orClauses.push(`${col} LIKE ?`);
          _params.push(pat);
        } else if (p.includes('.like.')) {
          const [col, pat] = p.split('.like.');
          orClauses.push(`${col} LIKE ?`);
          _params.push(pat);
        } else if (p.includes('.eq.')) {
          const [col, val] = p.split('.eq.');
          orClauses.push(`${col} = ?`);
          _params.push(val);
        }
      });
      if (orClauses.length > 0) {
        _whereClauses.push(`(${orClauses.join(' OR ')})`);
      }
      return builder;
    },
    order(col, options = { ascending: true }) {
      const dir = options.ascending ? 'ASC' : 'DESC';
      _orders.push(`${col} ${dir}`);
      return builder;
    },
    limit(num) {
      _limit = num;
      return builder;
    },
    single() {
      _single = true;
      _limit = 1;
      return builder.then ? builder.then(r => r) : builder;
    },

    // Insert operation
    insert(records) {
      const list = Array.isArray(records) ? records : [records];
      
      const executeInsert = () => {
        if (list.length === 0) return [];
        const results = [];
        const insertTx = db.transaction(() => {
          list.forEach(rec => {
            const keys = Object.keys(rec);
            const cols = keys.join(', ');
            const placeholders = keys.map(() => '?').join(', ');
            const values = Object.values(rec);
            const stmt = db.prepare(`INSERT INTO ${tableName} (${cols}) VALUES (${placeholders})`);
            const info = stmt.run(...values);
            results.push({ ...rec, id: Number(info.lastInsertRowid) });
          });
        });
        insertTx();
        return results;
      };

      const chain = {
        select() {
          return {
            single() {
              return {
                then(resolve) {
                  try {
                    const inserted = executeInsert();
                    const res = { data: inserted[0] || null, error: null };
                    if (resolve) resolve(res);
                    return Promise.resolve(res);
                  } catch (e) {
                    const res = { data: null, error: e };
                    if (resolve) resolve(res);
                    return Promise.resolve(res);
                  }
                }
              };
            },
            then(resolve) {
              try {
                const inserted = executeInsert();
                const res = { data: inserted, error: null };
                if (resolve) resolve(res);
                return Promise.resolve(res);
              } catch(e) {
                const res = { data: null, error: e };
                if (resolve) resolve(res);
                return Promise.resolve(res);
              }
            }
          };
        },
        then(resolve) {
          try {
            const inserted = executeInsert();
            const res = { data: list.length === 1 && !Array.isArray(records) ? inserted[0] : inserted, error: null };
            if (resolve) resolve(res);
            return Promise.resolve(res);
          } catch(e) {
            const res = { data: null, error: e };
            if (resolve) resolve(res);
            return Promise.resolve(res);
          }
        }
      };

      return chain;
    },

    // Upsert operation
    async upsert(records) {
      const list = Array.isArray(records) ? records : [records];
      if (list.length === 0) return { data: [], error: null };

      try {
        const upsertTx = db.transaction(() => {
          list.forEach(rec => {
            const keys = Object.keys(rec);
            const cols = keys.join(', ');
            const placeholders = keys.map(() => '?').join(', ');
            const updateCols = keys.map(k => `${k} = excluded.${k}`).join(', ');
            const values = Object.values(rec);
            const stmt = db.prepare(`INSERT INTO ${tableName} (${cols}) VALUES (${placeholders}) ON CONFLICT DO UPDATE SET ${updateCols}`);
            stmt.run(...values);
          });
        });
        upsertTx();
        return { data: list, error: null };
      } catch (err) {
        return { data: null, error: err };
      }
    },

    // Update operation
    update(updates) {
      return {
        ...builder,
        async then(resolve, reject) {
          try {
            const setKeys = Object.keys(updates);
            const setClauses = setKeys.map(k => `${k} = ?`).join(', ');
            const setVals = Object.values(updates);
            
            let sql = `UPDATE ${tableName} SET ${setClauses}`;
            if (_whereClauses.length > 0) sql += ` WHERE ${_whereClauses.join(' AND ')}`;
            
            const stmt = db.prepare(sql);
            const res = stmt.run(...setVals, ..._params);
            const result = { data: res, error: null };
            if (resolve) resolve(result);
            return result;
          } catch(err) {
            const result = { data: null, error: err };
            if (resolve) resolve(result);
            return result;
          }
        },
        eq(col, val) { builder.eq(col, val); return this; },
        in(col, arr) { builder.in(col, arr); return this; }
      };
    },

    // Delete operation
    delete() {
      return {
        ...builder,
        then(resolve, reject) {
          try {
            let sql = `DELETE FROM ${tableName}`;
            if (_whereClauses.length > 0) sql += ` WHERE ${_whereClauses.join(' AND ')}`;
            const stmt = db.prepare(sql);
            const res = stmt.run(..._params);
            const result = { data: res, error: null };
            if (resolve) resolve(result);
            return Promise.resolve(result);
          } catch(err) {
            const result = { data: null, error: err };
            if (resolve) resolve(result);
            return Promise.resolve(result);
          }
        },
        eq(col, val) { builder.eq(col, val); return this; },
        or(cond) { builder.or(cond); return this; }
      };
    },

    // Awaitable SELECT
    then(resolve, reject) {
      try {
        let sql = `SELECT ${_selectFields} FROM ${tableName}`;
        if (_whereClauses.length > 0) sql += ` WHERE ${_whereClauses.join(' AND ')}`;
        if (_orders.length > 0) sql += ` ORDER BY ${_orders.join(', ')}`;
        if (_limit) sql += ` LIMIT ${_limit}`;

        const stmt = db.prepare(sql);
        let data;
        if (_single) {
          data = stmt.get(..._params) || null;
        } else {
          data = stmt.all(..._params);
        }
        const result = { data, error: null };
        if (resolve) resolve(result);
        return Promise.resolve(result);
      } catch (err) {
        const result = { data: null, error: err };
        if (resolve) resolve(result);
        return Promise.resolve(result);
      }
    }
  };

  return builder;
}

async function performBackup() {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) {
    try { fs.mkdirSync(backupsDir, { recursive: true }); } catch (e) {}
  }
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = path.join(backupsDir, `backup_${dateStr}.sqlite`);
  try {
    await db.backup(backupFile);
    console.log(`💾 Auto-Backup สำเร็จ: ${backupFile}`);

    // เก็บเฉพาะ 10 ไฟล์ล่าสุด ลบไฟล์เก่าทิ้ง
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('backup_') && f.endsWith('.sqlite'))
      .map(f => ({ name: f, path: path.join(backupsDir, f), time: fs.statSync(path.join(backupsDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    if (files.length > 10) {
      files.slice(10).forEach(old => {
        try { fs.unlinkSync(old.path); } catch(e) {}
      });
    }
    return { success: true, file: backupFile };
  } catch (err) {
    console.error('Backup error:', err.message);
    return { success: false, error: err.message };
  }
}

// ออโต้สำรองข้อมูลทุกๆ 6 ชั่วโมง และสำรองข้อมูลเมื่อปิดโปรแกรม
setInterval(performBackup, 6 * 60 * 60 * 1000);

module.exports = {
  db,
  query,
  from: query,
  performBackup
};
