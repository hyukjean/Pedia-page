"use client";

// The antidote to infinite derivation: a corner tree of dots and lines.
// The user always knows how many steps they are from the root.

interface MapNode {
  id: string;
  parentId: string | null;
  depth: number;
  label: string;
  bedrock: boolean;
}

const DX = 18; // px per depth step
const DY = 16; // px per leaf row

export default function ThreadMap({
  nodes,
  activeId,
  maxDepth,
  onSelect,
  variant = "corner",
  lift = false,
}: {
  nodes: MapNode[];
  activeId: string;
  maxDepth: number;
  onSelect: (id: string) => void;
  /** corner: fixed overlay (mobile). inline: sits above the card tree (desktop). */
  variant?: "corner" | "inline";
  /** corner only: raise above the open bottom sheet. */
  lift?: boolean;
}) {
  // Tidy-ish layout: leaves take successive rows; parents center on children.
  const children = new Map<string, MapNode[]>();
  let root: MapNode | null = null;
  for (const n of nodes) {
    if (n.parentId === null) root = n;
    else {
      const list = children.get(n.parentId) ?? [];
      list.push(n);
      children.set(n.parentId, list);
    }
  }
  if (!root) return null;

  const pos = new Map<string, { x: number; y: number }>();
  let nextRow = 0;
  const place = (n: MapNode): number => {
    const kids = children.get(n.id) ?? [];
    let y: number;
    if (kids.length === 0) {
      y = nextRow++ * DY;
    } else {
      const ys = kids.map(place);
      y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    pos.set(n.id, { x: n.depth * DX, y });
    return y;
  };
  place(root);

  const w = (Math.max(...nodes.map((n) => n.depth)) + 1) * DX + 8;
  const h = Math.max(nextRow, 1) * DY + 8;
  const activeDepth = nodes.find((n) => n.id === activeId)?.depth ?? 0;

  return (
    <nav
      className={
        variant === "corner"
          ? `fixed left-5 z-10 select-none ${lift ? "bottom-[calc(38vh+118px)]" : "bottom-[118px]"}`
          : "select-none"
      }
    >
      <svg width={w} height={h} viewBox={`-4 -8 ${w} ${h}`} className="pedia-map overflow-visible">
        {nodes.map((n) => {
          if (!n.parentId) return null;
          const p = pos.get(n.parentId);
          const c = pos.get(n.id);
          if (!p || !c) return null;
          return (
            <path
              key={`e-${n.id}`}
              d={`M ${p.x + 3} ${p.y} C ${p.x + DX / 2} ${p.y}, ${p.x + DX / 2} ${c.y}, ${c.x - 3} ${c.y}`}
              fill="none"
              stroke="var(--color-sub)"
              strokeOpacity={0.35}
              strokeWidth={1}
            />
          );
        })}
        {nodes.map((n) => {
          const c = pos.get(n.id);
          if (!c) return null;
          const active = n.id === activeId;
          return (
            <circle
              key={n.id}
              cx={c.x}
              cy={c.y}
              r={active ? 4 : 3}
              fill={active ? "var(--color-accent)" : n.bedrock ? "var(--color-page)" : "var(--color-sub)"}
              stroke={n.bedrock ? "var(--color-accent)" : "none"}
              strokeWidth={n.bedrock ? 1.5 : 0}
              className="cursor-pointer"
              onClick={() => onSelect(n.id)}
            >
              <title>{n.label}</title>
            </circle>
          );
        })}
      </svg>
      <p className="mt-1.5 text-[10px] text-sub">
        {activeDepth === 0 ? "root" : `${activeDepth} step${activeDepth > 1 ? "s" : ""} from root`} · limit {maxDepth}
      </p>
    </nav>
  );
}
