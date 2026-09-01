// 魔女回廊 · 爬塔运行时状态（内存态单例，不走 localStorage 持久化，
// 与主线的金币/存档体系完全隔离——回廊内的月光结晶、咒物、圣骸只在本次爬塔中有效，
// 中途退出或石化倒下都会清空，与"霓虹疾跑"式的一次性 Roguelike 回合保持一致）。
import { genFloorMap, findNode } from "../data/towerMap.js";
import { CURSES, REMAINS, rollWeightedCurse } from "../data/curses.js";
import { LEVELS } from "../data/levels.js";

function freshState() {
  return {
    active: false,      // 是否正在进行一次回廊爬塔
    completed: false,   // 是否已通关全部楼层
    floor: 1,
    totalFloors: LEVELS.length,
    map: null,
    currentNodeId: null,
    completedNodeIds: [],
    crystals: 0,         // 月光结晶：局内限定货币
    curses: {},           // { curseId: stacks }
    remains: [],           // [remainId, ...]
  };
}

let state = freshState();

export const TowerRun = {
  get state() {
    return state;
  },

  isActive() {
    return !!state.active;
  },

  // 开启一次全新的回廊爬塔（会清空上一次残留的结晶/咒物/圣骸）
  start() {
    state = freshState();
    state.active = true;
    state.map = genFloorMap(1);
    state.currentNodeId = state.map.startNodeId;
    state.completedNodeIds = [state.map.startNodeId];
    return state;
  },

  // 中途放弃 / 石化倒下：清空本次爬塔的一切积累
  reset() {
    state = freshState();
  },

  addCrystals(n) {
    const mul = this.crystalGainMul();
    state.crystals = Math.max(0, state.crystals + Math.round(n * mul));
    return state.crystals;
  },

  spendCrystals(n) {
    if (state.crystals < n) return false;
    state.crystals -= n;
    return true;
  },

  curseStacks(id) {
    return state.curses[id] || 0;
  },

  addCurseStacks(id, n = 1) {
    state.curses[id] = (state.curses[id] || 0) + n;
    return state.curses[id];
  },

  hasRemains(id) {
    return state.remains.includes(id);
  },

  addRemains(id) {
    if (!state.remains.includes(id)) state.remains.push(id);
    return state.remains;
  },

  consumeRemains(id) {
    const i = state.remains.indexOf(id);
    if (i >= 0) {
      state.remains.splice(i, 1);
      return true;
    }
    return false;
  },

  // 掉落一件随机咒物/圣骸："common" | "rare" | "epic"
  grantRandomItem(tier = "common") {
    if (tier === "epic") {
      const pool = REMAINS.filter((r) => !state.remains.includes(r.id));
      const r = (pool.length ? pool : REMAINS)[Math.floor(Math.random() * (pool.length ? pool.length : REMAINS.length))];
      this.addRemains(r.id);
      return r;
    }
    const c = rollWeightedCurse(tier === "rare" ? 1 : 0);
    this.addCurseStacks(c.id, 1);
    return c;
  },

  // 汇总所有"直接映射到 Buff"的咒物层数，供进入试炼关卡时作为起始 Buff 层数叠加
  startingBuffStacks() {
    const out = {};
    for (const c of CURSES) {
      if (c.buffId && state.curses[c.id]) out[c.buffId] = (out[c.buffId] || 0) + state.curses[c.id];
    }
    return out;
  },

  // 试炼值获取倍率（六芒放大镜等经济类咒物 + 月蚀誓约的反噬部分不影响此项）
  trialGainMul() {
    let mul = 1;
    for (const c of CURSES) {
      if (c.effect === "trialGain" && state.curses[c.id]) mul += c.value * state.curses[c.id];
    }
    return mul;
  },

  // 撞击受伤惩罚倍率（碎裂遗骸会加重）
  hitPenaltyMul() {
    let mul = 1;
    if (state.remains.includes("shattered_remnant")) {
      const r = REMAINS.find((x) => x.id === "shattered_remnant");
      mul *= r.hitPenaltyMul;
    }
    return mul;
  },

  // 结算奖励（金币/评价）倍率
  rewardMul() {
    let mul = 1;
    if (state.remains.includes("shattered_remnant")) {
      const r = REMAINS.find((x) => x.id === "shattered_remnant");
      mul *= r.rewardMul;
    }
    return mul;
  },

  // 月光结晶获取倍率（咒金香囊 + 月蚀誓约）
  crystalGainMul() {
    let mul = 1;
    for (const c of CURSES) {
      if (c.effect === "crystalGain" && state.curses[c.id]) mul += c.value * state.curses[c.id];
    }
    if (state.remains.includes("eclipse_vow")) {
      const r = REMAINS.find((x) => x.id === "eclipse_vow");
      mul *= r.crystalMul;
    }
    return mul;
  },

  // 是否携带"沉眠之眼"（Boss 战协同攻击圣骸）
  hasCompanionRemain() {
    return state.remains.includes("slumbering_eye");
  },

  // 濒死时尝试消耗"石化之心"免死，成功返回 true
  tryConsumeRevive() {
    return this.consumeRemains("petrified_heart");
  },

  markNodeDone(nodeId) {
    if (!state.completedNodeIds.includes(nodeId)) state.completedNodeIds.push(nodeId);
    const n = findNode(state.map, nodeId);
    if (n) n.done = true;
  },

  moveTo(nodeId) {
    state.currentNodeId = nodeId;
  },

  // 推进到下一层楼；若已是最后一层则视为通关回廊
  advanceFloor() {
    if (state.floor >= state.totalFloors) {
      return this.completeTower();
    }
    state.floor += 1;
    state.map = genFloorMap(state.floor);
    state.currentNodeId = state.map.startNodeId;
    state.completedNodeIds = [state.map.startNodeId];
    return state;
  },

  completeTower() {
    state.active = false;
    state.completed = true;
    return state;
  },
};
