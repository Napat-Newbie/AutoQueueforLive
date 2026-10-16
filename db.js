const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data.sqlite');
const db = new Database(dbPath);

// Enable WAL mode, configure busy_timeout, autocheckpoint, and journal_size_limit
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 10000');
db.pragma('wal_autocheckpoint = 1000');
db.pragma('journal_size_limit = 16777216'); // WAL หดกลับอัตโนมัติเหลือไม่เกิน 16MB หลัง checkpoint

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
    trans_ref TEXT,
    qr_payload TEXT,
    status TEXT DEFAULT 'waiting',
    session_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_slips_trans_date ON slips(trans_date);
  CREATE INDEX IF NOT EXISTS idx_slips_status ON slips(status);
  CREATE INDEX IF NOT EXISTS idx_slips_line_id_trans_date ON slips(line_id, trans_date);
  CREATE INDEX IF NOT EXISTS idx_slips_qr_payload ON slips(qr_payload);
  CREATE INDEX IF NOT EXISTS idx_slips_status_id ON slips(status, id);

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

// 🛡️ Migration: เพิ่ม trans_ref & session_id หากยังไม่มี และสร้าง UNIQUE INDEX ป้องกันสลิปซ้ำระดับฐานข้อมูล
try {
  const slipCols = db.pragma('table_info(slips)').map(c => c.name);
  if (!slipCols.includes('session_id')) {
    db.exec(`ALTER TABLE slips ADD COLUMN session_id TEXT;`);
    console.log('✅ Migration: เพิ่มคอลัมน์ session_id ในตาราง slips สำเร็จ');
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_slips_session_status ON slips(session_id, status);`);

  if (!slipCols.includes('trans_ref')) {
    db.exec(`ALTER TABLE slips ADD COLUMN trans_ref TEXT;`);
    console.log('✅ Migration: เพิ่มคอลัมน์ trans_ref ในตาราง slips สำเร็จ');
  }

  // 1. Backfill trans_ref สำหรับสลิปปกติที่ไม่ใช่ manual_image
  db.exec(`
    UPDATE slips 
    SET trans_ref = substr(qr_payload, 1, instr(qr_payload, '|') - 1) 
    WHERE qr_payload LIKE '%|%' 
      AND qr_payload NOT LIKE 'manual_image%' 
      AND (trans_ref IS NULL OR trans_ref = '');
  `);

  // 2. เคลียร์ trans_ref ที่เป็น 'manual_image' หรือค่าว่างให้เป็น NULL ไม่ให้ชน UNIQUE constraint
  db.exec(`UPDATE slips SET trans_ref = NULL WHERE trans_ref = 'manual_image' OR trans_ref = '';`);

  // 3. ป้องกันข้อมูลซ้ำเดิมที่มีอยู่ก่อนหน้า: ลบค่าซ้ำโดยคงเหลือไว้แค่รายการแรก เพื่อให้สร้าง UNIQUE INDEX ผ่าน 100%
  db.exec(`
    UPDATE slips 
    SET trans_ref = NULL 
    WHERE id NOT IN (
      SELECT MIN(id) FROM slips WHERE trans_ref IS NOT NULL AND trans_ref != '' GROUP BY trans_ref
    )
    AND trans_ref IS NOT NULL AND trans_ref != '';
  `);

  // 4. สร้าง Partial UNIQUE INDEX
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_slips_trans_ref ON slips(trans_ref) WHERE trans_ref IS NOT NULL AND trans_ref != '';`);
  console.log('✅ Migration: idx_slips_trans_ref UNIQUE index verified');
} catch (migErr) {
  console.error('Migration trans_ref warning:', migErr.message);
}

// Safe auto-migration for existing databases
try {
  const slipCols = db.pragma('table_info(slips)');
  if (!slipCols.some(col => col.name === 'session_id')) {
    db.exec('ALTER TABLE slips ADD COLUMN session_id TEXT;');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_slips_session_id ON slips(session_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_slips_line_id_session_id ON slips(line_id, session_id);');
} catch(migErr) {
  console.error('Migration warning (session_id):', migErr.message);
}

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

let backupInFlight = null;
async function performBackup(prefix = 'backup') {
  if (backupInFlight) return backupInFlight;
  backupInFlight = (async () => {
    const backupsDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupsDir)) {
      try { fs.mkdirSync(backupsDir, { recursive: true }); } catch (e) {}
    }
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = path.join(backupsDir, `${prefix}_${dateStr}.sqlite`);
    try {
      await db.backup(backupFile);
      console.log(`💾 Auto-Backup สำเร็จ: ${backupFile}`);

      // 🧹 เก็บเฉพาะ 10 ไฟล์ล่าสุด ลบไฟล์เก่าทิ้ง (ครอบคลุมทั้ง backup_ และ data_backup_)
      cleanupBackups(backupsDir, 10);
      return { success: true, file: backupFile };
    } catch (err) {
      console.error('Backup error:', err.message);
      return { success: false, error: err.message };
    }
  })();
  try { return await backupInFlight; } finally { backupInFlight = null; }
}

// 🧹 ฟังก์ชันจัดการล้างไฟล์สำรองเก่า (Universal SQLite Backup Pruner)
function cleanupBackups(dirPath, keepLatest = 10, maxAgeDays = 30) {
  try {
    if (!fs.existsSync(dirPath)) return;
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.sqlite'))
      .map(f => {
        const full = path.join(dirPath, f);
        return { name: f, path: full, time: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.time - a.time);

    // เก็บ keepLatest ไว้เสมอ ลบไฟล์ที่เกินโควตาหรือเก่าเกิน maxAgeDays
    files.forEach((file, index) => {
      if (index >= keepLatest || (now - file.time > maxAgeMs && index >= 3)) {
        try {
          fs.unlinkSync(file.path);
          console.log(`🧹 ลบไฟล์สำรองเก่าเรียบร้อย: ${file.name}`);
        } catch (e) {}
      }
    });
  } catch (err) {
    console.error('Error during cleanupBackups:', err.message);
  }
}

// ⚡ บำรุงรักษาฐานข้อมูล SQLite (Checkpoint WAL & Analyze Query Plan)
function optimizeDb() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('optimize');
    console.log('⚡ บำรุงรักษาฐานข้อมูล SQLite สำเร็จ (WAL Checkpointed & Optimized)');
    return true;
  } catch (err) {
    console.error('SQLite optimize error:', err.message);
    return false;
  }
}

// 🔒 ปิดฐานข้อมูลอย่างปลอดภัย (Safe Shutdown & Flush WAL)
function closeDb() {
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) {}
  try { if (db.open) db.close(); } catch (e) {}
  console.log('🔒 ฐานข้อมูล SQLite ถูกปิดอย่างปลอดภัยเรียบร้อย');
}

// ออโต้สำรองข้อมูลทุกๆ 6 ชั่วโมง และสำรองข้อมูลเมื่อปิดโปรแกรม
setInterval(performBackup, 6 * 60 * 60 * 1000);
// บำรุงรักษาฐานข้อมูลทุกๆ 12 ชั่วโมง
setInterval(optimizeDb, 12 * 60 * 60 * 1000);

module.exports = {
  db,
  query,
  from: query,
  performBackup,
  cleanupBackups,
  optimizeDb,
  closeDb,
  transaction: (fn) => db.transaction(fn),
  runTransaction: (fn) => db.transaction(fn)()
};
