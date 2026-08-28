// @vitest-environment node
/**
 * Schema 对齐契约测试（Task 3 · 双后端语义一致）
 *
 * 静态比对 SQLite schema.sql 与 PostgreSQL SCHEMA_PG_SQL，逐表逐列断言：
 * - 表集合一致
 * - 每张表列集合一致
 * - 列类型按既定映射规则对齐（TEXT→TEXT、INTEGER→INTEGER|BIGINT、REAL→DOUBLE PRECISION）
 * - NOT NULL / 默认值一致
 * - 索引集合一致（表级），外键约束存在性一致
 *
 * 目标：仓库在任一引擎上行为一致，无隐蔽分歧；两份 schema 任一漂移即红。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SCHEMA_PG_SQL } from '@novel/db';

/** 读取 SQLite schema.sql 原文 */
function readSqliteSchema(): string {
  const p = path.join(process.cwd(), 'src/lib/store/sqlite/schema.sql');
  return fs.readFileSync(p, 'utf-8');
}

interface ColumnDef {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
}

interface TableDef {
  columns: Record<string, ColumnDef>;
  /** 行内/内联外键关键词出现的行号字符串集合（仅判存在性） */
  inlineFk: boolean;
}

/** 列定义里用于终止「类型」捕获的约束关键字 */
const TYPE_STOPWORDS = new Set([
  'NOT',
  'DEFAULT',
  'PRIMARY',
  'REFERENCES',
  'CONSTRAINT',
  'UNIQUE',
  'CHECK',
  'COLLATE',
  'AUTOINCREMENT',
]);

/** 解析一行列定义；非列行（外键等）返回 null */
function parseColumn(line: string): ColumnDef | null {
  const t = line.trim();
  if (!t || t.startsWith('--')) return null;
  if (/^CONSTRAINT\s+\w+\s+FOREIGN KEY/.test(t) || /^FOREIGN KEY/.test(t)) return null;
  const m = t.match(/^(\w+)\s+(.+)$/);
  if (!m) return null;
  const name = m[1];
  const toks = m[2].split(/\s+/);

  // 收集类型词（直到首个约束关键字），兼容多词类型如 DOUBLE PRECISION
  const typeWords: string[] = [];
  let idx = 0;
  for (; idx < toks.length; idx++) {
    const w = toks[idx].toUpperCase();
    if (TYPE_STOPWORDS.has(w)) break;
    typeWords.push(w.replace(/,+$/, ''));
  }
  if (typeWords.length === 0) return null;

  const tail = toks.slice(idx);
  const notNull = tail.some((w) => w.toUpperCase() === 'NOT');

  let defaultVal: string | null = null;
  const dIdx = tail.findIndex((w) => w.toUpperCase() === 'DEFAULT');
  if (dIdx >= 0) {
    const rest = tail.slice(dIdx + 1).join(' ');
    const qm = rest.match(/^'([^']*)'/);
    if (qm) defaultVal = qm[1];
    else if (tail[dIdx + 1]) defaultVal = tail[dIdx + 1].replace(/,+$/, '');
  }

  return { name, type: typeWords.join(' ').toUpperCase(), notNull, default: defaultVal };
}

/** 解析一份 schema DDL，得到 表名 → 列定义 */
function parseSchema(ddl: string): Record<string, TableDef> {
  const tables: Record<string, TableDef> = {};
  for (const m of ddl.matchAll(/(?:\n|^)CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\);/g)) {
    const [, table, body] = m;
    const columns: Record<string, ColumnDef> = {};
    let inlineFk = false;
    for (const line of body.split('\n')) {
      const trimmed = line.trim().replace(/--.*$/, '').trim(); // 去掉行内注释
      if (!trimmed) continue;
      if (/^CONSTRAINT\s+\w+\s+FOREIGN KEY/.test(trimmed) || /^FOREIGN KEY/.test(trimmed)) {
        inlineFk = true;
        continue;
      }
      const col = parseColumn(trimmed);
      if (col) columns[col.name] = col;
    }
    tables[table] = { columns, inlineFk };
  }
  return tables;
}

/** 提取所有 CREATE INDEX 语句中的索引列名集合 */
function parseIndexes(ddl: string): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  const re = /CREATE INDEX IF NOT EXISTS (\w+) ON (\w+)\(([\w]+)\)/g;
  for (const m of ddl.matchAll(re)) {
    const [, _idx, table, col] = m;
    void _idx;
    (out[table] ??= new Set()).add(col);
  }
  return out;
}

/** SQLite 类型 → 允许的 PG 类型集合 */
function allowedPgTypes(sqliteType: string, name: string): string[] {
  const t = sqliteType.toUpperCase();
  if (t === 'TEXT') return ['TEXT'];
  if (t === 'REAL') {
    // sub_progress 语义为 JSON 对象（仓库 JSON.stringify 存储），SQLite REAL 系历史遗留（动态类型容忍）→ PG 用 TEXT
    if (name === 'sub_progress') return ['TEXT'];
    return ['DOUBLE PRECISION'];
  }
  if (t === 'INTEGER' || t === 'BIGINT') {
    // 时间戳列（*_at）严格映射 BIGINT；其余小整数（进度/阶段/计数）允许 INTEGER 或 BIGINT
    if (name.endsWith('_at')) return ['BIGINT'];
    return ['INTEGER', 'BIGINT'];
  }
  return [t];
}

describe('Schema 对齐 · SQLite ↔ PostgreSQL', () => {
  const sqliteDdl = readSqliteSchema();
  const pgDdl = SCHEMA_PG_SQL;
  const sqlite = parseSchema(sqliteDdl);
  const pg = parseSchema(pgDdl);
  const sqliteIdx = parseIndexes(sqliteDdl);
  const pgIdx = parseIndexes(pgDdl);

  it('表集合一致', () => {
    expect(new Set(Object.keys(sqlite))).toEqual(new Set(Object.keys(pg)));
  });

  for (const table of Object.keys(sqlite)) {
    describe(`表 ${table}`, () => {
      it('列集合一致', () => {
        const sCols = Object.keys(sqlite[table].columns).sort();
        const pCols = Object.keys(pg[table].columns).sort();
        expect(pCols).toEqual(sCols);
      });

      it('列类型 / NOT NULL / 默认值对齐', () => {
        for (const [col, def] of Object.entries(sqlite[table].columns)) {
          const pgDef = pg[table].columns[col];
          // 类型映射规则
          expect(allowedPgTypes(def.type, def.name), `${table}.${col} 类型`).toContain(pgDef.type);
          // NOT NULL
          expect(pgDef.notNull, `${table}.${col} NOT NULL`).toBe(def.notNull);
          // 默认值（无默认时 PG 侧也应为 null）
          expect(pgDef.default, `${table}.${col} DEFAULT`).toBe(def.default);
        }
      });

      it('表级索引列集合一致', () => {
        const s = new Set([...(sqliteIdx[table] ?? [])]);
        const p = new Set([...(pgIdx[table] ?? [])]);
        expect(p).toEqual(s);
      });
    });
  }

  it('外键约束存在性一致（history / sessions）', () => {
    for (const t of ['history', 'sessions']) {
      expect(pg[t].inlineFk, `${t} PG 外键`).toBe(sqlite[t].inlineFk);
    }
  });

  it('版本号记录覆盖（1..6）', () => {
    const versions = [...pgDdl.matchAll(/VALUES \(\d+,/g)].map((m) => /(\d+)/.exec(m[0])![1]);
    for (let v = 1; v <= 6; v++) {
      expect(versions, `PG schema 应含 version ${v}`).toContain(String(v));
    }
  });
});