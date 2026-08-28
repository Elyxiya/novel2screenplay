#!/usr/bin/env node
/**
 * 临时旁路工具：对 DATABASE_URL 目标库应用 PG schema（SCHEMA_PG_SQL）。
 * 仅 R6 联跑辅助用，不入库。
 */
import pg from 'pg';
import { SCHEMA_PG_SQL } from '../dist/engine/schema-pg.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('缺少 DATABASE_URL');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(SCHEMA_PG_SQL);
  console.log('schema applied to', url.split('@').pop());
} finally {
  await client.end();
}
