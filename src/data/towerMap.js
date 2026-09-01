// 魔女回廊 · 地图节点生成器。
// 每层楼是一张横向的节点图（DAG）：入口(start) → 若干普通/精英/设施节点 → 回廊主宰(boss)。
// 节点类型的中文命名统一走"魔法世界观"包装，而不是杀戮尖塔式的直白翻译。
import { LEVELS } from "./levels.js";
import { getBossById } from "./bosses.js";

// 节点类型定义：id / 中文名 / 图标 / 主题色
export const NODE_TYPES = {
  start:  { id: "start",  name: "回廊入口",   icon: "🚪", color: "#e9dcff" },
  battle: { id: "battle", name: "试炼战斗",   icon: "⚔",  color: "#ff5c8a" },
  elite:  { id: "elite",  name: "精英试炼",   icon: "👑", color: "#ffcf5c" },
  market: { id: "market", name: "暗巷炼金铺", icon: "🧪", color: "#4fe0d0" },
  altar:  { id: "altar",  name: "月光祭坛",   icon: "🌙", color: "#b96bff" },
  coffer: { id: "coffer", name: "遗骸宝匣",   icon: "🗝", color: "#5cc8ff" },
  boss:   { id: "boss",   name: "回廊主宰",   icon: "💀", color: "#ff5c8a" },
};

// 每层楼固定 6 列，节点数呈 1-2-3-3-2-1 的菱形分布，起点与 Boss 各占一列。
const COLUMN_COUNTS = [1, 2, 3, 3, 2, 1];

function pickMiddleType() {
  const roll = Math.random();
  if (roll < 0.40) return "battle";
  if (roll < 0.56) return "market";
  if (roll < 0.72) return "elite";
  if (roll < 0.88) return "altar";
  return "coffer";
}

// 生成第 floorIndex 层（从 1 开始）的节点图
export function genFloorMap(floorIndex) {
  const columns = [];
  for (let c = 0; c < COLUMN_COUNTS.length; c++) {
    const count = COLUMN_COUNTS[c];
    const nodes = [];
    for (let i = 0; i < count; i++) {
      let type;
      if (c === 0) type = "start";
      else if (c === COLUMN_COUNTS.length - 1) type = "boss";
      else type = pickMiddleType();
      nodes.push({
        id: `f${floorIndex}_c${c}_n${i}`,
        col: c,
        row: i,
        type,
        done: false,
        offers: null, // 供炼金铺/宝匣等节点缓存本次访问的候选内容
      });
    }
    columns.push(nodes);
  }

  // 连边：每个节点连向下一列的 1~2 个节点，并保证下一列每个节点都至少有一条入边（可达）
  const edges = [];
  for (let c = 0; c < columns.length - 1; c++) {
    const cur = columns[c];
    const next = columns[c + 1];
    cur.forEach((node, i) => {
      const ratio = cur.length > 1 ? i / (cur.length - 1) : 0;
      const baseIdx = Math.round(ratio * (next.length - 1));
      const targets = new Set([baseIdx]);
      if (next.length > 1 && Math.random() < 0.55) {
        const alt = baseIdx + (Math.random() < 0.5 ? -1 : 1);
        targets.add(Math.max(0, Math.min(next.length - 1, alt)));
      }
      targets.forEach((t) => edges.push({ from: node.id, to: next[t].id }));
    });
    // 补齐下一列中还没有入边的节点
    next.forEach((node, j) => {
      const hasIncoming = edges.some((e) => e.to === node.id);
      if (!hasIncoming) {
        const srcIdx = Math.min(cur.length - 1, Math.floor((j * cur.length) / next.length));
        edges.push({ from: cur[srcIdx].id, to: node.id });
      }
    });
  }

  const startNode = columns[0][0];
  startNode.done = true;

  return { floorIndex, columns, edges, startNodeId: startNode.id };
}

export function findNode(map, nodeId) {
  if (!map) return null;
  for (const col of map.columns) {
    const n = col.find((x) => x.id === nodeId);
    if (n) return n;
  }
  return null;
}

// 从某节点可以前往的下一批节点 id
export function nextNodeIds(map, nodeId) {
  if (!map) return [];
  return map.edges.filter((e) => e.from === nodeId).map((e) => e.to);
}

export function prevNodeIds(map, nodeId) {
  if (!map) return [];
  return map.edges.filter((e) => e.to === nodeId).map((e) => e.from);
}

// 依据楼层与列号，从既有 5 关主题中取一个配色/氛围主题（供节点信息展示、后续接入真实关卡用）
export function themeForNode(floorIndex, node) {
  const idx = (floorIndex - 1 + node.col) % LEVELS.length;
  return LEVELS[idx];
}

// 构建"试炼战斗/精英试炼"节点对应的关卡描述（供 UI 预览 & 后续接入 RunScene 使用）
export function buildNodeLevel(floorIndex, node) {
  const theme = themeForNode(floorIndex, node);
  const isElite = node.type === "elite";
  return {
    ...theme,
    id: `${node.id}__${theme.id}`,
    towerNodeId: node.id,
    subtitle: isElite ? "精英强化试炼" : "回廊试炼",
    goalTrial: Math.round(theme.goalTrial * (isElite ? 0.5 : 0.34)),
    isElite,
  };
}

// 构建"回廊主宰"（Boss）节点对应的关卡描述
export function buildBossLevel(floorIndex, node) {
  const theme = LEVELS[(floorIndex - 1) % LEVELS.length];
  return {
    ...theme,
    id: `${node.id}__${theme.id}_boss`,
    towerNodeId: node.id,
    subtitle: `回廊主宰 · ${getBossById(theme.bossId).name}`,
    isTowerBoss: true,
  };
}
