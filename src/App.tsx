import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { registerSW } from 'virtual:pwa-register';
import { createLocalRepository } from './localRepository';
import { createCloudRepository, getServices, hasCloudConfig, login, logout } from './firebaseRepository';
import { actionLabels, beginPlay, completePlay, elapsed, formatTime, isShot, localDate, playLabel, sortPlayers, transition, validatePlayer, type Action, type Draft, type Game, type Play, type Player, type Shot } from './domain';
import { readableError, type Repository, type SyncState } from './repository';

const statusLabels = { ready: '開始前', running: '記録中', interval: 'Q間', finished: '終了' };
const draftKey = 'basketball-play-draft';
const viewKey = 'basketball-current-game';

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current!; element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="dialog-head"><h2 id="dialog-title">{title}</h2><button onClick={onClose} aria-label="閉じる">閉じる</button></div>
    {children}
  </dialog>;
}

export default function App() {
  const [repo, setRepo] = useState<Repository | null>(null);
  const [authReady, setAuthReady] = useState(!hasCloudConfig);
  const [error, setError] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const updateWorker = useRef<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (import.meta.env.PROD) updateWorker.current = registerSW({ onNeedRefresh: () => setUpdateAvailable(true) });
  }, []);
  useEffect(() => () => { if (repo?.mode === 'local') void repo.close(); }, [repo]);
  useEffect(() => {
    if (!hasCloudConfig) return;
    let active = true;
    let owned: Repository | null = null;
    let generation = 0;
    const stop = onAuthStateChanged(getServices().auth, user => {
      const current = ++generation;
      void (async () => {
        if (owned) { await owned.close(); owned = null; }
        if (!active) return;
        setRepo(null);
        if (user) {
          try {
            const next = await createCloudRepository(user.uid);
            if (!active || generation !== current) { await next.close(); return; }
            owned = next; setRepo(next);
          } catch (err) { if (active) setError(readableError(err)); }
        }
        if (active) setAuthReady(true);
      })();
    });
    return () => { active = false; stop(); void owned?.close(); };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { await login(passphrase); setPassphrase(''); }
    catch (err) { setError(readableError(err)); }
    finally { setBusy(false); }
  }
  async function startLocal() {
    setBusy(true); setError('');
    try { setRepo(await createLocalRepository()); }
    catch (err) { setError(readableError(err)); }
    finally { setBusy(false); }
  }
  if (!authReady) return <main className="shell"><p role="status">読み込み中…</p></main>;
  if (repo) return <Workspace repo={repo} updateAvailable={updateAvailable} applyUpdate={() => { void updateWorker.current?.(true); }} onLogout={async () => {
    if (repo.mode === 'cloud') { await repo.close(); await logout(); }
    else { await repo.close(); setRepo(null); }
  }} />;
  return <main className="shell login">
    <div className="brand-mark" aria-hidden="true">●</div>
    <p className="eyebrow">バスケ部のための</p><h1>バスケの記録</h1>
    <p className="muted">試合を見ながら、かんたんに記録。</p>
    {hasCloudConfig ? <form onSubmit={submit} className="panel stack">
      <label>部活の合言葉<input autoComplete="current-password" type="password" value={passphrase} onChange={event => setPassphrase(event.target.value)} required /></label>
      <button className="primary" disabled={busy}>{busy ? '確認中…' : '入る'}</button>
      <p className="muted small">合言葉を知っている部員が、同じ記録を閲覧・編集できます。</p>
    </form> : <section className="panel stack">
      <h2>共有の設定を準備中です</h2><p>部内で使い始めるには、管理者による保存先の設定が必要です。</p>
      {import.meta.env.DEV && <><button className="primary" disabled={busy} onClick={() => { void startLocal(); }}>この端末で試す</button><p className="muted small">試用中の記録はこのブラウザだけに保存されます。</p></>}
    </section>}
    {error && <p className="error" role="alert">{error}</p>}
  </main>;
}

function Workspace({ repo, onLogout, updateAvailable, applyUpdate }: { repo: Repository; onLogout: () => Promise<void>; updateAvailable: boolean; applyUpdate: () => void }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [limit, setLimit] = useState(30);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState<'home' | 'players' | 'new' | 'game'>(() => localStorage.getItem(viewKey) ? 'game' : 'home');
  const [gameId, setGameId] = useState<string | null>(() => localStorage.getItem(viewKey));
  const [sync, setSync] = useState<SyncState>({ pending: 0, error: null, fromCache: true });
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const [, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const locked = useRef(false);

  useEffect(() => repo.watchPlayers(setPlayers), [repo]);
  useEffect(() => repo.watchGames(limit, value => { setGames(value); setLoaded(true); }), [repo, limit]);
  useEffect(() => repo.watchSync(setSync), [repo]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const connection = () => setOnline(navigator.onLine);
    const id = window.setInterval(tick, 250);
    window.addEventListener('online', connection); window.addEventListener('offline', connection); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); document.removeEventListener('visibilitychange', tick); };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (sync.pending) { event.preventDefault(); } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [sync.pending]);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (err) { setError(readableError(err)); }
    finally { locked.current = false; setBusy(false); }
  }
  function navigate(next: typeof page) { setPage(next); setError(''); if (next !== 'game') localStorage.removeItem(viewKey); }
  function openGame(id: string) { setGameId(id); localStorage.setItem(viewKey, id); navigate('game'); }
  const game = games.find(g => g.id === gameId);
  const recording = games.some(g => g.status === 'running');

  return <div className="shell">
    <header className="app-header"><button className="brand" onClick={() => navigate('home')}>バスケの記録</button><button className="quiet small" onClick={() => setConfirmLogout(true)}>退出</button></header>
    <div className={`sync-bar ${sync.error ? 'problem' : ''}`} role="status">
      <span>{repo.mode === 'local' ? (sync.pending ? 'この端末に保存中…' : 'この端末だけに保存') : sync.error ? '保存を確認してください' : sync.pending ? `未送信 ${sync.pending}件${online ? '・送信中' : '・通信なし'}` : !online ? '通信なし・端末の記録を表示' : sync.fromCache ? '保存先を確認中…' : 'すべて保存済み'}</span>
      {repo.mode === 'local' && <span className="tag">試用</span>}
    </div>
    {sync.error && <div className="error" role="alert">{sync.error}<p className="small">未送信の入力は端末に残ります。通信や設定を確認してください。</p>{'retry' in repo && <button onClick={() => (repo as Repository & { retry: () => void }).retry()}>再送する</button>}</div>}
    {error && <div className="error" role="alert">{error}<button className="quiet" onClick={() => setError('')}>閉じる</button></div>}
    <main>
      {page === 'home' && <>
        <div className="page-title"><h1>試合の記録</h1><p className="muted">今日の試合も、これまでの試合も。</p></div>
        <div className="home-actions"><button className="primary" onClick={() => navigate('new')}>新しい試合</button><button onClick={() => navigate('players')}>選手登録</button></div>
        <h2 className="section-title">試合一覧</h2>
        {!loaded ? <p role="status">読み込み中…</p> : !games.length ? <section className="empty"><p>まだ試合がありません</p><p className="muted">選手を登録して、最初の試合を始めましょう。</p></section> : <div className="game-list">{[...games].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).map(g => <button key={g.id} className="game-card" onClick={() => openGame(g.id)}>
          <span className="row"><span className="muted small">{g.date.replaceAll('-', '/')}</span><span className={`tag ${g.status === 'running' ? 'active' : ''}`}>{statusLabels[g.status]}</span></span>
          <span className="opponent">対 {g.opponent}</span><span className="muted small">{g.roster.length}人登録{g.quarters.length ? ` / 第${g.quarters.length}Q` : ''}　記録を見る →</span>
        </button>)}</div>}
        {games.length >= limit && <button className="full" onClick={() => setLimit(value => value + 30)}>前の試合をもっと見る</button>}
      </>}
      {page === 'players' && <Players players={players} repo={repo} run={run} busy={busy} back={() => navigate('home')} />}
      {page === 'new' && <NewGame players={players} busy={busy} back={() => navigate('home')} register={() => navigate('players')} create={g => { void run(async () => { await repo.saveGame(g); openGame(g.id); }); }} />}
      {page === 'game' && (game ? <GameScreen key={game.id} game={game} repo={repo} now={Date.now()} busy={busy} run={run} back={() => navigate('home')} /> : <section className="panel stack"><p>{loaded ? 'この試合はまだ読み込まれていません。試合一覧から選び直してください。' : '試合を読み込み中…'}</p><button onClick={() => navigate('home')}>試合一覧へ</button></section>)}
    </main>
    {updateAvailable && !recording && sync.pending === 0 && <aside className="update panel"><p>新しい版があります。</p><button onClick={applyUpdate}>更新する</button></aside>}
    <footer>バスケの記録<span>見る、押す、残す。</span></footer>
    {confirmLogout && <Dialog title="退出しますか？" onClose={() => setConfirmLogout(false)}>
      <p>{sync.pending ? '未送信の記録があります。保存が終わってから退出してください。' : repo.mode === 'local' ? 'この端末に保存した試用データは残ります。' : 'この端末からログアウトします。'}</p>
      <div className="stack"><button disabled={sync.pending > 0 || busy} onClick={() => { void run(onLogout); }}>退出する</button><button className="quiet" onClick={() => setConfirmLogout(false)}>戻る</button></div>
    </Dialog>}
  </div>;
}

type Runner = (action: () => Promise<void>) => Promise<void>;
function Back({ onClick }: { onClick: () => void }) { return <button className="back quiet" onClick={onClick}>← 試合一覧</button>; }

function Players({ players, repo, run, busy, back }: { players: Player[]; repo: Repository; run: Runner; busy: boolean; back: () => void }) {
  const [editing, setEditing] = useState<Player | null>(null);
  const [name, setName] = useState(''); const [number, setNumber] = useState('');
  const input = useRef<HTMLInputElement>(null);
  function reset() { setEditing(null); setName(''); setNumber(''); }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const player = { id: editing?.id ?? crypto.randomUUID(), name: name.trim(), number: number.trim(), active: true };
      validatePlayer(player, players); await repo.savePlayer(player); reset(); input.current?.focus();
    });
  }
  return <><Back onClick={back} /><h1>選手登録</h1><p className="muted">次の試合でも、この名簿から選べます。</p>
    <form className="panel stack" onSubmit={submit}>
      <h2>{editing ? '選手を変更' : '選手を追加'}</h2>
      <div className="player-fields"><label>背番号<input ref={input} inputMode="numeric" maxLength={2} value={number} onChange={e => setNumber(e.target.value)} required placeholder="7" /></label><label>名前<input maxLength={40} value={name} onChange={e => setName(e.target.value)} required placeholder="田中" /></label></div>
      <button className="primary" disabled={busy}>{editing ? '変更を保存' : '選手を追加'}</button>{editing && <button type="button" className="quiet" onClick={reset}>変更をやめる</button>}
    </form>
    <h2 className="section-title">登録選手（{players.filter(p => p.active).length}人）</h2>
    {!players.length && <p className="empty">背番号と名前を登録してください。</p>}
    <div className="roster-list">{sortPlayers(players).map(p => <div key={p.id} className={`roster-row ${!p.active ? 'inactive' : ''}`}>
      <span className="number">{p.number}</span><span className="player-name">{p.name}{!p.active && <small>非表示</small>}</span>
      {p.active && <button className="small" onClick={() => { setEditing(p); setName(p.name); setNumber(p.number); input.current?.focus(); }}>変更</button>}
      <button className="quiet small" disabled={busy} onClick={() => { void run(async () => { const next = { ...p, active: !p.active }; validatePlayer(next, players); await repo.savePlayer(next); }); }}>{p.active ? '非表示' : '戻す'}</button>
    </div>)}</div>
    <p className="muted small">名簿を変更しても、過去の試合の名前・背番号は変わりません。</p>
  </>;
}

function NewGame({ players, busy, back, register, create }: { players: Player[]; busy: boolean; back: () => void; register: () => void; create: (game: Game) => void }) {
  const active = sortPlayers(players.filter(p => p.active));
  const [selected, setSelected] = useState<string[]>(active.map(p => p.id));
  const [opponent, setOpponent] = useState(''); const [date, setDate] = useState(localDate());
  useEffect(() => { setSelected(current => [...new Set([...current, ...active.map(p => p.id)])]); }, [players]); // 名簿の初回取得を反映
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!opponent.trim() || !selected.length) return;
    const now = Date.now();
    create({ id: crypto.randomUUID(), opponent: opponent.trim(), date, roster: active.filter(p => selected.includes(p.id)).map(({ id, name, number }) => ({ id, name, number })), status: 'ready', quarters: [], createdAt: now, updatedAt: now });
  }
  return <><Back onClick={back} /><h1>新しい試合</h1><form onSubmit={submit} className="stack">
    <section className="panel stack"><label>試合日<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label><label>対戦相手<input value={opponent} onChange={e => setOpponent(e.target.value)} maxLength={80} required placeholder="○○中学校" /></label></section>
    <section className="panel"><div className="row"><h2>ベンチ入り選手</h2><span className="muted small">{selected.filter(id => active.some(p => p.id === id)).length}人選択</span></div>
      {!active.length ? <div className="stack"><p>先に選手を登録してください。</p><button type="button" onClick={register}>選手登録へ</button></div> : <>
        <div className="row selection-tools"><button type="button" className="quiet small" onClick={() => setSelected(active.map(p => p.id))}>全員選択</button><button type="button" className="quiet small" onClick={() => setSelected([])}>選択を外す</button></div>
        <div className="check-list">{active.map(p => <label className="check-player" key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /><strong>{p.number}</strong><span>{p.name}</span></label>)}</div>
      </>}
    </section>
    <button className="primary" disabled={busy || !selected.some(id => active.some(p => p.id === id))}>このメンバーで準備する</button>
  </form></>;
}

function readDraft(gameId: string): Draft | null {
  try { const value = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null') as Draft | null; return value?.gameId === gameId ? value : null; } catch { return null; }
}
function GameScreen({ game, repo, now, busy, run, back }: { game: Game; repo: Repository; now: number; busy: boolean; run: Runner; back: () => void }) {
  const [plays, setPlays] = useState<Play[]>([]);
  const [draft, setDraft] = useState<Draft | null>(() => readDraft(game.id));
  const [editing, setEditing] = useState<Play | null>(null);
  const [confirm, setConfirm] = useState<'quarter' | 'finish' | null>(null);
  const [showAll, setShowAll] = useState(game.status === 'finished');
  const captureLock = useRef(false);
  useEffect(() => repo.watchPlays(game.id, setPlays), [repo, game.id]);
  useEffect(() => {
    if (draft) sessionStorage.setItem(draftKey, JSON.stringify(draft)); else sessionStorage.removeItem(draftKey);
  }, [draft]);
  const q = game.quarters.at(-1);
  const visible = plays.filter(p => !p.cancelled).sort((a, b) => a.quarter - b.quarter || a.elapsedMs - b.elapsedMs || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const last = [...visible].sort((a, b) => b.createdAt - a.createdAt).at(0);
  const inconsistentClock = !!q && q.endedAt === null && now < q.startedAt;
  const alreadySaved = draft && plays.some(p => p.id === draft.id);
  useEffect(() => { if (alreadySaved) setDraft(null); }, [alreadySaved]);

  function command(action: Parameters<typeof transition>[1]) {
    void run(async () => { await repo.saveGame(transition(game, action, Date.now())); setConfirm(null); });
  }
  function capture(action: Action) {
    if (draft || busy || captureLock.current) return;
    captureLock.current = true;
    void run(async () => { setDraft(beginPlay(game, action, Date.now())); }).finally(() => { captureLock.current = false; });
  }
  function save(playerId: string, shot: Shot | null) {
    if (!draft) return;
    void run(async () => { await repo.savePlay(completePlay(game, draft, playerId, shot, Date.now())); setDraft(null); });
  }
  const displayPlays = showAll ? visible : visible.slice(-5).reverse();
  return <><Back onClick={back} />
    <div className="game-heading"><p className="muted small">{game.date.replaceAll('-', '/')} <span className="tag">{statusLabels[game.status]}</span></p><h1>対 {game.opponent}</h1></div>
    <section className="clock panel" aria-label="クォーターと経過時間">
      <div className="clock-top"><strong>{q ? `第${q.number}Q` : '試合開始前'}</strong><span className="muted small">{game.status === 'interval' ? 'Q終了' : game.status === 'finished' ? '試合終了' : '開始から'}</span></div>
      <div className="time" role="timer" aria-live="off">{formatTime(elapsed(q, now))}</div>
      {game.status === 'ready' && <button className="primary full" disabled={busy} onClick={() => command('start')}>試合開始</button>}
      {game.status === 'running' && <p className="muted small">プレーが止まっても、そのままでOK</p>}
      {game.status === 'interval' && <div className="stack"><button className="primary" disabled={busy} onClick={() => command('next')}>第{(q?.number ?? 0) + 1}Qを開始</button><button className="quiet small" disabled={busy} onClick={() => command('undoEnd')}>Q終了を取り消す</button></div>}
    </section>
    {inconsistentClock && <p className="error" role="alert">端末の時刻がQ開始時刻より前になっています。端末の時刻を確認してください。</p>}
    {game.status !== 'finished' && <>
      <div className="action-grid">{(Object.keys(actionLabels) as Action[]).map(action => <button key={action} className={`action action-${action}`} disabled={game.status !== 'running' || busy || inconsistentClock} onClick={() => capture(action)}>{actionLabels[action]}</button>)}</div>
      {game.status === 'ready' && <p className="muted small center">試合開始後に記録できます。</p>}
      <section className="last-play panel"><h2>直前の記録</h2>{last ? <><PlayLine play={last} game={game} /><button className="quiet small" disabled={busy} onClick={() => { void run(() => repo.savePlay({ ...last, cancelled: true, updatedAt: Date.now() })); }}>この記録を取り消す</button></> : <p className="muted">まだ記録がありません。</p>}</section>
      <div className="quarter-actions">{game.status === 'running' && <button disabled={busy || !!draft || inconsistentClock} onClick={() => setConfirm('quarter')}>このQを終了</button>}{game.status === 'interval' && <button disabled={busy} onClick={() => setConfirm('finish')}>試合を終了する</button>}</div>
    </>}
    <section className="history"><div className="row"><h2>記録一覧 <span className="muted">{visible.length}件</span></h2>{visible.length > 5 && <button className="quiet small" onClick={() => setShowAll(!showAll)}>{showAll ? '最近の5件' : 'すべて見る'}</button>}</div>
      {!visible.length ? <p className="empty">プレーを記録すると、ここに表示されます。</p> : <ol className="play-list">{displayPlays.map(play => <li key={play.id}><PlayLine play={play} game={game} /><button className="quiet small" onClick={() => setEditing(play)}>訂正</button></li>)}</ol>}
    </section>
    <details className="panel team-details"><summary>この試合の選手（{game.roster.length}人）</summary><p>{sortPlayers(game.roster).map(p => `${p.number} ${p.name}`).join(' / ')}</p></details>
    {draft && !alreadySaved && <Dialog title={draft.playerId && isShot(draft.action) ? 'シュートの種類' : '選手を選ぶ'} onClose={() => setDraft(null)}>
      <div className="draft-summary"><strong>{actionLabels[draft.action]}</strong><span>第{draft.quarter}Q・{formatTime(draft.elapsedMs)}</span></div>
      <p className="muted small">この時刻で記録します。{game.status === 'running' && `現在 ${formatTime(elapsed(q, now))}`}</p>
      {game.status !== 'running' || draft.quarter !== q?.number ? <div className="error">Qの状態が変わっています。閉じてから記録し直してください。</div> : draft.playerId && isShot(draft.action) ? <div className="stack"><p className="selected-player">{game.roster.find(p => p.id === draft.playerId)?.number} {game.roster.find(p => p.id === draft.playerId)?.name}</p>{(['2', '3', 'ft'] as Shot[]).map(shot => <button key={shot} className="shot-choice" disabled={busy} onClick={() => save(draft.playerId!, shot)}>{shot === 'ft' ? 'フリースロー' : `${shot}点`}</button>)}<button className="quiet" onClick={() => setDraft({ ...draft, playerId: undefined })}>選手を選び直す</button></div> : <div className="player-grid">{sortPlayers(game.roster).map(p => <button key={p.id} disabled={busy} className="player-choice" onClick={() => { if (isShot(draft.action)) setDraft({ ...draft, playerId: p.id }); else save(p.id, null); }}><strong>{p.number}</strong><span>{p.name}</span></button>)}</div>}
      <button className="quiet full cancel" onClick={() => setDraft(null)}>記録せず戻る</button>
    </Dialog>}
    {confirm && <Dialog title={confirm === 'quarter' ? `第${q?.number}Qを終了しますか？` : '試合を終了しますか？'} onClose={() => setConfirm(null)}><p>{confirm === 'quarter' ? '時計を止めて、Q間の休憩に入ります。' : '終了後も記録一覧の確認・訂正ができます。'}</p><div className="stack"><button className="primary" disabled={busy} onClick={() => command(confirm === 'quarter' ? 'endQuarter' : 'finish')}>{confirm === 'quarter' ? 'このQを終了する' : '試合を終了する'}</button><button className="quiet" onClick={() => setConfirm(null)}>戻る</button></div></Dialog>}
    {editing && <EditPlay play={editing} game={game} busy={busy} close={() => setEditing(null)} save={play => { void run(async () => { await repo.savePlay(play); setEditing(null); }); }} />}
  </>;
}

function PlayLine({ play, game }: { play: Play; game: Game }) {
  const player = game.roster.find(p => p.id === play.playerId);
  return <div className="play-line"><span className="play-time">第{play.quarter}Q <strong>{formatTime(play.elapsedMs)}</strong></span><span><strong>{player?.number} {player?.name ?? '選手不明'}</strong><span className="play-label">{playLabel(play)}</span></span></div>;
}

function EditPlay({ play, game, busy, close, save }: { play: Play; game: Game; busy: boolean; close: () => void; save: (play: Play) => void }) {
  const [value, setValue] = useState(play);
  const [time, setTime] = useState(formatTime(play.elapsedMs));
  const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{1,4}:[0-5]\d$/.test(time)) { setError('経過時間は「05:32」のように入力してください。'); return; }
    const [minutes, seconds] = time.split(':').map(Number);
    const elapsedMs = (minutes * 60 + seconds) * 1000;
    const quarter = game.quarters.find(q => q.number === value.quarter);
    if (!quarter || elapsedMs > elapsed(quarter, Date.now()) + 999) { setError('そのQの経過時間内で指定してください。'); return; }
    save({ ...value, elapsedMs, shot: isShot(value.action) ? value.shot ?? '2' : null, updatedAt: Date.now() });
  }
  return <Dialog title="記録を訂正" onClose={close}><form onSubmit={submit} className="stack">
    <label>選手<select value={value.playerId} onChange={e => setValue({ ...value, playerId: e.target.value })}>{sortPlayers(game.roster).map(p => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}</select></label>
    <label>プレー<select value={value.action} onChange={e => setValue({ ...value, action: e.target.value as Action })}>{Object.entries(actionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    {isShot(value.action) && <label>シュート<select value={value.shot ?? '2'} onChange={e => setValue({ ...value, shot: e.target.value as Shot })}><option value="2">2点</option><option value="3">3点</option><option value="ft">フリースロー</option></select></label>}
    <div className="two-fields"><label>クォーター<select value={value.quarter} onChange={e => setValue({ ...value, quarter: Number(e.target.value) })}>{game.quarters.map(q => <option key={q.number} value={q.number}>第{q.number}Q</option>)}</select></label><label>開始から<input value={time} onChange={e => setTime(e.target.value)} placeholder="05:32" inputMode="text" required /></label></div>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={busy}>訂正を保存</button><button type="button" className="quiet danger" disabled={busy} onClick={() => save({ ...play, cancelled: true, updatedAt: Date.now() })}>この記録を取り消す</button>
  </form></Dialog>;
}
