import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Hand, Layers, PersonStanding, Wind, ClipboardCheck, X, Upload, Loader2, Star, Sparkles } from 'lucide-react';
import { MyraaCharacter } from '../../character/MyraaCharacter';
import type { CharacterSystem } from '../../character/core/CharacterSystem';
import { listAllCharacters, isBuiltInCharacter, type CharacterListing } from '../../character/config/registry';
import type { CharacterProfile } from '@/shared/character/profile';
import { studioApi, physicsFromSettings, type AppSettingsLite } from './studioApi';
import { runCharacterTests } from '../../character/testing/CharacterTests';
import { PosePanel } from './PosePanel';
import { FingerPanel } from './FingerPanel';
import { BonesPanel } from './BonesPanel';
import { PhysicsPanel } from './PhysicsPanel';
import { ReportPanel } from './ReportPanel';
export function useEditorVersion(system: CharacterSystem | null): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const editor = system?.poseEditor;
    if (!editor) return;
    let raf = 0;
    const unsubscribe = editor.subscribe(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setVersion((v) => v + 1);
      });
    });
    return () => {
      unsubscribe();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [system]);
  return version;
}

type Tab = 'pose' | 'fingers' | 'bones' | 'physics' | 'report';

export interface CharacterStudioProps {
  initialCharacterId?: string;
  onClose?: () => void;
  onActiveCharacterChange?: (id: string) => void;
}

const TABS: Array<[Tab, string, React.ReactNode, string]> = [
  ['pose', 'Pose', <PersonStanding key="p" size={16} />, 'Pose, IK, seats, saved poses'],
  ['fingers', 'Fingers', <Hand key="f" size={16} />, 'Individual finger control'],
  ['bones', 'Bones', <Layers key="b" size={16} />, 'Bone map & constraints'],
  ['physics', 'Physics', <Wind key="w" size={16} />, 'Hair, cloth, springs'],
  ['report', 'Report', <ClipboardCheck key="r" size={16} />, 'Compatibility & tests'],
];

export const CharacterStudio: React.FC<CharacterStudioProps> = ({ initialCharacterId, onClose, onActiveCharacterChange }) => {
  const [characters, setCharacters] = useState<CharacterListing[]>([]);
  const [characterId, setCharacterId] = useState<string | undefined>(initialCharacterId);
  const [system, setSystem] = useState<CharacterSystem | null>(null);
  const [profile, setProfile] = useState<CharacterProfile | null>(null);
  const [settings, setSettings] = useState<AppSettingsLite | null>(null);
  const [tab, setTab] = useState<Tab>('pose');
  const [gizmos, setGizmos] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [importPath, setImportPath] = useState('');
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hover, setHover] = useState<{ label: string; x: number; y: number } | null>(null);
  const version = useEditorVersion(system);
  const pointer = useRef<{ x: number; y: number; button: number; moved: boolean; grabbed: boolean; cloth?: boolean } | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);
  const lastHover = useRef(0);

  const refreshList = useCallback(async () => {
    const list = await listAllCharacters();
    setCharacters(list);
    return list;
  }, []);

  useEffect(() => {
    void refreshList().then((list) => {
      if (!characterId && list.length) setCharacterId(list[0].id);
    });
    studioApi.settings().then(setSettings).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setProfile(null);
    if (!characterId || isBuiltInCharacter(characterId)) return;
    studioApi.profile(characterId).then(setProfile).catch((error) => setMessage(error.message));
  }, [characterId]);

  useEffect(() => {
    if (!system || !settings) return;
    system.setPhysicsSettings(physicsFromSettings(settings.physics));
    system.setPhysicsDebug(settings.developer?.physicsDebug ?? false);
  }, [system, settings]);

  useEffect(() => {
    system?.poseEditor?.setEnabled(true);
    system?.poseEditor?.setGizmoAllowed(gizmos);
  }, [system, gizmos]);

  useEffect(() => {
    if (system) system.frameFullBody();
  }, [system]);

  useEffect(() => {
    if (!system) return;
    const held = new Set<string>();
    let raf = 0;
    let last = performance.now();
    const step = () => {
      raf = requestAnimationFrame(step);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (held.size === 0) return;
      const h = system.worldHeight;
      const fast = held.has('shift') ? 2.2 : 1;
      let yaw = 0, pitch = 0, zoom = 0, panX = 0, panY = 0;
      if (held.has('a')) yaw -= 1.8 * dt * fast;
      if (held.has('d')) yaw += 1.8 * dt * fast;
      if (held.has('w')) pitch += 1.1 * dt * fast;
      if (held.has('s')) pitch -= 1.1 * dt * fast;
      if (held.has('q')) zoom -= h * 0.9 * dt * fast;
      if (held.has('e')) zoom += h * 0.9 * dt * fast;
      if (held.has('r')) panY += h * 0.5 * dt * fast;
      if (held.has('f')) panY -= h * 0.5 * dt * fast;
      if (held.has('z')) panX -= h * 0.5 * dt * fast;
      if (held.has('c')) panX += h * 0.5 * dt * fast;
      if (yaw || pitch) system.orbitBy(yaw, pitch);
      if (zoom) system.zoomBy(zoom);
      if (panX || panY) system.panBy(panX, panY);
    };
    raf = requestAnimationFrame(step);
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'home') { system.frameFullBody(); system.setView('front'); return; }
      if ('wasdqerfzc'.includes(key) || key === 'shift') { held.add(key); e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
    const blur = () => held.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [system]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __studio?: unknown }).__studio = { system, characterId, select: (id: string) => setCharacterId(id) };
  }, [system, characterId]);

  const doImport = async (source?: string) => {
    const path = (source ?? importPath).trim();
    if (!path) return;
    setImporting(true);
    setMessage(`Importing ${path}…`);
    try {
      const result = await studioApi.importSource(path);
      await refreshList();
      setCharacterId(result.profile.id);
      const issues = result.profile.report.items.filter((i) => i.status !== 'supported').length;
      setMessage(`${result.replaced ? 'Updated' : 'Imported'} ${result.profile.displayName}. ${issues ? `${issues} capability notes — see Report.` : 'All capabilities supported.'}${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`);
      setImportPath('');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const browse = async () => {
    const bridge = (window as unknown as { myraa?: { pickCharacterSource?: () => Promise<string | null> } }).myraa;
    if (!bridge?.pickCharacterSource) {
      setMessage('Paste the full path of a .zip, folder, .pmx, .vrm, .glb or .gltf file (the file picker is available in the desktop app).');
      return;
    }
    const picked = await bridge.pickCharacterSource();
    if (picked) { setImportPath(picked); void doImport(picked); }
  };

  const makeActive = async () => {
    if (!characterId) return;
    try {
      const next = await studioApi.patchSettings({ character: { activeCharacterId: characterId } });
      setSettings(next);
      onActiveCharacterChange?.(characterId);
      setMessage(`${characters.find((c) => c.id === characterId)?.displayName ?? characterId} is now HASU's character.`);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const ndc = (event: { clientX: number; clientY: number }) => {
    const rect = viewport.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * 2 - 1, y: -(((event.clientY - rect.top) / rect.height) * 2 - 1) };
  };
  const onPointerDown = (event: React.PointerEvent) => {
    const editor = system?.poseEditor;
    let grabbed = false;
    if (event.button === 0 && event.shiftKey && system) {
      const { x, y } = ndc(event);
      if (system.grabClothAt(x, y)) {
        pointer.current = { x: event.clientX, y: event.clientY, button: event.button, moved: false, grabbed: false, cloth: true };
        (event.target as Element).setPointerCapture?.(event.pointerId);
        return;
      }
    }
    if (event.button === 0 && editor && !gizmos) {
      const { x, y } = ndc(event);
      grabbed = !!editor.beginGrab(x, y);
      if (grabbed) setHover(null);
    }
    pointer.current = { x: event.clientX, y: event.clientY, button: event.button, moved: false, grabbed };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const p = pointer.current;
    const editor = system?.poseEditor;
    if (!system) return;
    if (!p) {
      if (!editor || gizmos) return;
      const now = performance.now();
      if (now - lastHover.current < 120) return;
      lastHover.current = now;
      const { x, y } = ndc(event);
      const info = editor.partAt(x, y);
      editor.setHover(info);
      const rect = viewport.current!.getBoundingClientRect();
      setHover(info ? { label: info.label, x: event.clientX - rect.left, y: event.clientY - rect.top } : null);
      return;
    }
    if (p.cloth) { const { x, y } = ndc(event); system.dragClothTo(x, y); return; }
    const dx = event.clientX - p.x;
    const dy = event.clientY - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
    if (p.grabbed && editor) { const { x, y } = ndc(event); editor.dragTo(x, y); return; }
    if (p.button === 1) system.panBy(-dx * system.worldHeight * 0.0016, dy * system.worldHeight * 0.0016);
    else if (p.button === 2 || p.button === 0) system.orbitBy(dx * 0.008, dy * 0.006);
    p.x = event.clientX;
    p.y = event.clientY;
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const p = pointer.current;
    pointer.current = null;
    if (p?.cloth) { system?.releaseCloth(); return; }
    const editor = system?.poseEditor;
    if (p?.grabbed) { editor?.endGrab(); return; }
    if (!p || !editor || !gizmos || p.button !== 0 || p.moved || editor.isDragging) return;
    const { x, y } = ndc(event);
    const handle = editor.pickHandle(x, y);
    if (handle) { editor.selectHandle(handle); return; }
    const bone = editor.pick(x, y);
    if (bone) editor.select(bone);
  };
  const onDoubleClick = (event: React.MouseEvent) => {
    const editor = system?.poseEditor;
    if (!editor) return;
    const { x, y } = ndc(event);
    const info = editor.partAt(x, y);
    if (info) editor.resetBone(info.bone);
  };
  const onWheel = (event: React.WheelEvent) => system?.zoomBy(event.deltaY * 0.01 * (system.worldHeight / 20));

  const active = characters.find((c) => c.id === characterId);
  const isActiveCompanion = settings?.character.activeCharacterId === characterId;
  const panel = useMemo(() => {
    if (!system?.poseEditor) return <div className="p-6 text-sm text-slate-500">Loading character…</div>;
    switch (tab) {
      case 'pose': return <PosePanel system={system} characterId={characterId!} version={version} />;
      case 'fingers': return <FingerPanel system={system} version={version} />;
      case 'bones': return <BonesPanel system={system} version={version} />;
      case 'physics': return <PhysicsPanel system={system} profile={profile} settings={settings} onSettings={setSettings} onProfile={(p) => setProfile(p)} onReload={() => setReloadKey((k) => k + 1)} />;
      case 'report': return <ReportPanel system={system} characterId={characterId!} profile={profile} onProfile={(p) => { setProfile(p); void refreshList(); }} onDeleted={async () => { const list = await refreshList(); setCharacterId(list[0]?.id); }} />;
    }
  }, [system, tab, version, profile, settings, characterId, refreshList]);

  return (
    <div className="fixed inset-0 z-[80] flex bg-[#05050a] text-slate-200">
      {/* ---- left rail: library + import ---- */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-white/8 bg-gradient-to-b from-slate-950/80 to-slate-950">
        <div className="flex items-center gap-3 border-b border-white/8 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-indigo-500/20 ring-1 ring-cyan-400/30">
            <Boxes size={17} className="text-cyan-300" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-wide text-white">Character Studio</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Local library</span>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close studio" className="ml-auto rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white">
              <X size={16} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {characters.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-slate-500">
              No characters yet. Import one below.
            </div>
          )}
          {characters.map((c) => {
            const selected = c.id === characterId;
            const active = settings?.character.activeCharacterId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCharacterId(c.id)}
                className={`group mb-1.5 w-full rounded-xl border px-3 py-2.5 text-left transition-all duration-200 ${
                  selected
                    ? 'border-cyan-400/40 bg-gradient-to-r from-cyan-500/10 to-indigo-500/5 shadow-[0_0_24px_-12px_rgba(34,211,238,0.4)]'
                    : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${selected ? 'text-white' : 'text-slate-200'}`}>{c.displayName}</span>
                  {active && <Star size={11} className="text-amber-300" fill="currentColor" />}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
                  <span>{c.source === 'built-in' ? 'built-in' : 'local'}</span>
                  {c.summary && (
                    <>
                      <span className="text-slate-600">·</span>
                      <span className="text-emerald-400/80">{c.summary.supported}✓</span>
                      {c.summary.partial > 0 && <span className="text-amber-400/80">{c.summary.partial}⚠</span>}
                      {c.summary.unsupported > 0 && <span className="text-rose-400/80">{c.summary.unsupported}✗</span>}
                      {(c.summary.testsPassed || c.summary.testsFailed) > 0 && (
                        <span className="text-slate-500">· tests {c.summary.testsPassed}/{c.summary.testsPassed + c.summary.testsFailed}</span>
                      )}
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="space-y-2.5 border-t border-white/8 bg-slate-950/60 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Import local model</div>
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/60 px-2.5 py-1.5 focus-within:border-cyan-400/40">
            <Upload size={12} className="shrink-0 text-slate-500" />
            <input
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doImport()}
              placeholder="C:\Users\…\model.zip"
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600"
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={browse} className="flex-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/5">
              Browse…
            </button>
            <button
              type="button"
              disabled={importing || !importPath.trim()}
              onClick={() => doImport()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-500 px-2 py-1.5 text-xs font-medium text-white shadow-[0_0_20px_-8px_rgba(34,211,238,0.5)] transition hover:brightness-110 disabled:opacity-40"
            >
              {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Import
            </button>
          </div>
          <p className="text-[10px] leading-snug text-slate-600">Imported models stay in your local HASU data folder and are never bundled or uploaded.</p>
        </div>
      </aside>

      {/* ---- centre: live viewport ---- */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-white/8 bg-slate-950/40 px-4 py-2.5 backdrop-blur">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-cyan-300" />
            <span className="text-sm font-medium text-white">{active?.displayName ?? '—'}</span>
            {active && <span className="text-[10px] uppercase tracking-wider text-slate-500">{active.source === 'built-in' ? 'built-in' : 'local import'}</span>}
          </div>

          <div className="ml-2 flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <input type="checkbox" checked={gizmos} onChange={(e) => setGizmos(e.target.checked)} className="accent-cyan-400" /> Precise gizmos
            </label>
            <select
              key={characterId}
              onChange={(e) => {
                if (!system) return;
                if (e.target.value === 'full') return system.frameFullBody();
                const [slot, factor] = e.target.value.split('|');
                const bone = system.rig?.humanoid[slot]?.bone ?? null;
                system.stage.clearPan();
                system.setCameraFocus(bone, Number(factor) * system.worldHeight);
              }}
              className="rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-cyan-400/40"
              defaultValue="full"
            >
              <option value="full">View: full body</option>
              <option value="UPPER_CHEST|1.2">View: upper body</option>
              <option value="HEAD|0.55">View: face</option>
              <option value="LEFT_HAND|0.32">View: left hand</option>
              <option value="RIGHT_HAND|0.32">View: right hand</option>
              <option value="LEFT_FOOT|0.6">View: feet</option>
            </select>
          </div>

          <span className="hidden truncate text-[11px] text-slate-500 lg:inline">
            {gizmos ? 'Click a bone or handle, then drag the gizmo' : 'Drag any body part to pose · double-click resets it'} · WASD orbit · Q/E zoom · R/F up/down · Z/C left/right · Home reset
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={!characterId || isActiveCompanion}
              onClick={makeActive}
              className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-500/20 disabled:opacity-40"
            >
              {isActiveCompanion ? 'Active character' : 'Use as HASU'}
            </button>
            {onClose && (
              <button type="button" onClick={onClose} aria-label="Close studio" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white">
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div
          ref={viewport}
          className="relative flex-1 bg-gradient-to-b from-slate-950/40 to-black"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
          onPointerLeave={() => {
            if (!pointer.current) { setHover(null); system?.poseEditor?.setHover(null); }
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {hover && (
            <div
              className="pointer-events-none absolute z-10 rounded-lg border border-cyan-400/30 bg-slate-950/90 px-2.5 py-1.5 text-[11px] text-cyan-100 shadow-xl backdrop-blur"
              style={{ left: hover.x + 14, top: hover.y + 14 }}
            >
              {hover.label}
            </div>
          )}
          {characterId && (
            <MyraaCharacter
              clothInteraction={false}
              key={`${characterId}:${reloadKey}`}
              characterId={characterId}
              activity="idle"
              emotion="idle"
              outputAnalyser={null}
              inputAnalyser={null}
              controlsEnabled={false}
              showControlHint={false}
              onSystem={setSystem}
            />
          )}
        </div>

        {message && (
          <div className="absolute bottom-4 left-1/2 max-w-xl -translate-x-1/2 rounded-xl border border-white/10 bg-slate-900/95 px-4 py-2.5 text-xs text-slate-300 shadow-2xl backdrop-blur">
            {message}
            <button type="button" className="ml-3 text-slate-500 hover:text-slate-300" onClick={() => setMessage(null)}>
              dismiss
            </button>
          </div>
        )}
      </main>

      {/* ---- right rail: tabs ---- */}
      <aside className="flex w-[380px] shrink-0 flex-col border-l border-white/8 bg-slate-950/60">
        <nav className="flex border-b border-white/8">
          {TABS.map(([id, label, icon, hint]) => (
            <button
              type="button"
              key={id}
              onClick={() => setTab(id)}
              title={hint}
              className={`group relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] uppercase tracking-wider transition ${
                tab === id ? 'bg-white/5 text-cyan-200' : 'text-slate-500 hover:bg-white/[0.03] hover:text-slate-300'
              }`}
            >
              {icon}
              {label}
              {tab === id && <span className="absolute inset-x-3 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto">{panel}</div>
      </aside>
    </div>
  );
};

export default CharacterStudio;