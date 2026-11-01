export type TeamAction = 'create' | 'join';
export const MIN_PASSPHRASE_LENGTH = 4;
export const MAX_PASSPHRASE_LENGTH = 64;
export function normalizePassphrase(value: unknown): string {
  if (typeof value !== 'string') throw new Error('合言葉を入力してください。');
  const normalized = value.normalize('NFC').trim();
  if ([...normalized].length < MIN_PASSPHRASE_LENGTH || [...normalized].length > MAX_PASSPHRASE_LENGTH || /[\p{Cc}\p{Cf}]/u.test(normalized)) {
    throw new Error('合言葉は4〜64文字で入力してください。');
  }
  return normalized;
}
export function teamIdFromUid(uid: string): string {
  const match = /^team:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(uid);
  if (!match) throw new Error('チームに参加し直してください。');
  return match[1];
}
