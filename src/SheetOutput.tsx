import { useEffect, useMemo, useState } from 'react';
import type { Game, Play } from './domain';
import { buildSheetPages, pageSvg, type OutputKind } from './sheetDrawing';
import { sheetWarnings } from './to';
export function SheetOutput({ game, plays, pending }: { game: Game; plays: Play[]; pending: boolean }) {
  const [kind, setKind] = useState<OutputKind>('all');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const [zoom, setZoom] = useState(false);
  useEffect(() => { setDownload(null); }, [game, plays, kind]);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
  const pages = useMemo(() => buildSheetPages(game, plays, kind), [game, plays, kind]);
  const warnings = useMemo(() => sheetWarnings(game, plays), [game, plays]);
  async function pdf() {
    setWorking(true); setError('');
    try {
      const { createSheetPdf } = await import('./sheetPdf');
      const response = await fetch('/fonts/NotoSansJP.ttf');
      if (!response.ok) throw new Error('PDF用フォントを取得できません。接続後に再試行するか、印刷用画面を使ってください。');
      const bytes = await createSheetPdf(pages, new Uint8Array(await response.arrayBuffer()));
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
      const name = `バスケ_${game.date}_${game.opponent.replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
      setDownload({ url, name });
      const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    } catch (err) { setError((err as Error).message); }
    finally { setWorking(false); }
  }
  return <section className="sheet-output"><div className="panel stack no-print"><h2>スコアシート・印刷</h2><p className="small muted">部内記録用・2024年様式。署名欄は印刷後に手書きできます。</p>
    <label>出力する内容<select value={kind} onChange={e => setKind(e.target.value as OutputKind)}><option value="all">スコアシート＋選手別成績</option><option value="sheet">スコアシートのみ（補足を含む）</option><option value="stats">選手別成績のみ</option></select></label>
    {pending && <p role="status">未送信の記録があります。表示はこの端末の記録に基づきます。</p>}
    {!!warnings.length && <details><summary>未記入・未確認の項目（{warnings.length}件）</summary><ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul><p className="small">空欄を残して出力できます。「スコアシート情報」で補足・確認してください。</p></details>}
    <button className="primary" disabled={working} onClick={() => { void pdf(); }}>{working ? 'PDFを作成中…' : 'PDFを保存'}</button><button disabled={working} onClick={() => window.print()}>印刷・印刷用画面</button>
    {download && <a href={download.url} download={download.name} target="_blank" rel="noreferrer">作成したPDFを開く・保存する</a>}
    <button className="quiet" onClick={() => setZoom(!zoom)}>{zoom ? '全体表示に戻す' : '拡大して見る'}</button>
    {error && <p className="error" role="alert">{error}</p>}
  </div><div className={`sheet-pages ${zoom ? 'zoomed' : ''}`}>{pages.map((page, i) => <div className="sheet-paper" key={i} dangerouslySetInnerHTML={{ __html: pageSvg(page) }} />)}</div></section>;
}
