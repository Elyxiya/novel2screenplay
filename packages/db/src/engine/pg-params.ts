/**
 * pg-params - SQL 占位符翻译 + 绑定值展开
 *
 * 语义对齐目标（Task 3）：同一 repository 在 SQLite 与 PG 上行为一致、调用方零改动。
 * SQLite(better-sqlite3) 支持两类绑定，PG(node-postgres) 只认 `$N`：
 * - 命名占位符 `@name` + 单对象绑定（仓库的 INSERT/UPDATE 高频形态）。
 *   例：`run({ id, status })` + `@id, @status` → `$1, $2` 且 values=[id, status]。
 * - 匿名占位符 `?` + 位置标量绑定（仓库的 SELECT/DELETE 形态）。
 *   例：`get(jobId)` / `ALL(a, b)` + `WHERE id = ?` → `WHERE id = $1`。
 *
 * 本模块把 `@name` / `?` 统一翻译为 `$N`（按出现顺序编号），并按绑定模式展开 values。
 */

/** 是否为「单对象命名绑定」（对象字面量，非数组/非 null） */
function isObjectBind(param: unknown): boolean {
  return typeof param === 'object' && param !== null && !Array.isArray(param);
}

export interface TranslatedQuery {
  sql: string;
  values: unknown[];
}

/**
 * 把 SQLite 风格 SQL + 绑定参数翻译为 PG 风格（`$N` + 位置 values）。
 * @param sql    原始 SQL（含 `@name` 或 `?`）
 * @param params prepare().run/get/all(...) 的入参数组
 * @throws 当「? 占位符」用于对象绑定、或命名参数在绑定对象中缺失时抛明确错误
 */
export function translateQuery(sql: string, params: unknown[]): TranslatedQuery {
  // 单个普通对象 ⇒ 命名绑定；否则视为位置标量绑定
  const named = params.length === 1 && isObjectBind(params[0]);

  // 扫描 SQL，按出现顺序把 `@name` / `?` 替换为 `$N`，记录每槽对应的命名键（`?` 为 null）
  const keys: Array<string | null> = [];
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === '@') {
      const m = /^@(\w+)/.exec(sql.slice(i));
      if (m) {
        keys.push(m[1]);
        out += `$${keys.length}`;
        i += m[0].length;
        continue;
      }
    } else if (c === '?') {
      keys.push(null);
      out += `$${keys.length}`;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }

  let values: unknown[];
  if (named) {
    const obj = params[0] as Record<string, unknown>;
    values = keys.map((k) => {
      if (k === null) {
        throw new Error(`PG: '?' 占位符不能用于对象命名绑定（SQL: ${sql}）`);
      }
      if (!(k in obj)) {
        throw new Error(`PG: 命名参数 '@${k}' 在绑定对象中缺失（SQL: ${sql}）`);
      }
      return obj[k];
    });
  } else {
    values = keys.map((_, idx) => params[idx]);
  }

  return { sql: out, values };
}