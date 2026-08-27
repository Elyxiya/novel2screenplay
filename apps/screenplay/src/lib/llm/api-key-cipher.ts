/**
 * UserLLM api_key 加密（AES-256-GCM）
 *
 * 用途：把 user_llm.api_key 从"明文落库"升级为"落库即密文"，规避 DB 泄露直接暴露密钥。
 *
 * 设计：
 * - 密文格式：`enc:v1:<iv.base64>.<authTag.base64>.<ciphertext.base64>`，自带前缀便于识别与迁移。
 * - 密钥：32 字节 AES-256 密钥由环境变量 `USER_LLM_KEY` 派生（sha256）。
 *   未配置时使用固定开发兜底派生密钥（功能可用、确定性可测；生产必须配置强密钥）。
 * - AES-GCM 每次随机 IV，同明文每次密文不同；解密时从串中取回 IV + 认证标签。
 * - 兼容旧明文：无 `enc:v1:` 前缀的存量值原样返回（透传），配合 db.ts 的
 *   `migrateLegacyLLMKeys` 一次性自愈迁移为密文。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
export const LEGACY_MARKER = `enc:%`;

/** 派生 32 字节密钥：env `USER_LLM_KEY` → sha256；缺省用开发兜底（稳定派生，非随机）。 */
function getKey(): Buffer {
  const secret = process.env.USER_LLM_KEY?.trim();
  const source = secret || 'novel2screenplay-dev-fallback-key';
  return createHash('sha256').update(source).digest();
}

/** 加密明文 apiKey；空串（无密钥）直接返回空串，不落密文。 */
export function encryptApiKey(plain: string): string {
  if (!plain) return '';
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

/**
 * 解密存储值；旧明文（无前缀）原样返回。
 * 解密失败（密钥变更/数据损坏）返回空串，避免崩溃。
 */
export function decryptApiKey(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith(PREFIX)) return stored; // 旧明文透传
  const payload = stored.slice(PREFIX.length);
  const dot1 = payload.indexOf('.');
  const dot2 = payload.indexOf('.', dot1 + 1);
  if (dot1 < 0 || dot2 < 0) return '';
  const iv = Buffer.from(payload.slice(0, dot1), 'base64');
  const tag = Buffer.from(payload.slice(dot1 + 1, dot2), 'base64');
  const enc = Buffer.from(payload.slice(dot2 + 1), 'base64');
  if (iv.length !== IV_LEN) return '';
  try {
    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** 判断存储值是否为已加密（用于迁移时挑选明文行）。 */
export function isEncryptedApiKey(stored: string): boolean {
  return stored.startsWith(PREFIX);
}