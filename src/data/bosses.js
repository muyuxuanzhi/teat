// Boss 数据：每关一个最终 Boss。
// 每个 Boss 有血量(hp)、弹幕攻击模式(patterns)、移动方式、外观绘制类型(shape)、配色。
// BossScene 依据这些数据驱动弹幕战。
// 肉鸽爽游平衡：玩家有效 DPS 约 12~16，血量按"至少撑住 15~25 秒攻击"配平，
// 第1关 ~15s，逐关递增到最终关 ~25s。弹幕数量偏少、间隔偏长，好躲、打得爽。
// （2024 修订：整体血量下调约一半，配合"自机判定点缩小为高亮圆点"，
//   让战斗节奏更紧凑，不会因为躲弹变简单而把单局时间拖得过长。）
//
// 地狱难度额外机制：
// - hellPattern：Boss 专属"符卡"式常驻弹幕（环形缺口/交织螺旋等，见 BossScene._emitPattern）
// - ultimate：Boss 血量掉到约 50% 时触发一次的"大招"符卡（参考东方 Project 符卡系统），
//   触发期间会暂停常规弹幕，改为播放编排好的多段攻击循环（loop），并在屏幕上显示符卡名，
//   持续 duration 秒后自动结束、恢复常规攻击。每段攻击仍然是有规律可读的图案组合，
//   而不是单纯堆高弹幕密度。

export const BOSSES = [
  {
    id: "evil_mushroom",
    name: "邪恶蘑菇",
    hp: 230,                  // ~15 秒
    shape: "mushroom",
    color: "#ff5c8a",
    capColor: "#c8324f",
    moveMode: "sway",        // 上下摇摆
    moveSpeed: 60,
    patterns: [
      { type: "spread", count: 3, interval: 1.4, bulletSpeed: 90, spreadDeg: 50 },
      { type: "aimed", count: 1, interval: 1.0, bulletSpeed: 120 },
    ],
    // 地狱难度专属"符卡"：环形孢子云，中间留一道缺口且缺口持续旋转，
    // 需要玩家追着缺口走位躲避——有明确规律、可读可练，而非单纯堆弹幕量。
    hellPattern: { type: "ringGap", count: 16, interval: 2.2, bulletSpeed: 92, gapDeg: 58, gapRotate: 0.46 },
    // 半血大招符卡：双环孢子云反向旋转缺口——需要同时追踪两层缺口的相对位置，
    // 找到两个缺口重叠的瞬间穿过，是全关最基础的一道"读图"训练符卡。
    ultimate: {
      name: "符卡「孢子曼陀罗」",
      duration: 8,
      // 大招专属高亮配色（区别于常规弹幕的单色，营造"这是大招"的视觉冲击）
      colors: ["#ff5c8a", "#ffe45c", "#ffffff"],
      loop: [
        { type: "ringGap", count: 18, interval: 1.1, bulletSpeed: 76, gapDeg: 62, gapRotate: 0.9 },
        { type: "ringGap", count: 18, interval: 1.1, bulletSpeed: 82, gapDeg: 62, gapRotate: -0.9 },
        { type: "aimed", count: 2, interval: 0.55, bulletSpeed: 140 },
      ],
    },
    desc: "喷吐孢子弹幕的森林之敌。",
  },
  {
    id: "evil_vine",
    name: "邪恶藤蔓",
    hp: 270,                  // ~17 秒
    shape: "vine",
    color: "#5cff9a",
    capColor: "#2ea85c",
    moveMode: "sway",
    moveSpeed: 75,
    patterns: [
      { type: "wave", count: 4, interval: 1.5, bulletSpeed: 80, spreadDeg: 80 },
      { type: "aimed", count: 1, interval: 0.95, bulletSpeed: 110 },
    ],
    // 地狱难度专属"符卡"：双臂反向旋转螺旋，交织成藤蔓缠绕状的"花瓣"弹幕，
    // 密度比单臂螺旋更高，但两臂对称可读，走位规律清晰。
    hellPattern: { type: "crossSpiral", count: 3, interval: 0.85, bulletSpeed: 84 },
    // 半血大招符卡：交织螺旋加密 + 左右横扫波浪，编织成藤蔓缠绕的"荆棘牢笼"，
    // 需要在螺旋缝隙与波浪间隙之间找到安全走廊。
    ultimate: {
      name: "符卡「荆棘缠缚」",
      duration: 8.5,
      colors: ["#5cff9a", "#5cffe0", "#ffffff"],
      loop: [
        { type: "crossSpiral", count: 4, interval: 0.5, bulletSpeed: 86 },
        { type: "wave", count: 6, interval: 0.9, bulletSpeed: 90, spreadDeg: 100 },
        { type: "aimed", count: 2, interval: 0.6, bulletSpeed: 145 },
      ],
    },
    desc: "挥舞藤蔓、缠绕射击的毒沼之主。",
  },
  {
    id: "crystal_golem",
    name: "水晶魔像",
    hp: 310,                  // ~20 秒
    shape: "golem",
    color: "#5cc8ff",
    capColor: "#3a8cc8",
    moveMode: "chase",       // 追踪玩家 Y
    moveSpeed: 46,
    patterns: [
      { type: "ring", count: 8, interval: 2.0, bulletSpeed: 80 },
      { type: "aimed", count: 2, interval: 0.95, bulletSpeed: 125 },
    ],
    // 地狱难度专属"符卡"：更密的水晶碎片环＋旋转缺口，缺口转速比森林关更快。
    hellPattern: { type: "ringGap", count: 20, interval: 2.4, bulletSpeed: 96, gapDeg: 52, gapRotate: 0.6 },
    // 半血大招符卡：满环水晶弹幕叠加高速旋转缺口环，密度全关第二高，
    // 需要先在外圈定位、再精确卡点穿越内圈缺口。
    ultimate: {
      name: "符卡「棱晶审判」",
      duration: 9,
      colors: ["#5cc8ff", "#c85cff", "#ffffff"],
      loop: [
        { type: "ring", count: 14, interval: 1.3, bulletSpeed: 74 },
        { type: "ringGap", count: 24, interval: 1.0, bulletSpeed: 92, gapDeg: 48, gapRotate: 1.1 },
        { type: "aimed", count: 3, interval: 0.6, bulletSpeed: 150 },
      ],
    },
    desc: "以水晶碎片轰击的洞窟守卫。",
  },
  {
    id: "ghost_lord",
    name: "幽灵领主",
    hp: 350,                  // ~22 秒
    shape: "ghost",
    color: "#b96bff",
    capColor: "#7a48b0",
    moveMode: "teleport",    // 瞬移
    moveSpeed: 0,
    patterns: [
      { type: "spiral", count: 2, interval: 0.32, bulletSpeed: 88 },
      { type: "aimed", count: 2, interval: 0.95, bulletSpeed: 135 },
    ],
    // 地狱难度专属"符卡"：双臂交织螺旋叠加瞬移位移，编织出更难读的鬼影弹幕网。
    hellPattern: { type: "crossSpiral", count: 4, interval: 0.7, bulletSpeed: 92 },
    // 半血大招符卡：交织螺旋加速 + 反向旋转缺口环，配合瞬移位移让弹幕来源不断变化，
    // 是全关"读图+反应"要求最高的一道符卡之一。
    ultimate: {
      name: "符卡「幽冥回廊」",
      duration: 9.5,
      colors: ["#b96bff", "#ff5cf0", "#ffffff"],
      loop: [
        { type: "crossSpiral", count: 5, interval: 0.4, bulletSpeed: 96 },
        { type: "ringGap", count: 20, interval: 1.0, bulletSpeed: 88, gapDeg: 50, gapRotate: -1.0 },
        { type: "aimed", count: 3, interval: 0.5, bulletSpeed: 155 },
      ],
    },
    desc: "瞬移穿梭、螺旋弹幕的城堡之主。",
  },
  {
    id: "eclipse_witch",
    name: "月蚀魔女",
    hp: 400,                  // ~25 秒
    shape: "witch",
    color: "#ffcf5c",
    capColor: "#c89a3a",
    moveMode: "sway",
    moveSpeed: 88,
    patterns: [
      { type: "ring", count: 10, interval: 1.9, bulletSpeed: 82 },
      { type: "spiral", count: 3, interval: 0.3, bulletSpeed: 90 },
      { type: "aimed", count: 2, interval: 0.95, bulletSpeed: 140 },
    ],
    // 最终Boss 地狱专属"符卡"：缺口更窄、旋转更快的月蚀弹幕环，全关卡最难的一道符卡。
    hellPattern: { type: "ringGap", count: 22, interval: 2.1, bulletSpeed: 100, gapDeg: 46, gapRotate: 0.7 },
    // 最终大招符卡：双环反向旋转缺口叠加交织螺旋与追踪弹，全游戏难度顶点，
    // 汇集前面四道符卡的核心机制（双缺口环 + 交织螺旋 + 追踪），作为最终试炼的总结。
    ultimate: {
      name: "符卡「月蚀・终焉之环」",
      duration: 10,
      colors: ["#ffcf5c", "#ff5c5c", "#ffffff"],
      loop: [
        { type: "ringGap", count: 26, interval: 0.9, bulletSpeed: 96, gapDeg: 44, gapRotate: 1.2 },
        { type: "ringGap", count: 26, interval: 0.9, bulletSpeed: 100, gapDeg: 44, gapRotate: -1.2 },
        { type: "crossSpiral", count: 4, interval: 0.5, bulletSpeed: 100 },
        { type: "aimed", count: 3, interval: 0.5, bulletSpeed: 160 },
      ],
    },
    desc: "掌控月蚀之力的最终宿敌。",
  },
];

export function getBossById(id) {
  return BOSSES.find((b) => b.id === id) || BOSSES[0];
}
