import { describe, expect, it } from 'vitest';
import { normalizePassphrase, teamIdFromUid } from './team';

describe('合言葉とチームID', () => {
  it('前後の空白とUnicodeの合成表現を統一する', () => {
    expect(normalizePassphrase('  ハ\u3099スケ部  ')).toBe('バスケ部');
  });
  it('日本語・絵文字を文字単位で扱い、短すぎる入力・制御文字を拒否する', () => {
    expect(normalizePassphrase('🏀🏀🏀🏀')).toBe('🏀🏀🏀🏀');
    expect(() => normalizePassphrase('abc')).toThrow();
    expect(() => normalizePassphrase('ab\ncd')).toThrow();
  });
  it('認証されたUIDから復元し、オフラインでもチームの範囲を決められる', () => {
    const id = 'f29cc78f-08b7-4ee5-8292-b4b9f457858c';
    expect(teamIdFromUid(`team:${id}`)).toBe(id);
    expect(() => teamIdFromUid('some-email-user')).toThrow();
  });
});
