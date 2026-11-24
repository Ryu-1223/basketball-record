import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { elapsed, playLabel, periodLabel, type Game, type Play } from './domain';
import { checkedLabels, foulLabels, insertPlay, isToAction, periodSeconds, sheetFor, sideOf, sortPlays, validateSheet, validateToPlay, validNumber, type FoulCode, type SheetInfo, type Side, type ToAction } from './to';

export function SheetFields({ value, change }: { value: SheetInfo; change: (v: SheetInfo) => void }) {
  const fields = [['competition', '大会名'], ['gameNo', '試合番号'], ['venue', '会場'], ['startTime', '開始時刻'], ['endTime', '終了時刻']] as const;
  return <div className="stack"><label>自チームの区分<select value={value.ownSide} onChange={e => change({ ...value, ownSide: e.target.value as 'A' | 'B' })}><option>A</option><option>B</option></select></label><p className="muted small">ホーム側、または組合せ表で先に書かれたチームがAです。</p>
    <label>競技時間<select value={value.quarterMinutes === 8 && value.overtimeMinutes === 3 ? 'junior' : value.quarterMinutes === 10 && value.overtimeMinutes === 5 ? 'senior' : 'custom'} onChange={e => change({ ...value, quarterMinutes: e.target.value === 'senior' ? 10 : e.target.value === 'junior' ? 8 : 9, overtimeMinutes: e.target.value === 'senior' ? 5 : 3 })}><option value="junior">中学：8分／延長3分</option><option value="senior">高校：10分／延長5分</option><option value="custom">任意に設定</option></select></label>
    <div className="two-fields"><label>1Qの長さ（分）<input type="number" min={1} max={60} value={value.quarterMinutes} onChange={e => change({ ...value, quarterMinutes: Number(e.target.value) })} /></label><label>延長の長さ（分）<input type="number" min={1} max={60} value={value.overtimeMinutes} onChange={e => change({ ...value, overtimeMinutes: Number(e.target.value) })} /></label></div><p className="muted small">タイムアウトの記入時刻の換算に使います。アプリの時計は自動停止しません。</p>
    {fields.map(([key, label]) => <label key={key}>{label}<input type={key.endsWith('Time') ? 'time' : 'text'} maxLength={80} value={value[key]} onChange={e => change({ ...value, [key]: e.target.value })} /></label>)}
  </div>;
}
export function SheetSettings({ game, plays, teamName, busy, save, close }: { game: Game; plays: Play[]; teamName: string; busy: boolean; save: (s: SheetInfo) => void; close: () => void }) {
  const [value, setValue] = useState(() => sheetFor(game, plays, teamName));
  const [side, setSide] = useState<Side>('own');
  const [number, setNumber] = useState('');
  const [error, setError] = useState('');
  const team = value[side];
  const setTeam = (next: Partial<typeof team>) => setValue({ ...value, [side]: { ...team, ...next } });
  return <Dialog title="スコアシート情報" onClose={close}><form className="stack" onSubmit={e => { e.preventDefault(); try { validateSheet(value); save(value); } catch (err) { setError((err as Error).message); } }}>
    <p className="small muted">不明な欄は空欄で保存できます。過去の試合にはこの試合専用の情報が保存されます。</p>
    <details><summary>大会・競技時間</summary><SheetFields value={value} change={setValue} /></details>
    <div className="result-tabs">{(['own', 'opponent'] as const).map(s => <button type="button" key={s} aria-pressed={side === s} onClick={() => { setSide(s); setError(''); }}>{s === 'own' ? (game.kind === 'scrimmage' ? value.own.name : '自チーム') : (game.kind === 'scrimmage' ? value.opponent.name : '相手')}</button>)}</div>
    <label>チーム名<input value={team.name} maxLength={80} onChange={e => setTeam({ name: e.target.value })} /></label>
    <p className="small">先発は5人まで、CAPはキャプテンです。名前不明の相手も背番号だけで登録できます。</p>
    {team.players.map((p, i) => <fieldset className="sheet-player" key={p.id}><legend>{p.number}番</legend><label>選手名<input value={p.name} maxLength={40} onChange={e => setTeam({ players: team.players.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} /></label><label>ライセンス下3桁<input inputMode="numeric" maxLength={3} pattern="[0-9]{3}" value={p.license} onChange={e => setTeam({ players: team.players.map((x, j) => j === i ? { ...x, license: e.target.value } : x) })} /></label><div className="row"><label className="inline-check"><input type="checkbox" checked={p.starter} onChange={e => setTeam({ players: team.players.map((x, j) => j === i ? { ...x, starter: e.target.checked } : x) })} />先発</label><label className="inline-check"><input type="checkbox" checked={p.captain} onChange={e => setTeam({ players: team.players.map((x, j) => j === i ? { ...x, captain: e.target.checked } : x) })} />CAP</label></div></fieldset>)}
    {side === 'opponent' && <div className="stack"><label>追加する背番号<input inputMode="numeric" maxLength={2} value={number} onChange={e => setNumber(e.target.value)} /></label><button type="button" onClick={() => { if (!validNumber(number) || team.players.some(p => p.number === number)) { setError('背番号は0〜99または00で、登録済みの番号とは別にしてください。'); return; } setTeam({ players: [...team.players, { id: number, number, name: '', license: '', captain: false, starter: false }] }); setNumber(''); setError(''); }}>相手選手を追加</button></div>}
    {([['coach', 'ヘッドコーチ'], ['assistant', 'アシスタントコーチ'], ['coachLicense', 'コーチのライセンス下3桁'], ['assistantLicense', 'A.コーチのライセンス下3桁']] as const).map(([key, label]) => <label key={key}>{label}<input value={team[key]} maxLength={key.endsWith('License') ? 3 : 40} onChange={e => setTeam({ [key]: e.target.value })} /></label>)}
    <fieldset className="stack"><legend>このチームの記録確認</legend><p className="small muted">全件を記録・確認した項目だけチェックしてください。未確認の空欄は「発生なし」とせず、締め線を引きません。</p>{Object.entries(checkedLabels).map(([key, label]) => <label className="inline-check" key={key}><input type="checkbox" checked={team.checked[key as keyof typeof team.checked]} onChange={e => setTeam({ checked: { ...team.checked, [key]: e.target.checked } })} />{label}を確認済み</label>)}</fieldset>
    <details><summary>審判・TO担当者</summary><div className="stack">{([['chief', 'クルーチーフ'], ['umpire1', 'アンパイア1'], ['umpire2', 'アンパイア2'], ['scorer', 'スコアラー'], ['assistantScorer', 'A.スコアラー'], ['timer', 'タイマー'], ['shotClock', 'ショットクロック']] as const).map(([key, label]) => <label key={key}>{label}<input value={value.officials[key]} maxLength={40} onChange={e => setValue({ ...value, officials: { ...value.officials, [key]: e.target.value } })} /></label>)}</div></details>
    {error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy}>スコアシート情報を保存</button>
  </form></Dialog>;
}

export function ToEditor({ game, plays, action, initial, busy, save, close }: { game: Game; plays: Play[]; action: ToAction; initial?: Play; busy: boolean; save: (p: Play) => void; close: () => void }) {
  const storageKey = `basketball-to-draft:${game.id}:${action}`;
  const [value, setValue] = useState<Play>(() => initial ?? (() => { try { const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'); if (saved?.value?.gameId === game.id && saved.value.action === action) return saved.value as Play; } catch { /* ignore damaged draft */ } return undefined; })() ?? { id: crypto.randomUUID(), gameId: game.id, quarter: Math.max(1, game.quarters.length + (action === 'foul' && game.status === 'interval' ? 1 : 0)), elapsedMs: elapsed(game.quarters.at(-1), Date.now()), playerId: action === 'timeout' ? '@team' : '', action, shot: null, createdAt: Date.now(), updatedAt: Date.now(), cancelled: false, details: action === 'foul' ? { code: 'P', penalty: '', countsTeam: true, note: '' } : action === 'timeout' ? { remainingSec: null } : {} });
  const [remaining, setRemaining] = useState(() => !initial ? (() => { try { return JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')?.remaining ?? ''; } catch { return ''; } })() : initial?.details?.remainingSec != null ? `${Math.floor(initial.details.remainingSec / 60)}:${String(initial.details.remainingSec % 60).padStart(2, '0')}` : '');
  const [error, setError] = useState('');
  useEffect(() => { if (!initial) sessionStorage.setItem(storageKey, JSON.stringify({ value, remaining })); }, [initial, storageKey, value, remaining]);
  const dismiss = () => { if (!initial) sessionStorage.removeItem(storageKey); close(); };
  const side = sideOf(value), sheet = sheetFor(game, plays), team = sheet[side];
  const update = (next: Partial<Play>) => setValue({ ...value, ...next });
  const detail = (next: Partial<NonNullable<Play['details']>>) => update({ details: { ...value.details, ...next } });
  const maxQuarter = Math.max(1, game.quarters.length + (action === 'foul' && ['ready', 'interval'].includes(game.status) ? 1 : 0));
  function submit() {
    try {
      let next = { ...value, updatedAt: Date.now() };
      if (action === 'timeout') {
        if (remaining && !/^\d{1,2}:[0-5]\d$/.test(remaining)) throw new Error('残り時間は「03:44」の形式で入力してください。');
        const [m, s] = remaining.split(':').map(Number);
        next = { ...next, details: { remainingSec: remaining ? m * 60 + s : null } };
      }
      validateToPlay(game, next);
      if (action === 'entry' && plays.some(p => p.id !== next.id && !p.cancelled && p.action === 'entry' && sideOf(p) === side && p.playerId === next.playerId)) throw new Error('この選手の初出場は記録済みです。既存の記録を訂正してください。');
      save(next);
    } catch (err) { setError((err as Error).message); }
  }
  return <Dialog title={action === 'foul' ? 'ファウルを記録' : action === 'timeout' ? 'タイムアウトを記録' : '初出場を記録'} onClose={dismiss}><form className="stack" onSubmit={e => { e.preventDefault(); submit(); }}>
    <label>チーム<select value={side} onChange={e => { const next = { ...value }; if (e.target.value === 'opponent') next.side = 'opponent'; else delete next.side; next.playerId = action === 'timeout' ? '@team' : ''; setValue(next); }}><option value="own">{game.kind === "scrimmage" ? sheetFor(game, plays).own.name : "自チーム"}</option><option value="opponent">{game.kind === "scrimmage" ? sheetFor(game, plays).opponent.name : "相手"}</option></select></label>
    <label>記録するQ<select value={value.quarter} onChange={e => update({ quarter: Number(e.target.value) })}>{Array.from({ length: maxQuarter }, (_, i) => <option key={i} value={i + 1}>{periodLabel(game, i + 1)}</option>)}</select></label>
    {action === 'foul' && game.status === 'interval' && <p className="small muted">Q間のファウルは次のQに記録します。延長は第4Qのチームファウルに加算します。</p>}
    {action !== 'timeout' && <><label>対象<select value={value.playerId} onChange={e => { const id = e.target.value; update({ playerId: id, ...(action === 'foul' ? { details: { ...value.details, code: id === '@coach' ? 'C' : id === '@assistant' ? 'D' : 'P', countsTeam: !id.startsWith('@') } } : {}) }); }}><option value="">選んでください</option>{team.players.map(p => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}{action === 'foul' && <><option value="@coach">ヘッドコーチ</option><option value="@assistant">アシスタントコーチ</option></>}</select></label>{side === 'opponent' && <label>未登録なら背番号を入力<input inputMode="numeric" maxLength={2} value={validNumber(value.playerId) ? value.playerId : ''} onChange={e => update({ playerId: e.target.value, ...(action === 'foul' ? { details: { ...value.details, code: 'P', countsTeam: true } } : {}) })} /></label>}</>}
    {action === 'foul' && <><label>種類<select value={value.details?.code ?? 'P'} onChange={e => detail({ code: e.target.value as FoulCode, countsTeam: !value.playerId.startsWith('@') && ['P', 'T', 'U', 'D'].includes(e.target.value) })}>{Object.entries(foulLabels).filter(([c]) => value.playerId === '@coach' ? ['B', 'C', 'D', 'F', 'M', 'GD'].includes(c) : value.playerId === '@assistant' ? ['D', 'F', 'GD'].includes(c) : ['P', 'T', 'U', 'D', 'F', 'GD'].includes(c)).map(([c, label]) => <option key={c} value={c}>{label}</option>)}</select></label><label>フリースローの付記<select value={value.details?.penalty ?? ''} onChange={e => detail({ penalty: e.target.value as NonNullable<Play['details']>['penalty'] })}><option value="">なし</option><option value="1">1本</option><option value="2">2本</option><option value="3">3本</option><option value="c">相殺（c）</option></select></label><details><summary>特殊なケース・補足</summary><label className="inline-check"><input type="checkbox" disabled={value.playerId.startsWith('@')} checked={!!value.details?.countsTeam} onChange={e => detail({ countsTeam: e.target.checked })} />チームファウルに数える</label><label>補足（別紙に記載）<input maxLength={120} value={value.details?.note ?? ''} onChange={e => detail({ note: e.target.value })} /></label><p className="small muted">T/Uの累積やコーチの累積によるGDは自動記入します。特殊な退場は審判の判定に合わせて記号と補足を記録してください。</p></details></>}
    {action === 'timeout' && <><label>会場の時計の残り時間<input inputMode="text" placeholder="03:44" value={remaining} onChange={e => setRemaining(e.target.value)} /></label><p className="small muted">このQは{periodSeconds(sheet, value.quarter) / 60}分。アプリの経過時間ではなく、会場の時計を見て入力してください。不明なら空欄で保存できます。</p></>}
    {action === 'entry' && <p className="small muted">初めて試合に出たときだけ記録します。先発は「スコアシート情報」で設定してください。</p>}
    {error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy}>記録を保存</button>{initial && <button type="button" disabled={busy} onClick={() => save({ ...value, cancelled: true, updatedAt: Date.now() })}>この記録を取り消す</button>}
  </form></Dialog>;
}

export function RetroPlay({ game, plays, busy, save, close }: { game: Game; plays: Play[]; busy: boolean; save: (p: Play[]) => void; close: () => void }) {
  const [side, setSide] = useState<Side>('own');
  const [action, setAction] = useState<Play['action']>('made');
  const [quarter, setQuarter] = useState(1);
  const [playerId, setPlayerId] = useState(game.roster[0]?.id ?? '');
  const [shot, setShot] = useState<'2' | '3' | 'ft'>('2');
  const [before, setBefore] = useState('');
  const [error, setError] = useState('');
  const id = useState(() => crypto.randomUUID())[0];
  if (isToAction(action)) return <ToEditor game={game} plays={plays} action={action} busy={busy} close={close} save={p => { sessionStorage.removeItem(`basketball-to-draft:${game.id}:${p.action}`); save(insertPlay(plays, p)); }} />;
  return <Dialog title="記録漏れを追加" onClose={close}><form className="stack" onSubmit={e => { e.preventDefault(); if (!(side === 'own' ? game.roster.some(p => p.id === playerId) : validNumber(playerId))) { setError('選手・背番号を確認してください。'); return; } const list = sortPlays(plays.filter(p => !p.cancelled && p.quarter === quarter)); const index = before ? list.findIndex(p => p.id === before) : list.length; const prior = list[index - 1]; const now = Date.now(); save(insertPlay(plays, { id, gameId: game.id, quarter, elapsedMs: prior?.elapsedMs ?? 0, playerId, action, shot: action === 'made' || action === 'miss' ? shot : null, createdAt: now, updatedAt: now, cancelled: false, ...(side === 'opponent' ? { side: 'opponent' as const } : {}) }, before)); }}>
    <label>プレー<select value={action} onChange={e => setAction(e.target.value as Play['action'])}><option value="made">シュート決</option>{side === 'own' && <><option value="miss">シュート外</option><option value="rebound">リバウンド</option><option value="steal">パスカット</option></>}<option value="foul">ファウル</option><option value="timeout">タイムアウト</option><option value="entry">初出場</option></select></label>
    <label>チーム<select value={side} onChange={e => { setSide(e.target.value as Side); setPlayerId(''); setAction('made'); }}><option value="own">{game.kind === "scrimmage" ? sheetFor(game, plays).own.name : "自チーム"}</option><option value="opponent">{game.kind === "scrimmage" ? sheetFor(game, plays).opponent.name : "相手"}</option></select></label>
    {side === 'own' ? <label>選手<select value={playerId} onChange={e => setPlayerId(e.target.value)}><option value="">選んでください</option>{game.roster.map(p => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}</select></label> : <label>相手の背番号<input inputMode="numeric" value={playerId} maxLength={2} onChange={e => setPlayerId(e.target.value)} /></label>}
    {(action === 'made' || action === 'miss') && <label>シュート<select value={shot} onChange={e => setShot(e.target.value as typeof shot)}><option value="2">2点</option><option value="3">3点</option><option value="ft">フリースロー</option></select></label>}
    <label>Q<select value={quarter} onChange={e => { setQuarter(Number(e.target.value)); setBefore(''); }}>{game.quarters.map(q => <option key={q.number} value={q.number}>{periodLabel(game, q.number)}</option>)}</select></label><label>挿入する位置<select value={before} onChange={e => setBefore(e.target.value)}><option value="">このQの最後</option>{sortPlays(plays.filter(p => !p.cancelled && p.quarter === quarter)).map((p, i) => <option key={p.id} value={p.id}>{i + 1}件目の前（{sideOf(p) === 'own' ? '自' : '相手'} {p.side === 'opponent' ? p.playerId : game.roster.find(x => x.id === p.playerId)?.number ?? ''} / {playLabel(p)}）</option>)}</select></label>
    {error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy || !game.quarters.length}>追加する</button>
  </form></Dialog>;
}
