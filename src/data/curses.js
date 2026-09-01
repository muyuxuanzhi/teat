// 咒物 / 圣骸 数据（魔女回廊肉鸽爬塔玩法）。
// —— 世界观：见习魔女施放魔法皆有代价，过度施法会令身体逐渐石化，
//    最终凝结为珍贵的魔法材料。
// 咒物（CURSES）：常见(common) / 稀有(rare) 两档，是回廊中拾取的持续性祝福，
//    效果多数直接映射到现有的三选一 Buff 系统（data/buffs.js），
//    也有少数是"局内经济类"效果（提升月光结晶 / 试炼值获取）。
// 圣骸（REMAINS）：史诗级(epic)，由完全石化的魔女遗骸凝结而成，
//    威力更强但往往伴随对等代价，一次爬塔内最多持有的数量不限，但极为稀有。
//
// buffId 字段：若不为 null，代表该咒物等价于叠加 x 层对应 Buff（见 buffs.js），
// 由 TowerRun.startingBuffStacks() 汇总后，在进入试炼关卡时直接作为起始层数生效。
// effect 字段：用于没有对应现成 Buff 的"经济向"效果，由 TowerRun 对应方法读取。

export const CURSES = [
  {
    id: "double_echo",
    name: "回声法阵",
    tier: "common",
    icon: "✷",
    color: "#ffcf5c",
    buffId: "double",
    desc: "刻满回声符文的法阵碎片，收集物价值随之增幅。",
  },
  {
    id: "vine_ward",
    name: "藤蔓守誓",
    tier: "common",
    icon: "❖",
    color: "#4fe0d0",
    buffId: "guard",
    desc: "缠绕誓约的藤蔓护符，撞击受伤大幅减轻。",
  },
  {
    id: "gale_feather",
    name: "疾风羽签",
    tier: "common",
    icon: "➤",
    color: "#5cff9a",
    buffId: "haste",
    desc: "风灵羽毛削成的书签，行进间试炼值增速。",
  },
  {
    id: "lucky_mint",
    name: "幸运薄荷",
    tier: "common",
    icon: "★",
    color: "#5cc8ff",
    buffId: "lucky",
    desc: "带着薄荷香气的干花，冥冥中让好运气更常降临。",
  },
  {
    id: "coin_pouch",
    name: "咒金香囊",
    tier: "common",
    icon: "◆",
    color: "#ffcf5c",
    buffId: null,
    effect: "crystalGain",
    value: 0.2,
    desc: "缝入碎银箔的小香囊，结算时能多凝出一些月光结晶。",
  },
  {
    id: "star_pendant",
    name: "星坠坠饰",
    tier: "rare",
    icon: "★",
    color: "#5cff9a",
    buffId: "magnet",
    desc: "坠落的星辰碎片打磨而成，牵引出协同作战的星灵。",
  },
  {
    id: "breaker_gauntlet",
    name: "破障拳套",
    tier: "rare",
    icon: "✦",
    color: "#ff5c8a",
    buffId: "smash",
    desc: "曾属于某位见习魔女的战斗手套，冲撞即碎障无伤。",
  },
  {
    id: "hexagram_loupe",
    name: "六芒放大镜",
    tier: "rare",
    icon: "✶",
    color: "#b96bff",
    buffId: null,
    effect: "trialGain",
    value: 0.15,
    desc: "透过它凝视的六芒星纹路会自行扩散，试炼值获取显著提升。",
  },
];

export const REMAINS = [
  {
    id: "petrified_heart",
    name: "石化之心",
    icon: "♥",
    color: "#ff5c8a",
    effect: "revive",
    desc: "完全石化前最后一次心跳凝成的结晶，濒死时会自碎替你挡下这一劫（一次性，仅限本次回廊）。",
  },
  {
    id: "shattered_remnant",
    name: "碎裂遗骸",
    icon: "◈",
    color: "#b96bff",
    effect: "rewardBoostHitPenalty",
    rewardMul: 1.35,
    hitPenaltyMul: 1.5,
    desc: "残缺不全却仍在低语的骸骨，结算收获大幅提升，但撞击的代价也随之加重。",
  },
  {
    id: "slumbering_eye",
    name: "沉眠之眼",
    icon: "◉",
    color: "#5cc8ff",
    effect: "companion",
    desc: "始终半睁着的石化眼球，会在 Boss 战中召出协同攻击的幻影，但自身输出略微削弱。",
  },
  {
    id: "eclipse_vow",
    name: "月蚀誓约",
    icon: "☾",
    color: "#ffcf5c",
    effect: "crystalBoostCurseRisk",
    crystalMul: 1.5,
    desc: "以性命起誓换来的月蚀之力，月光结晶获取大幅提升，但会加深每一份咒物的反噬。",
  },
];

export function getCurse(id) {
  return CURSES.find((c) => c.id === id) || null;
}

export function getRemain(id) {
  return REMAINS.find((r) => r.id === id) || null;
}

// 按稀有度随机抽取 n 个不重复的咒物（用于炼金铺 / 宝匣展示候选）
export function rollCurseChoices(n = 3, tier = null) {
  const pool = (tier ? CURSES.filter((c) => c.tier === tier) : CURSES.slice());
  const out = [];
  while (out.length < n && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

// 按权重随机抽取单个咒物（默认常见 70% / 稀有 30%）
export function rollWeightedCurse(rareChance = 0.3) {
  const tier = Math.random() < rareChance ? "rare" : "common";
  const pool = CURSES.filter((c) => c.tier === tier);
  return pool[Math.floor(Math.random() * pool.length)] || CURSES[0];
}

// 随机抽取一件圣骸
export function rollRemain() {
  return REMAINS[Math.floor(Math.random() * REMAINS.length)];
}
