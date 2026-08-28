#!/usr/bin/env node
/**
 * SQLite → PostgreSQL 数据迁移脚本（一次性旁路工具，不入库）
 *
 * 按外键依赖顺序搬移业务表（schema_version 由 applySchema 自管，不搬）：
 *   users → sessions → novels → jobs → projects → history → dramas → agent_tasks → user_llm
 *
 * 用法：
 *   # 全量迁移 + 双向校验（PG 相关：DATABASE_URL）
 *   node scripts/migrate-sqlite-to-pg.mjs <sqlite.db>   # 或设置 DB_FILE / DATABASE_URL 环境变量
 *
 *   # 迁移前备份 SQLite 源库（复制为 <path>.bak.<ts>）
 *   node scripts/migrate-sqlite-to-pg.mjs <sqlite.db> --backup
 *
 *   # 目标表前清空（默认幂等 ON CONFLICT (id) DO NOTHING；--truncate 改为先 TRUNCATE）
 *   node scripts/migrate-sqlite-to-pg.mjs <sqlite.db> --truncate
 *
 *   # 干跑：只读 SQLite，报告各表行数/列/示例 SQL，不连 PG（无 PG 环境时校验接线）
 *   node scripts/migrate-sqlite-to-pg.mjs <sqlite.db> --dry-run
 *
 * 环境变量：
 *   SQLite 路径    DB_FILE   （或位置参数 argv[2]）
 *   PG 连接串      DATABASE_URL（默认全量模式必填；--dry-run 可缺省）
 *
 * 说明：旁路脚本按工作流约定不纳入 git。迁移前建议 --backup。
 */

import Database from 'better-sqlite3';
import pg from 'pg';
import fs from 'fs';
import path from 'path';

/** 业务表迁移顺序（父表先于子表，保证外键引用主键已存在） */
const TABLES = ['users', 'sessions', 'novels', 'jobs', 'projects', 'history', 'dramas', 'agent_tasks', 'user_llm'];

/** 每表抽验的代表性列（PK + 1 个内容列；按 id 采样整行做全列比对） */
const SAMPLE_LIMIT = 3;

function usage() {
  return `迁移脚本用法：
  node scripts/migrate-sqlite-to-pg.mjs <sqlite.db> [--backup] [--truncate] [--dry-run]
  环境变量：DB_FILE（源库路径）、DATABASE_URL（PG 连接串）。`;
}

function parseArgs(argv) {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const flag = (name) => argv.includes(name);
  return {
    sqlitePath: process.env.DB_FILE ?? positional[0],
    pgUrl: process.env.DATABASE_URL ?? positional[1],
    backup: flag('--backup') || process.env.MIGRATE_BACKUP === '1',
    truncate: flag('--truncate'),
    dryRun: flag('--dry-run') || process.env.MIGRATE_DRY_RUN === '1',
  };
}

/** 读取 SQLite 侧各表结构（列名）+ 行数 */
function readSqliteMeta(db) {
  const meta = {};
  for (const table of TABLES) {
    const cols = db.pragma(`table_info(${table})`).map((c) => c.name);
    if (cols.length === 0) {
      meta[table] = { columns: [], count: 0, exists: false };
      continue;
    }
    const { count } = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    meta[table] = { columns: cols, count, exists: true };
  }
  return meta;
}

/** 读取某表全部行（更好-sqlite3 返回列名对象数组） */
function readTableRows(db, table) {
  return db.prepare(`SELECT * FROM ${table}`).all();
}

/** 按列名 + 值数组构建 PG 参数化 INSERT（幂等 ON CONFLICT (id) DO NOTHING） */
function buildInsert(table, columns) {
  const ph = columns.map((_, i) => `$${i + 1}`).join(', ');
  const qcols = columns.map((c) => `"${c}"`).join(', ');
  return `INSERT INTO "${table}" (${qcols}) VALUES (${ph}) ON CONFLICT (id) DO NOTHING`;
}

/** 列值统一字符串化用于比对（避免 number/string 类型颤） */
function stringify(row, columns) {
  const out = {};
  for (const c of columns) {
    out[c] = row[c] == null ? null : String(row[c]);
  }
  return out;
}

async function verifyMigration(client, sqliteDb, meta) {
  let ok = true;
  for (const table of TABLES) {
    if (!meta[table].exists) continue;
    // 1) 行数一致（COUNT 结果在 rows[0]，非 QueryResult 顶层）
    const { rows: cntRows } = await client.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
    const pgCount = cntRows[0].count;
    const srcCount = meta[table].count;
    const countMatch = Number(pgCount) === srcCount;
    if (!countMatch) {
      ok = false;
      console.error(`  ✗ ${table}: 行数不一致 SQLite=${srcCount} PG=${pgCount}`);
    } else {
      console.log(`  ✓ ${table}: ${srcCount} 行一致`);
    }

    // 2) 抽样整行全列比对
    const rows = readTableRows(sqliteDb, table);
    const sample = rows.slice(0, SAMPLE_LIMIT);
    if (sample.length === 0) continue;
    const ids = sample.map((r) => r.id);
    const cols = meta[table].columns;
    const qcols = cols.map((c) => `"${c}"`).join(', ');
    const res = await client.query(`SELECT ${qcols} FROM "${table}" WHERE id = ANY($1)`, [ids]);
    const byId = new Map(res.rows.map((r) => [String(r.id), r]));
    for (const srcRow of sample) {
      const pgRow = byId.get(String(srcRow.id));
      const src = stringify(srcRow, cols);
      const dst = stringify(pgRow ?? {}, cols);
      const diff = cols.filter((c) => src[c] !== dst[c]);
      if (!pgRow || diff.length > 0) {
        ok = false;
        console.error(`  ✗ ${table} id=${String(srcRow.id)} 抽验不一致: [${diff.join(', ')}]`);
      }
    }
  }
  return ok;
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.sqlitePath) {
    console.error('缺少 SQLite 路径。\n' + usage());
    process.exit(1);
  }
  if (!opts.pgUrl && !opts.dryRun) {
    console.error('缺少 DATABASE_URL（PG 连接串）。\n' + usage());
    process.exit(1);
  }

  const abs = path.resolve(opts.sqlitePath);
  if (!fs.existsSync(abs)) {
    console.error(`SQLite 文件不存在: ${abs}`);
    process.exit(1);
  }

  // 备份
  if (opts.backup && !opts.dryRun) {
    const bak = `${abs}.bak.${Date.now()}`;
    fs.copyFileSync(abs, bak);
    console.log(`已备份源库 → ${bak}`);
  }

  // 只读打开源库，绝不动它
  const sqliteDb = new Database(abs, { readonly: true });
  const meta = readSqliteMeta(sqliteDb);

  console.log('SQLite 源库结构：');
  for (const t of TABLES) {
    const m = meta[t];
    console.log(`  ${t.padEnd(14)} ${m.exists ? m.count + ' 行 · [' + m.columns.slice(0, 4).join(', ') + (m.columns.length > 4 ? ', …' : '') + ']' : '(不存在，跳过)'}`);
  }

  // 干跑：不连 PG，只报告将做什么
  if (opts.dryRun) {
    console.log('\n[dry-run] 示例 INSERT（每表前 1 条）：');
    for (const t of TABLES) {
      if (!meta[t].exists || meta[t].count === 0) continue;
      const row = readTableRows(sqliteDb, t)[0];
      const cols = meta[t].columns;
      console.log(`  ${t}:`);
      console.log(`    ` + buildInsert(t, cols));
      console.log(`    values → [${cols.map((c) => `${c}=${JSON.stringify(row[c])}`).join(', ')}]`);
    }
    console.log('\n[dry-run] 完成（未连接 PG）。');
    sqliteDb.close();
    return;
  }

  const client = new pg.Client({ connectionString: opts.pgUrl });
  await client.connect();
  try {
    // 前置检查：确认目标 PG 已建表（schema 已 apply）。缺表则报错，避免半途才发现。
    const absent = [];
    for (const t of TABLES) {
      const res = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1",
        [t],
      );
      if (res.rowCount === 0) absent.push(t);
    }
    if (absent.length > 0) {
      throw new Error(
        `目标 PG 缺少表: [${absent.join(', ')}]。请先 applySchema（应用启动会自动建表）。`,
      );
    }

    // 报告目标侧现状（供操作者确认是否已有数据）
    console.log('\n目标 PG 现状（迁移前）：');
    for (const t of TABLES) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM "${t}"`);
      console.log(`  ${t.padEnd(14)} ${rows[0].c} 行`);
    }

    await client.query('BEGIN');

    // 可选清空目标表（逆序，先子后父避免外键冲突）
    if (opts.truncate) {
      for (const t of [...TABLES].reverse()) {
        if (meta[t].exists) {
          await client.query(`TRUNCATE TABLE "${t}" CASCADE`);
        }
      }
      console.log('[truncate] 已清空目标表（CASCADE）。');
    }

    for (const table of TABLES) {
      if (!meta[table].exists || meta[table].count === 0) {
        if (meta[table].exists) console.log(`  - ${table}: 0 行，跳过`);
        continue;
      }
      const cols = meta[table].columns;
      const sql = buildInsert(table, cols);
      const rows = readTableRows(sqliteDb, table);
      for (const row of rows) {
        const values = cols.map((c) => row[c]);
        await client.query(sql, values);
      }
      console.log(`  → ${table}: 写入 ${rows.length} 行`);
    }

    await client.query('COMMIT');
    console.log('\n迁移完成，开始双向校验…');
    const ok = await verifyMigration(client, sqliteDb, meta);
    if (!ok) {
      console.error('\n校验未全部通过，请检查上方 ✗ 项。');
      process.exit(2);
    }
    console.log('\n校验全部通过：行数 + 关键列抽样一致。');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // 回滚失败可忽略，事务已断
    }
    console.error('迁移失败，已回滚。', err);
    process.exit(1);
  } finally {
    await client.end();
  }
  sqliteDb.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});