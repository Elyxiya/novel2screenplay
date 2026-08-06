/**
 * 密码哈希与校验（Node 内置 crypto.scrypt，无需外部依赖）
 *
 * 存储格式: `salt$hash`（均为 hex 编码）
 * - salt: 16 字节随机盐
 * - hash: scrypt(password, salt, 64) 派生结果
 */

import { randomBytes, scrypt, timingSafeEqual } from 'crypto';

const KEY_LEN = 64;

/** 生成密码哈希（异步，scrypt 计算量适中保证安全） */
export function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(`${salt}$${derivedKey.toString('hex')}`);
    });
  });
}

/** 校验密码与存储哈希是否匹配（时间安全比较） */
export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [salt, hashHex] = stored.split('$');
    if (!salt || !hashHex) {
      resolve(false);
      return;
    }
    scrypt(password, salt, KEY_LEN, (err, derivedKey) => {
      if (err) {
        resolve(false);
        return;
      }
      const expected = Buffer.from(hashHex, 'hex');
      const actual = derivedKey;
      const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
      resolve(ok);
    });
  });
}
