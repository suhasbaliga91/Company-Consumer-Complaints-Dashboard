import { useMemo, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';

interface Props { cases: Case[] }

// OEM's perspective: Dismissed/Ex-parte = won; Allowed/Partially Allowed = lost
const OEM_WON_OUTCOMES  = new Set(['Dismissed', 'Ex-parte']);
const OEM_LOST_OUTCOMES = new Set(['Allowed', 'Partially Allowed']);

type SortMode = 'volume' | 'winRate' | 'lossRate';

// ── Normalisation helpers ────────────────────────────────────────────────────

const STOP_WORDS = new Set(['in', 'of', 'for', 'to', 'the']);

/** Produce a compact grouping key from a raw ground string. */
function normalizeGround(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(w => !STOP_WORDS.has(w))
    .map(w => w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w)
    .join(' ');
}

// ── Jaro-Winkler implementation (~30 lines) ──────────────────────────────────

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const lenA = a.length, lenB = b.length;
  if (lenA === 0 || lenB === 0) return 0;
  const matchDist = Math.max(Math.floor(Math.max(lenA, lenB) / 2) - 1, 0);
  const aMatched = new Uint8Array(lenA);
  const bMatched = new Uint8Array(lenB);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < lenA; i++) {
    const start = Math.max(0, i - matchDist);
    const end   = Math.min(i + matchDist + 1, lenB);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = bMatched[j] = 1;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  for (let i = 0; i < lenA; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  return (matches / lenA + matches / lenB + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinkler(a: string, b: string, p = 0.1): number {
  const j = jaro(a, b);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++; else break;
  }
  return j + prefix * p * (1 - j);
}

const JW_THRESHOLD = 0.93;

// ── Cluster type — uses Maps to de-duplicate cases by case_number ────────────

interface Cluster {
  canonical: string;
  key: string;
  /** De-duplicated by case_number */
  won: Map<string, Case>;   // OEM won (Dismissed / Ex-parte)
  lost: Map<string, Case>;  // OEM lost (Allowed / Partially Allowed)
  other: Map<string, Case>;
  rawCounts: Record<string, number>;
}

function addCase(bucket: Map<string, Case>, c: Case) {
  bucket.set(c.case_number, c);
}

function mergeBuckets(target: Map<string, Case>, source: Map<string, Case>) {
  for (const [k, v] of source) target.set(k, v);
}

// ── Component ────────────────────────────────────────────────────────────────

export function GroundsAnalysis({ cases }: Props) {
  const { openDrawer } = useDashboard();
  const [sortMode, setSortMode] = useState<SortMode>('volume');

  const grounds = useMemo(() => {
    // Step 1: build per-normalised-key clusters (Maps ensure per-case uniqueness)
    const map: Record<string, Cluster> = {};

    for (const c of cases) {
      if (!c.grounds_taken || c.grounds_taken.length === 0) continue;
      const isOEMWon  = c.outcome && OEM_WON_OUTCOMES.has(c.outcome);
      const isOEMLost = c.outcome && OEM_LOST_OUTCOMES.has(c.outcome);

      for (const g of c.grounds_taken) {
        const raw = g.trim();
        if (!raw) continue;
        const key = normalizeGround(raw);
        if (!key) continue;

        if (!map[key]) {
          map[key] = {
            canonical: raw,
            key,
            won: new Map(),
            lost: new Map(),
            other: new Map(),
            rawCounts: {},
          };
        }
        map[key].rawCounts[raw] = (map[key].rawCounts[raw] ?? 0) + 1;

        if (isOEMWon)  addCase(map[key].won, c);
        else if (isOEMLost) addCase(map[key].lost, c);
        else addCase(map[key].other, c);
      }
    }

    // Update canonical to most-frequent raw string per initial cluster
    for (const cluster of Object.values(map)) {
      cluster.canonical = Object.entries(cluster.rawCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? cluster.canonical;
    }

    // Step 2: Jaro-Winkler merge pass (union-find)
    const keys = Object.keys(map);
    const parent: Record<string, string> = {};
    for (const k of keys) parent[k] = k;

    function find(x: string): string {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a: string, b: string) {
      parent[find(a)] = find(b);
    }

    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        if (jaroWinkler(keys[i], keys[j]) >= JW_THRESHOLD) {
          union(keys[i], keys[j]);
        }
      }
    }

    // Collect merged clusters — merge Maps so cross-cluster duplicates are also de-duped
    const merged: Record<string, Cluster> = {};
    for (const k of keys) {
      const root = find(k);
      if (!merged[root]) {
        merged[root] = {
          canonical: map[k].canonical,
          key: root,
          won: new Map(),
          lost: new Map(),
          other: new Map(),
          rawCounts: {},
        };
      }
      const src = map[k];
      mergeBuckets(merged[root].won, src.won);
      mergeBuckets(merged[root].lost, src.lost);
      mergeBuckets(merged[root].other, src.other);
      for (const [raw, cnt] of Object.entries(src.rawCounts)) {
        merged[root].rawCounts[raw] = (merged[root].rawCounts[raw] ?? 0) + cnt;
      }
    }

    // Re-pick canonical (most frequent raw) for merged clusters
    for (const cluster of Object.values(merged)) {
      cluster.canonical = Object.entries(cluster.rawCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? cluster.canonical;
    }

    // Step 3: compute stats from de-duplicated Maps (OEM's perspective)
    return Object.values(merged).map(({ canonical, won, lost, other }) => {
      const wonArr  = [...won.values()];
      const lostArr = [...lost.values()];
      const decided = wonArr.length + lostArr.length;
      // winRate = OEM's win rate (Dismissed / decided)
      const winRate  = decided > 0 ? Math.round((wonArr.length  / decided) * 100) : null;
      const lossRate = decided > 0 ? Math.round((lostArr.length / decided) * 100) : null;
      return {
        ground: canonical,
        won: wonArr.length,
        lost: lostArr.length,
        other: other.size,
        total: wonArr.length + lostArr.length + other.size,
        decided,
        winRate,
        lossRate,
        wonCases:  wonArr,
        lostCases: lostArr,
      };
    });
  }, [cases]);

  const sorted = useMemo(() => {
    const list = [...grounds];
    if (sortMode === 'volume')   list.sort((a, b) => b.total - a.total);
    if (sortMode === 'winRate')  list.sort((a, b) => (b.winRate  ?? -1) - (a.winRate  ?? -1));
    if (sortMode === 'lossRate') list.sort((a, b) => (b.lossRate ?? -1) - (a.lossRate ?? -1));
    return list;
  }, [grounds, sortMode]);

  if (grounds.length === 0) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-foreground">Grounds Analysis</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-64 text-xs text-muted-foreground/50">Extraction pending</CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-semibold text-foreground">Grounds Analysis</CardTitle>
          {/* Sort toggle */}
          <div className="flex rounded-md border border-border overflow-hidden text-[10px] font-mono">
            {(['volume', 'winRate', 'lossRate'] as SortMode[]).map(m => (
              <button
                key={m}
                onClick={() => setSortMode(m)}
                className={`px-2 py-1 transition-colors ${sortMode === m ? 'bg-primary text-primary-foreground' : 'bg-white text-muted-foreground hover:bg-muted'}`}
              >
                {m === 'volume' ? 'By volume' : m === 'winRate' ? 'By win rate' : 'By loss rate'}
              </button>
            ))}
          </div>
        </div>
        {/* Legend — OEM's perspective */}
        <div className="flex gap-4 text-[10px] font-mono text-muted-foreground mt-1">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm opacity-80" style={{ background: 'hsl(174 62% 38%)' }} />OEM won</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm opacity-80" style={{ background: 'hsl(9 78% 58%)' }} />OEM lost</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-muted border border-border" />Other / unknown</span>
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 p-0 px-4 pb-4">
        <div className="overflow-y-auto max-h-[420px] flex flex-col gap-2 pr-1">
          {sorted.map(g => {
            const totalMax  = sorted[0]?.total || 1;
            const wonWidth   = (g.won   / totalMax) * 100;
            const lostWidth  = (g.lost  / totalMax) * 100;
            const otherWidth = (g.other / totalMax) * 100;

            return (
              <div key={g.ground} className="group">
                {/* Ground label */}
                <div className="flex items-baseline justify-between mb-0.5 gap-2">
                  <span className="font-mono text-[10px] text-foreground leading-tight">{g.ground}</span>
                  <span className="font-mono text-[9px] text-muted-foreground/60 flex-shrink-0">
                    {g.total} total
                    {g.winRate != null && <> · <span style={{ color: 'hsl(174 62% 38%)' }}>{g.winRate}% OEM won</span></>}
                  </span>
                </div>

                {/* Stacked bar — green = OEM won, red = OEM lost */}
                <div className="flex gap-0.5 h-5 rounded overflow-hidden cursor-pointer"
                  onClick={() => openDrawer(`Ground: ${g.ground}`, [...g.wonCases, ...g.lostCases])}
                >
                  {g.won > 0 && (
                    <div
                      className="h-full opacity-80 hover:opacity-100 transition-opacity flex items-center justify-end pr-1 min-w-[16px] rounded-l"
                      style={{ width: `${wonWidth}%`, background: 'hsl(174 62% 38%)' }}
                      title={`${g.won} dismissed (OEM won)`}
                      onClick={e => { e.stopPropagation(); openDrawer(`OEM won — ${g.ground}`, g.wonCases); }}
                    >
                      {wonWidth > 12 && <span className="font-mono text-[9px] text-white font-semibold">{g.won}</span>}
                    </div>
                  )}
                  {g.lost > 0 && (
                    <div
                      className="h-full opacity-80 hover:opacity-100 transition-opacity flex items-center justify-end pr-1 min-w-[16px]"
                      style={{ width: `${lostWidth}%`, background: 'hsl(9 78% 58%)' }}
                      title={`${g.lost} allowed (OEM lost)`}
                      onClick={e => { e.stopPropagation(); openDrawer(`OEM lost — ${g.ground}`, g.lostCases); }}
                    >
                      {lostWidth > 12 && <span className="font-mono text-[9px] text-white font-semibold">{g.lost}</span>}
                    </div>
                  )}
                  {g.other > 0 && (
                    <div
                      className="h-full bg-muted border border-border/50 opacity-60 rounded-r"
                      style={{ width: `${otherWidth}%` }}
                      title={`${g.other} other outcome`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
