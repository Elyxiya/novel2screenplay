/**
 * User Repository - 用户账户 CRUD 操作
 */

import { getEngine } from '@novel/db';

export interface User {
  id: string;
  username: string;
  email: string | null;
  /** scrypt 哈希（salt$hash），不对外暴露 */
  passwordHash: string;
  createdAt: number;
  updatedAt: number;
}

/** 对外公开的用户信息（不含密码哈希） */
export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  createdAt: number;
}

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  created_at: number;
  updated_at: number;
}

export interface UserRepository {
  create(params: { username: string; email?: string; passwordHash: string }): string;
  getByUsername(username: string): User | null;
  getByEmail(email: string): User | null;
  getById(id: string): User | null;
  updatePassword(id: string, passwordHash: string): void;
  updateProfile(id: string, params: { email?: string | null }): void;
  delete(id: string): void;
  toPublic(user: User): PublicUser;
}

class UserRepositoryImpl implements UserRepository {
  create(params: { username: string; email?: string; passwordHash: string }): string {
    const db = getEngine();
    const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    db.prepare(
      'INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      params.username,
      params.email ?? null,
      params.passwordHash,
      now,
      now,
    );
    return id;
  }

  getByUsername(username: string): User | null {
    const db = getEngine();
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    return row ? this.rowToUser(row) : null;
  }

  getByEmail(email: string): User | null {
    const db = getEngine();
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    return row ? this.rowToUser(row) : null;
  }

  getById(id: string): User | null {
    const db = getEngine();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? this.rowToUser(row) : null;
  }

  updatePassword(id: string, passwordHash: string): void {
    const db = getEngine();
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, Date.now(), id);
  }

  updateProfile(id: string, params: { email?: string | null }): void {
    const db = getEngine();
    if (params.email !== undefined) {
      db.prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?')
        .run(params.email, Date.now(), id);
    } else {
      db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(Date.now(), id);
    }
  }

  delete(id: string): void {
    const db = getEngine();
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  toPublic(user: User): PublicUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
    };
  }

  private rowToUser(row: UserRow): User {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

let instance: UserRepository | null = null;

export function getUserRepository(): UserRepository {
  if (!instance) instance = new UserRepositoryImpl();
  return instance;
}
