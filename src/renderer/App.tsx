import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Clip, DependencyStatus, ExportResult, Progress, StrideAPI } from '../shared/types';
import { sampleRange, selectedFrames, validateFolderName } from '../shared/selection';

declare global { interface Window { stride: StrideAPI } }

const paths: Record<string, ReactNode> = {
  folder: <><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v1"/><path d="M3 7h17l-2 13H3z"/></>,
  film: <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 3v18M17 3v18M3 8h4m-4 8h4M17 8h4m-4 8h4"/></>,
  play: <path d="m8 5 11 7-11 7z"/>,
  pause: <><path d="M8 5v14M16 5v14" strokeWidth="4"/></>,
  back: <><path d="M5 5v14m13-14-9 7 9 7z"/></>,
  next: <><path d="M19 5v14M6 5l9 7-9 7z"/></>,
  export: <><path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  minus: <path d="M5 12h14"/>,
  fit: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></>,
  loop: <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Logo() {
  return <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true"><rect x="1" y="1" width="28" height="28" rx="8" fill="#c6ed8d"/><path d="M8 10h6v6H8zm8 4h6v6h-6z" fill="#1b2516"/><path d="m13 9 5-3v5m-6 9-5 3v-5" stroke="#1b2516" strokeWidth="2"/></svg>;
}
function frameUrl(clip: Clip, frame: number, kind: 'full' | 'thumb' = 'full') {
  return `sprite://${clip.id}/${kind}/${frame}.${kind === 'full' ? 'png' : 'jpg'}`;
}
function cleanError(error: unknown): string {
  return String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 700);
}

function RangeControl({ label, value, min, max, disabled, onChange }: { label: string; value: number; min: number; max: number; disabled: boolean; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (number: number) => {
    const next = Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : value;
    setDraft(String(next));
    onChange(next);
  };
  return <div className="range-control"><div className="field-label"><label>{label}</label><span>FRAME</span></div><div className="range-line"><input aria-label={label} type="number" min={min} max={max} value={draft} disabled={disabled} onChange={e => {
    setDraft(e.target.value);
    const next = e.currentTarget.valueAsNumber;
    if (Number.isInteger(next) && next >= min && next <= max) onChange(next);
  }} onBlur={e => commit(e.currentTarget.valueAsNumber)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><input aria-label={`${label} slider`} type="range" min={min} max={Math.max(min, max)} value={value} disabled={disabled} onChange={e => commit(Number(e.target.value))}/></div></div>;
}

function FrameGrid({ clip, start, end, excluded, current, disabled, onToggle, onInspect }: {
  clip: Clip; start: number; end: number; excluded: ReadonlySet<number>; current: number; disabled: boolean;
  onToggle: (frame: number) => void; onInspect: (frame: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [width, setWidth] = useState(340);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { setHeight(entry.contentRect.height); setWidth(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; setTop(0); }, [clip.id, start]);
  const columns = Math.max(2, Math.floor((width - 24) / 96));
  const rowHeight = 150;
  const rows = Math.ceil((end - start + 1) / columns);
  const first = Math.max(0, Math.floor(top / rowHeight) - 2);
  const last = Math.min(rows, Math.ceil((top + height) / rowHeight) + 2);
  const visible: ReactNode[] = [];
  for (let row = first; row < last; row++) {
    for (let column = 0; column < columns; column++) {
      const frame = start + row * columns + column;
      if (frame > end) break;
      const included = !excluded.has(frame);
      const style: CSSProperties = { top: row * rowHeight, left: `calc(${column * 100 / columns}% + 6px)`, width: `calc(${100 / columns}% - 12px)` };
      visible.push(<div key={frame} className={`frame-card ${included ? 'included' : 'excluded'} ${current === frame ? 'current' : ''}`} style={style}>
        <button className="frame-toggle" aria-label={`${included ? 'Exclude' : 'Include'} frame ${frame}`} aria-pressed={included} disabled={disabled} onClick={() => onToggle(frame)}>
          <div className="thumbnail"><img src={frameUrl(clip, frame, 'thumb')} alt="" loading="lazy"/><span className="frame-index">{String(frame).padStart(3, '0')}</span></div>
          <span className="frame-state"><span className="check-box">{included && <Icon name="check" size={11}/>}</span>{included ? 'KEEP' : 'SKIP'}</span>
        </button>
        <button className="inspect-frame" aria-label={`Inspect frame ${frame}`} title="Inspect without changing selection" disabled={disabled} onClick={() => onInspect(frame)}><Icon name="eye" size={13}/></button>
      </div>);
    }
  }
  return <div className="frame-scroller" ref={scroller} onScroll={e => setTop(e.currentTarget.scrollTop)}><div className="frame-grid" style={{ height: rows * rowHeight }}>{visible}</div></div>;
}

export function App() {
  const [dependencies, setDependencies] = useState<DependencyStatus | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(1);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [fps, setFps] = useState(12);
  const [every, setEvery] = useState(3);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null);
  const [background, setBackground] = useState('dots');
  const [exportName, setExportName] = useState('walk_front');
  const [busy, setBusy] = useState<'import' | 'export' | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [stageSize, setStageSize] = useState({ width: 600, height: 500 });
  const stage = useRef<HTMLDivElement>(null);
  const imageCache = useRef(new Map<number, HTMLImageElement>());
  const operationPending = useRef(false);
  const frames = useMemo(() => selectedFrames(start, end, excluded), [start, end, excluded]);
  const framesRef = useRef(frames);
  framesRef.current = frames;

  useEffect(() => {
    window.stride.dependencies().then(setDependencies).catch(error => setError(cleanError(error)));
    return window.stride.onProgress(setProgress);
  }, []);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { imageCache.current.clear(); }, [clip?.id]);
  useEffect(() => {
    if (!clip || !frames.length) { if (!frames.length) setPlaying(false); return; }
    const index = Math.max(0, frames.indexOf(current));
    const wanted = new Set([current, frames[(index + 1) % frames.length], frames[(index + 2) % frames.length]]);
    for (const key of imageCache.current.keys()) if (!wanted.has(key)) imageCache.current.delete(key);
    for (const frame of wanted) {
      if (!imageCache.current.has(frame)) { const image = new Image(); image.src = frameUrl(clip, frame); imageCache.current.set(frame, image); }
    }
  }, [clip, current, frames]);
  useEffect(() => {
    if (playing && frames.length && !frames.includes(current)) setCurrent(frames[0]);
    else if (current < start || current > end) setCurrent(frames[0] ?? start);
  }, [frames, current, start, end, playing]);
  useEffect(() => {
    if (!playing || framesRef.current.length < 2) return;
    let request = 0;
    let lastTime = performance.now();
    const tick = (now: number) => {
      const elapsed = now - lastTime;
      if (elapsed >= 1000 / fps) {
        const advance = Math.floor(elapsed / (1000 / fps));
        lastTime += advance * (1000 / fps);
        const sequence = framesRef.current;
        if (sequence.length) setCurrent(previous => sequence[(Math.max(0, sequence.indexOf(previous)) + advance) % sequence.length]);
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing, fps, frames.length]);

  const toggle = useCallback((frame: number) => {
    setExcluded(previous => { const next = new Set(previous); if (next.has(frame)) next.delete(frame); else next.add(frame); return next; });
    setExported(null);
  }, []);
  const step = useCallback((direction: number) => {
    setPlaying(false);
    if (!frames.length) return;
    setCurrent(previous => {
      const index = frames.indexOf(previous);
      return frames[(index < 0 ? (direction > 0 ? 0 : frames.length - 1) : (index + direction + frames.length) % frames.length)];
    });
  }, [frames]);
  const togglePlayback = useCallback(() => {
    if (!frames.length || busy || !clip) return;
    if (!playing && !frames.includes(current)) setCurrent(frames[0]);
    setPlaying(previous => !previous);
  }, [frames, busy, clip, playing, current]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, button') || busy || !clip) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); step(-1); }
      if (event.code === 'ArrowRight') { event.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [busy, clip, togglePlayback, step]);

  async function openVideo() {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy('import'); setProgress(null); setError(null); setPlaying(false);
    try {
      const result = await window.stride.openVideo();
      if (result) {
        setClip(result); setStart(1); setEnd(result.frameCount); setExcluded(new Set()); setCurrent(1); setZoom(null); setExported(null);
        setExportName(result.name.replace(/\.mp4$/i, '').replace(/[\\/:\x00-\x1f]/g, '_').slice(0, 80) || 'walk');
        setPlaying(true);
      }
    } catch (error) { const message = cleanError(error); if (message !== 'Cancelled.') setError(message); }
    finally { setBusy(null); setProgress(null); operationPending.current = false; }
  }
  async function exportFrames() {
    if (!clip || !frames.length || operationPending.current) return;
    try { validateFolderName(exportName); } catch (error) { setError(cleanError(error)); return; }
    operationPending.current = true;
    setBusy('export'); setProgress(null); setError(null); setPlaying(false);
    try {
      const result = await window.stride.exportFrames({ clipId: clip.id, frames: [...frames], name: exportName });
      if (result) setExported(result);
    } catch (error) { const message = cleanError(error); if (message !== 'Cancelled.') setError(message); }
    finally { setBusy(null); setProgress(null); operationPending.current = false; }
  }
  function bulk(mode: 'all' | 'none' | 'sample') {
    setExcluded(previous => {
      if (mode === 'sample') return sampleRange(previous, start, end, every);
      const next = new Set(previous);
      for (let frame = start; frame <= end; frame++) { if (mode === 'all') next.delete(frame); else next.add(frame); }
      return next;
    });
    setExported(null);
  }
  const disabled = !clip || busy !== null;
  const actualScale = clip ? zoom ?? Math.min((stageSize.width - 72) / clip.width, (stageSize.height - 86) / clip.height) : 1;
  const rangeCount = clip ? end - start + 1 : 0;
  return <div className="app-shell">
    <header className="app-header"><div className="brand"><Logo/><span>stride<span className="brand-dot">.</span></span><span className="brand-divider"/><span className="brand-description">FRAME STUDIO</span></div><div className="local-badge"><span/>Local by design</div></header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="section-eyebrow">01 <span>SOURCE VIDEO</span></div>
        <button className={`import-button ${clip ? 'has-clip' : ''}`} disabled={busy !== null || dependencies?.ready === false} onClick={openVideo}><span className="import-icon"><Icon name={clip ? 'film' : 'plus'} size={23}/></span><strong>{clip ? 'Replace video' : 'Open an MP4'}</strong><span>{clip ? 'Choose a different clip' : 'Everything stays on your Mac'}</span></button>
        {clip && <div className="source-info"><span className="source-name" title={clip.name}><Icon name="film" size={15}/>{clip.name}</span><span>{clip.width} × {clip.height}<i/> {clip.sourceFps > 0 ? `${clip.sourceFps.toFixed(2).replace(/\.00$/, '')} fps` : 'Variable FPS'}<i/>{clip.duration.toFixed(1)}s</span></div>}
        {dependencies?.ready === false && <div className="dependency-notice"><strong>One-time setup</strong><p>Install FFmpeg in Terminal, then check again.</p><code>brew install ffmpeg</code><button className="text-button" onClick={() => window.stride.dependencies().then(setDependencies).catch(error => setError(cleanError(error)))}>Check again ↗</button></div>}
        <div className="sidebar-section"><div className="section-eyebrow">02 <span>CHOOSE YOUR RANGE</span></div><p className="section-description">Find the beginning and end of one stride.</p>
          <RangeControl label="Start frame" value={start} min={1} max={end} disabled={disabled} onChange={value => { setStart(value); setPlaying(false); setCurrent(value); setExported(null); }}/>
          <RangeControl label="End frame" value={end} min={start} max={clip?.frameCount ?? 1} disabled={disabled} onChange={value => { setEnd(value); setPlaying(false); setCurrent(value); setExported(null); }}/>
          <div className="range-summary"><span className="bracket">[</span><span><strong>{rangeCount}</strong> frames in range</span><span className="bracket">]</span></div>
        </div>
        <div className="sidebar-section selection-section"><div className="section-eyebrow">03 <span>REFINE THE LOOP</span></div><p className="section-description">Start with a sample. Fine-tune on the right.</p><label className="sample-label" htmlFor="every">Keep every Nth frame</label><div className="sample-row"><input id="every" type="number" min="1" max={clip?.frameCount ?? 9999} value={every} disabled={disabled} onChange={e => { const n = e.currentTarget.valueAsNumber; if (Number.isFinite(n)) setEvery(Math.max(1, Math.min(clip?.frameCount ?? 9999, Math.round(n)))); }}/><span>frames</span><button disabled={disabled} onClick={() => bulk('sample')}>Apply</button></div><p className="microcopy">Applies a fresh selection inside your range.</p></div>
        <div className="sidebar-tip"><Icon name="info" size={17}/><p>Pick matching poses at the loop’s start and end. Skip the final frame if it repeats the first.</p></div>
        <div className="sidebar-bottom"><span className="privacy-dot"/>No uploads. No accounts.</div>
      </aside>
      <main className="preview-panel">
        <div className="panel-header"><div><span className="section-eyebrow">LOOP PREVIEW</span><h1>{clip ? 'One step at a time.' : 'A good loop starts here.'}</h1></div><span className="preview-mode"><Icon name="loop" size={14}/>{playing ? 'LOOPING' : 'PAUSED'}</span></div>
        <div className={`preview-stage bg-${background}`} ref={stage}>
          {!clip ? <div className="empty-preview"><div className="empty-illustration"><div className="ghost-frame ghost-left"/><div className="ghost-frame ghost-right"/><div className="hero-frame"><Icon name="film" size={48}/><span className="hero-play"><Icon name="play" size={22}/></span></div><span className="spark spark-one"/><span className="spark spark-two"/></div><span className="eyebrow-accent">FROM VIDEO TO WALK CYCLE</span><h2>Find your next step.</h2><p>A few good frames. A seamless loop.<br/>Open a video to start shaping your animation.</p><button className="primary-button" disabled={busy !== null || dependencies?.ready === false} onClick={openVideo}><Icon name="folder"/>Open video<span className="button-arrow">↗</span></button><span className="empty-caption">MP4 INPUT · PNG OUTPUT · 100% LOCAL</span></div>
          : frames.length === 0 ? <div className="empty-selection"><Icon name="film" size={40}/><h2>No frames selected</h2><p>Keep a frame on the right to bring your loop back.</p><button className="secondary-button" disabled={disabled} onClick={() => bulk('all')}>Keep all in range</button></div>
          : <div className="canvas-scroll"><div className="canvas-sizer" style={{ width: Math.max(stageSize.width, clip.width * actualScale + 72), height: Math.max(stageSize.height, clip.height * actualScale + 86) }}><img className="preview-image" src={frameUrl(clip, current)} alt={`Source frame ${current}`} style={{ width: Math.max(1, clip.width * actualScale), height: Math.max(1, clip.height * actualScale) }}/></div></div>}
          {clip && frames.length > 0 && <div className="stage-caption"><span>FRAME <strong>{String(current).padStart(3, '0')}</strong></span><span>{excluded.has(current) ? 'EXCLUDED · INSPECTING' : `${Math.max(1, frames.indexOf(current) + 1)} / ${frames.length} KEPT`}</span></div>}
          <div className="stage-corner"><span/><span/></div>
        </div>
        <div className="preview-tools"><div className="background-options" aria-label="Preview background">{['dots', 'dark', 'light'].map(value => <button key={value} className={`swatch swatch-${value} ${background === value ? 'active' : ''}`} aria-label={`${value} background`} aria-pressed={background === value} onClick={() => setBackground(value)}/>)}</div><div className="zoom-controls"><button aria-label="Zoom out" disabled={disabled} onClick={() => setZoom(Math.max(0.1, actualScale / 1.25))}><Icon name="minus" size={15}/></button><span>{clip ? `${Math.round(actualScale * 100)}%` : 'FIT'}</span><button aria-label="Zoom in" disabled={disabled} onClick={() => setZoom(Math.min(8, actualScale * 1.25))}><Icon name="plus" size={15}/></button><span className="tool-divider"/><button className={zoom === null ? 'active' : ''} disabled={disabled} onClick={() => setZoom(null)} title="Fit to preview"><Icon name="fit" size={15}/><span>Fit</span></button></div></div>
        <div className="transport"><div className="transport-buttons"><button aria-label="Previous selected frame" disabled={disabled || !frames.length} onClick={() => step(-1)}><Icon name="back" size={17}/></button><button className="play-button" aria-label={playing ? 'Pause loop' : 'Play loop'} disabled={disabled || !frames.length} onClick={togglePlayback}><Icon name={playing ? 'pause' : 'play'} size={19}/></button><button aria-label="Next selected frame" disabled={disabled || !frames.length} onClick={() => step(1)}><Icon name="next" size={17}/></button></div><div className="fps-control"><input aria-label="Playback FPS" type="number" min="1" max="60" value={fps} disabled={busy !== null} onChange={e => { const n = e.currentTarget.valueAsNumber; if (Number.isFinite(n)) setFps(Math.min(60, Math.max(1, Math.round(n)))); }}/><span>FPS</span></div><div className="loop-duration"><Icon name="loop" size={15}/><strong>{clip ? (frames.length / fps).toFixed(2) : '0.00'}s</strong><span>loop</span></div><span className="keyboard-hint"><kbd>space</kbd> play / pause</span></div>
        <div className="preview-footnote"><span>Original canvas. Original pixels.</span><span>Preview speed does not change exported images.</span></div>
      </main>
      <aside className="frames-panel"><div className="frames-heading"><div><span className="section-eyebrow">THE BUILDING BLOCKS</span><h2>Frames <span>{clip ? frames.length : 0}<small> / {rangeCount}</small></span></h2></div><div className="selection-actions"><button disabled={disabled} onClick={() => bulk('all')}>All</button><button disabled={disabled} onClick={() => bulk('none')}>None</button></div></div><div className="frames-instruction"><span className="keep-indicator"/>Click to keep or skip<span className="inspect-hint"><Icon name="eye" size={13}/> to inspect</span></div>
        {clip ? <FrameGrid clip={clip} start={start} end={end} excluded={excluded} current={current} disabled={busy !== null} onToggle={toggle} onInspect={frame => { setPlaying(false); setCurrent(frame); }}/>
        : <div className="empty-frames"><div className="placeholder-grid">{Array.from({ length: 9 }, (_, i) => <div key={i}><span>{String(i + 1).padStart(2, '0')}</span><Icon name="film" size={20}/><i/></div>)}</div><p>Your frames will appear here.</p><span>Keep the moments that make the movement.</span></div>}
        <div className="export-panel"><div className="export-heading"><Icon name="export" size={16}/><span>READY FOR YOUR GAME</span><span className="png-badge">PNG</span></div><label htmlFor="export-name">Export folder name</label><input id="export-name" value={exportName} maxLength={80} placeholder="walk_front" disabled={disabled} onChange={e => { setExportName(e.target.value); setExported(null); }}/><div className="export-summary"><span>{clip ? frames.length : 0} images</span><span>{clip ? `${clip.width} × ${clip.height} px` : 'Original resolution'}</span></div><button className="primary-button export-button" disabled={disabled || !frames.length || !exportName.trim()} onClick={exportFrames}><Icon name="export"/>{busy === 'export' ? 'Exporting…' : 'Export PNGs'}<span>↗</span></button><p>Choose a destination. Get one PNG per kept frame.</p>{exported && <div className="export-success" role="status"><Icon name="check" size={16}/><div><strong>{exported.count} PNGs exported</strong><button className="text-button" title={exported.folder} onClick={() => window.stride.revealExport().catch(error => setError(cleanError(error)))}>Reveal in Finder ↗</button></div></div>}</div>
      </aside>
    </div>
    <footer className="app-footer"><span><span className="status-dot"/>{busy ? (busy === 'import' ? 'Preparing your frames' : 'Writing your PNGs') : clip ? `${clip.frameCount.toLocaleString()} source frames · ready when you are` : 'Your next walk cycle is a few clicks away'}</span><span>STRIDE <span className="version">v0.1</span></span></footer>
    {error && <div className="error-toast" role="alert"><Icon name="info"/><div><strong>Something needs attention</strong><p>{error}</p></div><button aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="close" size={16}/></button></div>}
    {busy && <div className="operation-overlay" role="dialog" aria-modal="true" aria-label={busy === 'import' ? 'Importing video' : 'Exporting PNGs'}><div className="operation-card"><div className="operation-icon"><Icon name={busy === 'import' ? 'film' : 'export'} size={27}/></div><span className="eyebrow-accent">{busy === 'import' ? 'MAKING EVERY FRAME COUNT' : 'YOUR LOOP, FRAME BY FRAME'}</span><h2>{busy === 'import' ? 'Preparing your video' : 'Exporting your frames'}</h2><p>{progress?.message ?? (busy === 'import' ? 'Choose an MP4 in the file picker…' : 'Choose a destination folder…')}</p><div className={`progress-track ${!progress ? 'indeterminate' : ''}`} role="progressbar" aria-label="Operation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress?.fraction ?? 0) * 100)}><div style={{ width: `${Math.max(3, (progress?.fraction ?? 0) * 100)}%` }}/></div>{progress && <button className="secondary-button" onClick={() => window.stride.cancel().catch(error => setError(cleanError(error)))}>Cancel</button>}<span className="operation-note">Your source video stays untouched.</span></div></div>}
  </div>;
}
