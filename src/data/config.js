// 全局可调参数：把所有"手感/难度"数值集中，便于快速调优
export const CONFIG = {
  // 场景布局（内部分辨率 480x270）
  groundY: 214,          // 地面基准线
  laneTopY: [104, 176],  // 玩家在 [上轨, 下轨] 的 y（顶部坐标）
  laneMidY: 140,         // 上下轨中间线（稀有金色六芒星漂浮位置，玩家切轨路径经过）
  playerX: 96,
  playerW: 20,   // 立绘缩小到与Boss战接近的尺寸后，碰撞箱同步放大一些，让判定范围更贴近视觉体型（原16，视觉与判定过于悬殊）
  playerH: 28,   // 原22，同上

  // 速度与难度
  startSpeed: 140,       // 初始滚动速度 px/s
  maxSpeed: 340,
  accel: 6,              // 每秒增加的速度
  laneSwitchLerp: 20,    // 切轨视觉插值速度（越大越干脆）

  // 生成
  spawnStart: 1.05,      // 初始生成间隔（秒）基准
  spawnMin: 0.5,         // 最小生成间隔基准
  spawnRampSpeed: 0.02,  // 每秒缩短的间隔
  spawnJitter: 0.55,     // 生成间隔随机抖动比例（0~1，越大分布越不均匀）
  orbChance: 0.42,       // 生成物为光点的概率（否则为障碍）
  pairOrbChance: 0.5,    // 生成障碍时，另一轨附带光点的概率
  burstChance: 0.22,     // 触发"成组生成"（连续障碍或一串收集物）的概率
  gapChance: 0.14,       // 触发"空档喘息"（本次不生成任何东西）的概率
  rareStarChance: 0.06,  // 中间轨稀有金色六芒星的生成概率（每次生成判定）
  rareStarValue: 300,    // 稀有金色六芒星的试炼值
  obstacleW: 16,         // 普通障碍宽度
  burstObstacleW: 9,     // 成组障碍宽度（更细，便于连续躲避）
  burstGapMin: 62,       // 成组障碍最小水平间距（保证有反应/切轨时间）
  orbSafeGap: 30,        // 障碍附带收集物时，与障碍拉开的安全水平间距（避免重叠捡不到）
  hitboxInset: 2,        // 玩家碰撞判定水平内缩（视觉不变，判定略宽松但仍贴近视觉）

  // 手感
  hitStop: 0.12,         // 碰撞顿帧时长
  shakeOnHit: 6,         // 碰撞屏震强度

  // ===== 魔女试炼 / 肉鸽成长 =====
  trialPerLevel: 2500,   // 每累积多少试炼值触发一次缓冲休息区
  starValue: 50,         // 魔法星星的试炼值
  potionValue: 100,   // 魔法药水的试炼值
  potionChance: 0.32,    // 收集物中药水的占比（其余为星星）

  // ===== 缓冲休息区 · 迷你游戏赌场 + 道途商城 =====
  coinPerStar: 1,          // 魔法星星 兑换收集币比例
  coinPerPotion: 2,        // 魔法药水 兑换收集币比例（更稀有，价值更高）
  bufferPlaysPerGame: 3,   // 每次进入缓冲区，每款小游戏可游玩的次数

  // 伤害机制（不再秒死）
  hitPenalty: 20,        // 撞障碍扣除的试炼值
  stunTime: 0.55,        // 撞障碍后的僵直时长（秒）
  hitInvuln: 0.9,     // 受伤后无敌时间（避免连续扣血）
};
