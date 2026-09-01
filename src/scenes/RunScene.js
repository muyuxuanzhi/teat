// 核心跑酷场景（魔女试炼 · 肉鸽版）：
// - 收集魔法星星(+50)/药水(+100) 累积试炼值
// - 撞障碍不再秒死：扣 20 试炼值 + 僵直 + 短暂无敌
// - 每累积 2500 试炼值暂停，进入缓冲休息区（本段收集物兑换收集币 → 迷你游戏赌场/道途商城 → 继续前行）
// - 随累计试炼值进化魔女形态（水手服 → 见习魔女 → 扫帚魔女）
// - 累计试炼值达到关卡目标(goalTrial) → 进入武器选择 → 弹幕 Boss 战
// - 试炼值降到 0 且再次受伤则结束（试炼失败）
// - 局内可暂停(P/暂停按钮) 与 退出(回主菜单)
import { Scene } from "../engine/Scene.js";
import { PALETTE } from "../engine/Game.js";
import { CONFIG } from "../data/config.js";
import { Player } from "../systems/Player.js";
import { Spawner } from "../systems/Spawner.js";
import { Particles } from "../systems/Particles.js";
import { Background } from "../systems/Background.js";
import { Save } from "../systems/Save.js";
import { getSkin } from "../data/skins.js";
import { rollChoices, getBuff } from "../data/buffs.js";
import { getFormByTrial, getNextForm, WITCH_FORMS } from "../data/witchForms.js";
import { getLevel, levelBgSkin } from "../data/levels.js";
import { Difficulty } from "../data/difficulty.js";
import { ACHIEVEMENTS } from "../data/achievements.js";
import { MenuScene } from "./MenuScene.js";
import { audio } from "../engine/Audio.js";
import { TowerRun } from "../systems/TowerRun.js";
import { REMAINS } from "../data/curses.js";

const FINAL_FORM_ID = WITCH_FORMS[WITCH_FORMS.length - 1].id;

// 缓冲休息区 进入/离开 的过渡时长：让角色先跑过一段无障碍物/无收集物的安全路，
// 再切入缓冲区商店 UI（或从商店切回后再跑一段安全路才恢复正常障碍生成），减少突兀感
const BUFFER_TRANSITION_TIME = 3.2;

// 缓冲休息区 · 欢乐老虎机：转轮符号（w=权重，mul=三连倍率，稀有度越高权重越低倍率越高）
const SLOT_SYMBOLS = [
  { icon: "✧", w: 4, mul: 10, color: "#ffe08a" },
  { icon: "☾", w: 8, mul: 6, color: "#7fdfff" },
  { icon: "★", w: 14, mul: 4, color: "#ffcf5c" },
  { icon: "✦", w: 24, mul: 3, color: "#ff5c8a" },
  { icon: "✷", w: 30, mul: 2, color: "#b96bff" },
];

// ===== 缓冲休息区 · 牛牛纸牌：一副去掉大小王的扑克牌（52张）=====
const NIU_SUITS = ["♠", "♥", "♦", "♣"];
const NIU_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function makeDeck() {
  const deck = [];
  for (const suit of NIU_SUITS) {
    for (const rank of NIU_RANKS) {
      const value = rank === "A" ? 1 : (rank === "J" || rank === "Q" || rank === "K") ? 10 : parseInt(rank, 10);
      deck.push({ suit, rank, value, red: suit === "♥" || suit === "♦" });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// 5张牌中找三张之和为10的倍数，剩余两张之和的个位数即为"牛几"；个位为0则是最大的"牛牛"(10)；
// 若任意三张组合都凑不成10的倍数，则为"无牛"(-1，最小)
const NIU_COMBOS = [
  [0, 1, 2], [0, 1, 3], [0, 1, 4], [0, 2, 3], [0, 2, 4],
  [0, 3, 4], [1, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, 4],
];
function evaluateNiu(cards) {
  let best = -1;
  for (const combo of NIU_COMBOS) {
    const sum3 = cards[combo[0]].value + cards[combo[1]].value + cards[combo[2]].value;
    if (sum3 % 10 !== 0) continue;
    const rest = [0, 1, 2, 3, 4].filter((i) => !combo.includes(i));
    const sum2 = cards[rest[0]].value + cards[rest[1]].value;
    const digit = sum2 % 10;
    const niu = digit === 0 ? 10 : digit;
    if (niu > best) best = niu;
  }
  return best;
}

function niuLabel(niu) {
  if (niu === -1) return "无牛";
  if (niu === 10) return "牛牛";
  return `牛${["", "一", "二", "三", "四", "五", "六", "七", "八", "九"][niu]}`;
}

// 玩家赢牌时的赔率倍率：牌型越大赔率越高
function niuPayoutMul(niu) {
  if (niu === 10) return 5;
  if (niu >= 7) return 3;
  if (niu >= 4) return 2;
  if (niu >= 1) return 1.5;
  return 1; // 无牛（仅平局可能出现，赢牌时不会是无牛）
}

export class RunScene extends Scene {
  // carry: 无限模式跨轮累加的状态（buffs / totalTrial 基线 / collected / round）
  // towerNode: 若为"魔女回廊"爬塔节点，携带节点信息（type: battle/elite/boss）
  constructor(game, level, carry = null, towerNode = null) {
    super(game);
    this.level = level || getLevel(1);
    this.carry = carry;
    this.towerNode = towerNode || (carry && carry.towerNode) || null;
    this.endless = !!(level && level.endless);
    this.save = Save.load();
    // 关卡专属背景：每关用自己的主题配色与背景风格（森林/毒沼/洞窟/城堡/月蚀）
    this.bg = new Background(game.width, game.height, levelBgSkin(this.level));
    this.player = new Player(getFormByTrial(0), this.save.equipped.character);
    this.spawner = new Spawner(getSkin("obstacle", this.save.equipped.obstacle), this.level.name);
    this.particles = new Particles();

    // ===== 先天角色能力：海於专属契约鲸鱼 =====
    // 仅当前装备的角色皮肤配置了 pet 时生效（目前只有海於的碧海魔女皮肤）。
    // 鲸鱼跟随玩家显示；每隔 shieldInterval 秒攒一层不可叠加的护盾，
    // 护盾在下一次撞上障碍时消耗，完全抵挡那一次碰撞伤害。
    const charSkin = getSkin("character", this.save.equipped.character);
    this.pet = charSkin && charSkin.pet ? charSkin.pet : null;
    if (this.pet) {
      this.petX = this.player.cx - 30;
      this.petY = this.player.cy;
      this.petBob = 0;
      this.petShieldT = 0;
      this.petShieldInterval = this.pet.shieldInterval || 30;
      this.petShieldReady = false;
    }

    this.speed = CONFIG.startSpeed;
    this.speedMul = this.level.speedMul || 1;
    this.elapsed = 0;
    this.distance = 0;

    // 试炼值系统
    this.trial = 0;      // 当前试炼值（会因收集增加、受伤减少）
    this.totalTrial = 0;     // 累计获得（只增，用于形态进化 & 触发阈值）
    this.nextThreshold = CONFIG.trialPerLevel; // 下一次触发三选一的累计值
    this.collected = 0;  // 收集数量（用于结算金币）
    this.goalTrial = this.level.goalTrial;// 达到即进入 Boss 战

    // Buff 层数：{ buffId: stacks }
  this.buffs = {};

    // ===== 无限模式：继承上一轮累加的 Buff 与收集度 =====
    this.round = (carry && carry.round) || (this.endless ? 1 : this.level.round || 1);
    if (carry) {
      // Buff 层数继承叠加
    this.buffs = { ...(carry.buffs || {}) };
      // 收集数继承
      this.collected = carry.collected || 0;
  // 试炼值累计继承为基线：本轮目标是"在已有累计上再攒满一整轮"
      const carriedTotal = carry.totalTrial || 0;
      this.totalTrial = carriedTotal;
      this.trial = carry.trial || 0;
      // 本轮目标 = 已累计 + 本轮 goalTrial（这样进度条只表示"本轮进度"）
      this.roundBase = carriedTotal;
      this.goalTrial = carriedTotal + this.level.goalTrial;
      this.nextThreshold = carriedTotal + CONFIG.trialPerLevel;
      // 依据继承的累计值恢复形态
      this.player.setForm(getFormByTrial(this.totalTrial));
    } else {
      this.roundBase = 0;
  }

    // ===== 魔女回廊：叠加已持有咒物对应的起始 Buff 层数 =====
    if (this.towerNode) {
      const startBuffs = TowerRun.startingBuffStacks();
      for (const id in startBuffs) {
        this.buffs[id] = (this.buffs[id] || 0) + startBuffs[id];
      }
    }

    // ===== 难度：地狱模式生命制 =====
    this.diff = Difficulty.get();
    this.hitsTaken = 0;   // 已受击次数（地狱生命制用）
    // ===== 本局统计（成就系统用） =====
    Save.initRunStats(this.save);

    this.state = "run";      // run | choose | dead | paused | goal
    this.shake = 0;
    this.hitStop = 0;
    this.deadT = 0;
    this.earned = 0;
    this.t = 0;
    this.goalT = 0;

    // 三选一（历史数据结构保留：_takeBuff 复用于道途商城购买"临时技能"）
    this.choices = [];
    this.chooseAppearT = 0;

    // ===== 缓冲休息区（本段收集物兑换收集币 → 迷你游戏赌场 + 道途商城）=====
    this.segStar = 0;     // 本段（距上次进入缓冲区以来）拾取的魔法星星数
    this.segPotion = 0;   // 本段拾取的魔法药水数
    this.bufferCoins = 0; // 收集币：仅在缓冲区内有效，离开后清空
    this.bufferView = "menu"; // menu | rules | shop
    this.bufferGame = null;   // slot | cards | niuniu
    this.bufferBet = 0;
    this.bufferMsg = "";
    this.bufferT = 0;
    this.transT = 0; // bufferApproach/bufferExit 过渡段计时
    this.bufferPlays = { slot: CONFIG.bufferPlaysPerGame, cards: CONFIG.bufferPlaysPerGame, niuniu: CONFIG.bufferPlaysPerGame };
    this.slotSpin = null;
    this.cardGame = null;  // 卡牌比大小局内状态
    this.niuGame = null;   // 牛牛纸牌局内状态

    // 连续收集连击：收集物累计到 3 个以上时在屏幕最右侧显示连击数字，
    // 撞到障碍物立即清零消失。
    this.combo = 0;
    this.comboT = 0; // 距上次连击增加的时间，用于弹出动画
  }

  get hi() { return this.save.hi; }
  get score() { return Math.floor(this.distance) + this.totalTrial; }
  stacks(id) { return this.buffs[id] || 0; }

  onEnter() {
    audio.playBgm("run");
  }

  // 地狱难度：最大可承受撞击数= 基础命数 × 2^(破障魔法层数)
  // 破障魔法【smash】在地狱下效果改变：每拾取一层耐撞翻倍(3→6→12)
  get maxLives() {
    if (!this.diff.runLifeMode) return Infinity;
    const smash = this.diff.smashDoubleEndurance ? this.stacks("smash") : 0;
    return this.diff.runLives * Math.pow(2, smash);
  }
  get lives() { return this.maxLives - this.hitsTaken; }

  _deadButtons() {
    const W = this.game.width, H = this.game.height;
    return {
      restart: { x: W / 2 - 86, y: H * 0.78, w: 80, h: 22 },
      menu: { x: W / 2 + 6, y: H * 0.78, w: 80, h: 22 },
    };
  }

  // 局内右上角暂停按钮
  _pauseBtn() { return { x: this.game.width - 26, y: 18, w: 18, h: 16 }; }

  _pauseMenuButtons() {
    const W = this.game.width, H = this.game.height;
    return {
      resume: { x: W / 2 - 70, y: H * 0.46, w: 140, h: 26 },
      exit: { x: W / 2 - 70, y: H * 0.46 + 34, w: 140, h: 26 },
    };
  }

  _choiceRects() {
    const W = this.game.width, H = this.game.height;
    const cw = 130, gap = 12;
    const totalW = cw * 3 + gap * 2;
    const x0 = (W - totalW) / 2;
    return this.choices.map((_, i) => ({
      x: x0 + i * (cw + gap), y: H * 0.34, w: cw, h: H * 0.4,
    }));
  }

  update(dt, input) {
    this.t += dt;

    // ===== 暂停界面 =====
    if (this.state === "paused") {
      const b = this._pauseMenuButtons();
      if (input.justPressed("p", "escape") || input.tapIn(b.resume)) {
        audio.play("click");
        this.state = "run";
      } else if (input.tapIn(b.exit)) {
        audio.play("click");
        this.game.changeScene(new MenuScene(this.game));
      }
      return;
    }

    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.shake *= 0.9;
      return;
    }

    // ===== 目标达成过场 =====
    if (this.state === "goal") {
      this.goalT += dt;
      this.particles.update(dt);
      this.shake *= 0.9;
      // _leavingGoal 防止异步切场景（import().then()）还没完成时，
      // goalT>1.4 这个条件每帧持续成立，导致每帧都重复播放 click 音效
      // （叠加成巨大噪音）并重复触发场景切换（造成切场景竞态、卡在半路）。
      if (!this._leavingGoal && (this.goalT > 1.4 || input.justPressed("enter", " ") || input.pointer.justDown)) {
        this._leavingGoal = true;
        audio.play("click");
        this._enterWeaponSelect();
      }
      return;
    }

    // ===== 魔女回廊 · 非Boss节点通关过场（无需迎战Boss，直接结算返回地图）=====
    if (this.state === "towerDone") {
      this.goalT += dt;
      this.particles.update(dt);
      this.shake *= 0.9;
      if (!this._leavingGoal && (this.goalT > 1.4 || input.justPressed("enter", " ") || input.pointer.justDown)) {
        this._leavingGoal = true;
        audio.play("click");
        this._returnToTower();
      }
      return;
    }

    // ===== 缓冲休息区 进入/离开 过渡段：先跑一段无障碍物/无收集物的安全路 =====
    if (this.state === "bufferApproach" || this.state === "bufferExit") {
      this.transT += dt;
      this.elapsed += dt;
      this.speed = Math.min(CONFIG.maxSpeed, CONFIG.startSpeed + this.elapsed * CONFIG.accel) * this.speedMul;
      const hasteMul = 1 + this.stacks("haste") * 0.15;
      this.distance += this.speed * dt * 0.1 * hasteMul;
      this.bg.update(dt, this.speed);
      this.player.update(dt, input);
      if (input.swipeUp) this.player.switchLane(0);
      else if (input.swipeDown) this.player.switchLane(1);
      this.spawner.update(dt, this.speed, this.elapsed); // disableSpawn=true：只清空已有实体，不再生成新的
      this.particles.update(dt);
      this._updatePet(dt);
      this.shake *= 0.85;
      if (this.transT >= BUFFER_TRANSITION_TIME) {
        if (this.state === "bufferApproach") this._openBuffer();
        else {
          this.spawner.disableSpawn = false;
          this.state = "run";
        }
      }
      return;
    }

    // ===== 缓冲休息区 =====
    if (this.state === "buffer") {
      this.bufferT += dt;
      this.particles.update(dt);
      this._updateBuffer(dt, input);
      return;
    }

    // ===== 三选一界面（历史遗留，当前不再由主流程触发，保留供参考）=====
    if (this.state === "choose") {
      this.chooseAppearT += dt;
      this.particles.update(dt);
      const rects = this._choiceRects();
      let pick = -1;
      if (input.justPressed("1")) pick = 0;
      if (input.justPressed("2")) pick = 1;
      if (input.justPressed("3")) pick = 2;
      for (let i = 0; i < rects.length; i++) {
        if (input.tapIn(rects[i])) pick = i;
      }
      if (pick >= 0 && pick < this.choices.length && this.chooseAppearT > 0.25) {
        audio.play("click");
        this._takeBuff(this.choices[pick]);
        this.state = "run";
      }
      return;
    }

    // ===== 结算界面 =====
    if (this.state === "dead") {
      this.deadT += dt;
      this.particles.update(dt);
      this.shake *= 0.88;
      if (this.deadT > 0.4 && !this._leavingDead) {
        const b = this._deadButtons();
        if (input.justPressed("enter", " ") || input.tapIn(b.restart)) {
          this._leavingDead = true;
          audio.play("click");
          if (this.towerNode) {
            // 魔女回廊：石化失败即终结本次爬塔，只能回到主菜单重新开始
            this.game.changeScene(new MenuScene(this.game));
          } else if (this.endless) {
            import("../data/levels.js")
              .then((m) => {
                this.game.changeScene(new RunScene(this.game, m.makeEndlessLevel(1)));
              })
              .catch((e) => {
                console.warn("[RunScene] 重开无限模式失败，可再次点击重试", e);
                this._leavingDead = false;
              });
          } else {
            this.game.changeScene(new RunScene(this.game, this.level));
          }
        } else if (input.justPressed("escape", "backspace") || input.tapIn(b.menu)) {
          this._leavingDead = true;
          audio.play("click");
          this.game.changeScene(new MenuScene(this.game));
        }
      }
      return;
    }

    // ===== 正常游玩 =====
    // 暂停触发（P 键 / 点击右上角暂停按钮）
    if (input.justPressed("p", "escape") || input.tapIn(this._pauseBtn())) {
      audio.play("click");
      this.state = "paused";
      return;
    }

    this.elapsed += dt;
    this.speed = Math.min(CONFIG.maxSpeed, CONFIG.startSpeed + this.elapsed * CONFIG.accel) * this.speedMul;
    const hasteMul = 1 + this.stacks("haste") * 0.15;
    this.distance += this.speed * dt * 0.1 * hasteMul;

    this.spawner.orbBonus = this.stacks("lucky") * 0.12;

    this.bg.update(dt, this.speed);
    this.player.update(dt, input);
    // 触摸滑动切轨：上滑→上轨，下滑→下轨（全屏任意位置有效）
    if (input.swipeUp) this.player.switchLane(0);
    else if (input.swipeDown) this.player.switchLane(1);
    this.spawner.update(dt, this.speed, this.elapsed);
    this.particles.update(dt);

    this._checkCollisions();
    this._updateSmashRings(dt);
    this._updatePet(dt);
    this.comboT += dt;

    this.shake *= 0.85;
  }

  // 契约鲸鱼：跟随玩家游动 + 护盾节奏计时（不可叠加，攒满一层就等待被消耗）
  _updatePet(dt) {
    if (!this.pet) return;
    const targetX = this.player.cx - 30;
    const targetY = this.player.cy;
    this.petX += (targetX - this.petX) * Math.min(1, 6 * dt);
    this.petBob += dt;
    this.petY = targetY + Math.sin(this.petBob * 3) * 6;

    this.petShieldT += dt;
    if (this.petShieldT >= this.petShieldInterval) {
      this.petShieldT = 0;
      if (!this.petShieldReady) {
        this.petShieldReady = true;
        this.particles.burst(this.player.cx, this.player.cy, this.pet.color, 14, { speed: 90, life: 0.5, size: 2 });
      }
    }
  }

  _updateSmashRings(dt) {
    if (!this.smashRings || !this.smashRings.length) return;
    for (const s of this.smashRings) {
      s.life -= dt;
      s.r += 260 * dt; // 快速扩张
    }
    this.smashRings = this.smashRings.filter((s) => s.life > 0);
  }

  _takeBuff(buff) {
    this.buffs[buff.id] = (this.buffs[buff.id] || 0) + 1;
    this.particles.burst(this.player.cx, this.player.cy, buff.color, 20, { speed: 130, life: 0.7 });
  }

  _gainTrial(amount, x, y, color, kind) {
    // 魔女回廊：咒物增幅本次试炼值获取（如"星坠吊坠"）
    if (this.towerNode) amount = Math.round(amount * TowerRun.trialGainMul());
    this.trial += amount;
    this.totalTrial += amount;
    this.collected++;
    this.combo++;
    this.comboT = 0;
    this.particles.burst(x, y, color, 12, { speed: 100 });

    // 缓冲休息区兑换用：记录本段（distance since 上次进入缓冲区）拾取的两种收集物数量
    if (kind === "star") this.segStar++;
    else if (kind === "potion") this.segPotion++;

    // 形态进化检查
    const newForm = getFormByTrial(this.totalTrial);
    this.player.setForm(newForm);

    // 达成关卡目标 → 进入 Boss 战（优先于缓冲休息区）
    if (this.totalTrial >= this.goalTrial && this.state === "run") {
      this._reachGoal();
      return;
    }

    // 缓冲休息区触发检查：先进入一段安全过渡路，再切入缓冲区商店 UI
    if (this.totalTrial >= this.nextThreshold) {
      this.nextThreshold += CONFIG.trialPerLevel;
      this._startBufferApproach();
    }
  }

  _reachGoal() {
    // 魔女回廊：普通/精英试炼节点没有Boss战，攒满试炼值即直接结算返回地图
    if (this.towerNode && this.towerNode.type !== "boss") {
      this._completeTowerNode();
      return;
    }
    this.state = "goal";
    this.goalT = 0;
    // 确保进化到最终形态用于展示（若未自然到达，仍以当前形态进Boss）
    this.particles.burst(this.player.cx, this.player.cy, PALETTE.gold, 30, { speed: 160, life: 0.9 });
    this.shake = 6;
    // 到达目标的瞬间就在后台预取下一场景模块，而不是等 1.4 秒过场结束/
    // 玩家点击那一刻才发起加载——过场展示期间正好用来把请求提前做完，
    // 避免"进入下一阶段"瞬间的卡顿，弱网下也不容易卡死进不去。
    this._weaponSelectPromise = import("./WeaponSelectScene.js").catch((e) => {
      console.warn("[RunScene] 预加载 WeaponSelectScene 失败，将在切换时重试", e);
      return null;
    });
  }

  // 魔女回廊 · 试炼战斗/精英试炼节点完成：产出月光结晶 + 概率掉落咒物/圣骸，不迎战Boss
  _completeTowerNode() {
    this.state = "towerDone";
    this.goalT = 0;
    this.particles.burst(this.player.cx, this.player.cy, PALETTE.gold, 30, { speed: 160, life: 0.9 });
    this.shake = 6;
    const isElite = this.towerNode.type === "elite";
    const gained = isElite ? 20 + Math.floor(Math.random() * 10) : 10 + Math.floor(Math.random() * 8);
    const before = TowerRun.state.crystals;
    TowerRun.addCrystals(gained);
    this._towerCrystalGain = TowerRun.state.crystals - before;
    this._towerDrop = null;
    if (Math.random() < (isElite ? 0.9 : 0.45)) {
      this._towerDrop = TowerRun.grantRandomItem(isElite ? "rare" : "common");
    }
    TowerRun.markNodeDone(this.towerNode.id);
    TowerRun.moveTo(this.towerNode.id);
    this._towerScenePromise = import("./TowerScene.js").catch((e) => {
      console.warn("[RunScene] 预加载 TowerScene 失败，将在切换时重试", e);
      return null;
    });
  }

  _returnToTower() {
    const loader = this._towerScenePromise || import("./TowerScene.js");
    loader
      .then((m) => {
        if (!m) throw new Error("TowerScene module not loaded");
        this.game.changeScene(new m.TowerScene(this.game));
      })
      .catch((e) => {
        console.warn("[RunScene] 返回回廊地图失败，可再次点击重试", e);
        this._leavingGoal = false;
        this._towerScenePromise = null;
      });
  }

  _enterWeaponSelect() {
    const carry = {
      buffs: { ...this.buffs },
      formId: this.player.form.id,
      collected: this.collected,
      score: this.score,
      // 无限模式跨轮累加数据
      endless: this.endless,
    round: this.round,
      totalTrial: this.totalTrial,
    trial: this.trial,
      towerNode: this.towerNode || null,
  };
    const loader = this._weaponSelectPromise || import("./WeaponSelectScene.js");
    loader
      .then((m) => {
        if (!m) throw new Error("WeaponSelectScene module not loaded");
        this.game.changeScene(new m.WeaponSelectScene(this.game, this.level, carry));
      })
      .catch((e) => {
        console.warn("[RunScene] 进入武器选择失败，可再次点击重试", e);
        this._leavingGoal = false;
        this._weaponSelectPromise = null;
      });
  }

  _openChoose() {
    this.choices = rollChoices(3);
    this.state = "choose";
    this.chooseAppearT = 0;
  }

  // ===== 缓冲休息区：本段收集物兑换收集币 → 迷你游戏赌场 + 道途商城 =====
  // 进入前的安全过渡段：清空场上障碍/收集物并暂停生成，让角色先跑过一小段空路，
  // 避免"攒够试炼值瞬间黑屏弹出商店"的突兀感
  _startBufferApproach() {
    this.state = "bufferApproach";
    this.transT = 0;
    this.spawner.entities.length = 0;
    this.spawner.disableSpawn = true;
  }

  _openBuffer() {
    this._bufferSegStar = this.segStar;
    this._bufferSegPotion = this.segPotion;
    this.bufferCoins = this.segStar * CONFIG.coinPerStar + this.segPotion * CONFIG.coinPerPotion;
    this.segStar = 0;
    this.segPotion = 0;
    this.bufferPlays = { slot: CONFIG.bufferPlaysPerGame, cards: CONFIG.bufferPlaysPerGame, niuniu: CONFIG.bufferPlaysPerGame };
    this.bufferShopBuys = {}; // 道途商城限购道具的本轮购买次数（如"游戏次数补充券"限购3次）
    this.bufferView = "menu";
    this.bufferGame = null;
    this.bufferBet = Math.min(10, this.bufferCoins);
    this.bufferMsg = "";
    this.bufferT = 0;
    this.slotSpin = null;
    this.cardGame = null;
    this.niuGame = null;
    this.state = "buffer";
  }

  // 离开缓冲区：本轮未花掉的收集币清空，先进入离开过渡段（一段安全空路），
  // 走完再恢复正常障碍/收集物生成
  _exitBuffer() {
    this.bufferCoins = 0;
    this.bufferView = "menu";
    this.bufferGame = null;
    this.slotSpin = null;
    this.cardGame = null;
    this.niuGame = null;
    this._startBufferDeparture();
  }

  _startBufferDeparture() {
    this.state = "bufferExit";
    this.transT = 0;
    this.spawner.entities.length = 0;
    this.spawner.disableSpawn = true;
  }

  _rollSlotSymbol() {
    const total = SLOT_SYMBOLS.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const s of SLOT_SYMBOLS) {
      if (r < s.w) return s;
      r -= s.w;
    }
    return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1];
  }

  _resolveSlotSpin() {
    const [a, b, c] = this.slotSpin.symbols;
    const bet = this.slotSpin.bet;
    let win = 0;
    if (a.icon === b.icon && b.icon === c.icon) {
      win = Math.round(bet * a.mul);
      this.bufferMsg = `🎉 三连「${a.icon}」！赢得 ${win} 收集币`;
      this.particles.burst(this.game.width / 2, this.game.height * 0.45, a.color, 26, { speed: 150, life: 0.8, size: 3 });
    } else if (a.icon === b.icon || b.icon === c.icon || a.icon === c.icon) {
      win = Math.round(bet * 1.2);
      this.bufferMsg = `凑到一对，小赚 ${win} 收集币`;
    } else {
      this.bufferMsg = "全不同，未中奖";
    }
    this.bufferCoins += win;
  }

  // 道途商城：全部换成 Boss战道具（价格越贵效果越强/越稀有）+ 一项可限购的"游戏次数补充"
  _bufferShopItems() {
    return [
      { id: "pet_companion", type: "buff", buffId: "magnet", name: "小跟宠·星灵伙伴", desc: "召唤跟随的小星星，Boss战协同攻击（可叠加多只）", cost: 50, icon: "★", color: "#5cff9a" },
      { id: "boss_invuln", type: "buff", buffId: "bossInvuln", name: "Boss战·开局无敌", desc: "Boss战开始时无敌3秒（叠加则更久）", cost: 100, icon: "✵", color: "#ffd94a" },
      { id: "boss_shield", type: "buff", buffId: "guard", name: "Boss战·护盾结界", desc: "跑酷受伤减半，Boss战最大血量增加（可叠加）", cost: 45, icon: "❖", color: "#4fe0d0" },
      { id: "boss_atk", type: "buff", buffId: "smash", name: "Boss战·攻击强化", desc: "跑酷破障免伤，Boss战伤害提升（可叠加）", cost: 45, icon: "✦", color: "#ff5c8a" },
      { id: "extra_plays", type: "plays", limit: 3, name: "游戏次数补充券", desc: "老虎机/纸牌/牛牛 各+1 次机会", cost: 3, icon: "🎲", color: "#7fdfff" },
    ];
  }

  _buyBufferItem(item) {
    if (item.type === "plays") {
      const bought = this.bufferShopBuys[item.id] || 0;
      if (item.limit && bought >= item.limit) { this.bufferMsg = "该道具本次已达限购次数"; return; }
      if (this.bufferCoins < item.cost) { this.bufferMsg = "收集币不足"; return; }
      audio.play("click");
      this.bufferCoins -= item.cost;
      this.bufferShopBuys[item.id] = bought + 1;
      this.bufferPlays.slot += 1;
      this.bufferPlays.cards += 1;
      this.bufferPlays.niuniu += 1;
      this.bufferMsg = `购得「${item.name}」，各迷你游戏 +1 次机会`;
      return;
    }
    if (this.bufferCoins < item.cost) { this.bufferMsg = "收集币不足"; return; }
    audio.play("click");
    this.bufferCoins -= item.cost;
    if (item.type === "buff") {
      // bossInvuln 等新道具不在三选一奖池里，getBuff 查不到时用商店自身的图标/颜色兜底
      const buff = getBuff(item.buffId) || { id: item.buffId, color: item.color };
      this._takeBuff(buff);
      this.bufferMsg = `购得「${item.name}」`;
    } else if (item.type === "hexagram") {
      Save.addHexagram(this.save, 1);
      this.bufferMsg = "获得六芒星 ×1";
    }
  }

  _bufferMenuRects() {
    const W = this.game.width, H = this.game.height;
    const cw = 110, ch = 52, gx = 14, gy = 14;
    const x0 = 34, y0 = 96;
    return {
      slot: { x: x0, y: y0, w: cw, h: ch },
      cards: { x: x0 + cw + gx, y: y0, w: cw, h: ch },
      niuniu: { x: x0, y: y0 + ch + gy, w: cw, h: ch },
      shop: { x: x0 + cw + gx, y: y0 + ch + gy, w: cw, h: ch },
      continue: { x: W - 118, y: H / 2 - 20, w: 96, h: 40 },
    };
  }

  _bufferSlotRects() {
    const W = this.game.width;
    return {
      betMinus: { x: W / 2 - 120, y: 210, w: 30, h: 22 },
      betLabel: { x: W / 2 - 84, y: 210, w: 100, h: 22 },
      betPlus: { x: W / 2 + 20, y: 210, w: 30, h: 22 },
      betAll: { x: W / 2 + 56, y: 210, w: 40, h: 22 },
      spin: { x: W / 2 - 60, y: 238, w: 120, h: 24 },
      back: { x: 8, y: 8, w: 60, h: 20 },
    };
  }

  _bufferShopRects() {
    const W = this.game.width;
    const items = this._bufferShopItems();
    // 行数变多（含"游戏次数补充券"）时收紧行高/间距，保证在 270 高度内不越界
    const rowH = 34, gap = 6, y0 = 54;
    return {
      back: { x: 8, y: 8, w: 60, h: 20 },
      items: items.map((_, i) => ({ x: W / 2 - 150, y: y0 + i * (rowH + gap), w: 300, h: rowH })),
    };
  }

  _updateBuffer(dt, input) {
    // 摇奖动画播放中禁止其它操作，播完后结算
    if (this.slotSpin && this.slotSpin.spinning) {
      this.slotSpin.t += dt;
      if (this.slotSpin.t >= 0.9) {
        this.slotSpin.spinning = false;
        this._resolveSlotSpin();
      }
      return;
    }

    if (this.bufferView === "menu") {
      const r = this._bufferMenuRects();
      if (input.tapIn(r.continue)) {
        audio.play("click");
        this._exitBuffer();
      } else if (input.tapIn(r.slot)) {
        audio.play("click");
        this.bufferView = "rules"; this.bufferGame = "slot"; this.bufferMsg = "";
      } else if (input.tapIn(r.cards)) {
        audio.play("click");
        this.bufferView = "rules"; this.bufferGame = "cards"; this.bufferMsg = "";
        this.cardGame = { phase: "bet", systemCard: null, playerCard: null, guess: null, win: 0, t: 0 };
      } else if (input.tapIn(r.niuniu)) {
        audio.play("click");
        this.bufferView = "rules"; this.bufferGame = "niuniu"; this.bufferMsg = "";
        this.niuGame = { phase: "bet", playerHand: [], systemHand: [], playerNiu: -1, systemNiu: -1, win: 0, t: 0 };
      } else if (input.tapIn(r.shop)) {
        audio.play("click");
        this.bufferView = "shop"; this.bufferMsg = "";
      }
      return;
    }

    if (this.bufferView === "rules" && this.bufferGame === "slot") {
      const r = this._bufferSlotRects();
      if (input.tapIn(r.back)) {
        audio.play("click");
        this.bufferView = "menu"; this.bufferGame = null;
      } else if (input.tapIn(r.betMinus)) {
        audio.play("click");
        this.bufferBet = Math.max(0, this.bufferBet - 10);
      } else if (input.tapIn(r.betPlus)) {
        audio.play("click");
        this.bufferBet = Math.min(this.bufferCoins, this.bufferBet + 10);
      } else if (input.tapIn(r.betAll)) {
        audio.play("click");
        this.bufferBet = this.bufferCoins;
      } else if (input.tapIn(r.spin)) {
        if (this.bufferPlays.slot > 0 && this.bufferBet > 0 && this.bufferBet <= this.bufferCoins) {
          audio.play("click");
          this.bufferPlays.slot--;
          this.bufferCoins -= this.bufferBet;
          this.slotSpin = {
            spinning: true, t: 0, bet: this.bufferBet,
            symbols: [this._rollSlotSymbol(), this._rollSlotSymbol(), this._rollSlotSymbol()],
          };
          this.bufferMsg = "";
        }
      }
      return;
    }

    if (this.bufferView === "rules" && this.bufferGame === "cards") {
      this._updateCardGame(dt, input);
      return;
    }

    if (this.bufferView === "rules" && this.bufferGame === "niuniu") {
      this._updateNiuGame(dt, input);
      return;
    }

    if (this.bufferView === "shop") {
      const rects = this._bufferShopRects();
      if (input.tapIn(rects.back)) {
        audio.play("click");
        this.bufferView = "menu"; this.bufferMsg = "";
        return;
      }
      const items = this._bufferShopItems();
      for (let i = 0; i < items.length; i++) {
        if (input.tapIn(rects.items[i])) {
          this._buyBufferItem(items[i]);
          break;
        }
      }
    }
  }

  // ===== 卡牌比大小：系统抽牌(2-9) → 玩家猜大/小 → 玩家抽牌(1-10) → 比较 =====
  _updateCardGame(dt, input) {
    const g = this.cardGame;
    const r = this._bufferCardRects();
    if (input.tapIn(r.back)) {
      audio.play("click");
      this.bufferView = "menu"; this.bufferGame = null; this.cardGame = null;
      return;
    }

    if (g.phase === "bet") {
      if (input.tapIn(r.betMinus)) { audio.play("click"); this.bufferBet = Math.max(0, this.bufferBet - 10); }
      else if (input.tapIn(r.betPlus)) { audio.play("click"); this.bufferBet = Math.min(this.bufferCoins, this.bufferBet + 10); }
      else if (input.tapIn(r.betAll)) { audio.play("click"); this.bufferBet = this.bufferCoins; }
      else if (input.tapIn(r.action)) {
        if (this.bufferPlays.cards > 0 && this.bufferBet > 0 && this.bufferBet <= this.bufferCoins) {
          audio.play("click");
          this.bufferPlays.cards--;
          this.bufferCoins -= this.bufferBet;
          g.systemCard = 2 + Math.floor(Math.random() * 8); // 2-9
          g.playerCard = null;
          g.guess = null;
          g.phase = "guess";
          this.bufferMsg = "";
        }
      }
      return;
    }

    if (g.phase === "guess") {
      if (input.tapIn(r.big)) {
        audio.play("click");
        this._resolveCardGame("big");
      } else if (input.tapIn(r.small)) {
        audio.play("click");
        this._resolveCardGame("small");
      }
      return;
    }

    if (g.phase === "result") {
      if (input.tapIn(r.action)) {
        audio.play("click");
        g.phase = "bet";
        this.bufferMsg = "";
      }
    }
  }

  _resolveCardGame(guess) {
    const g = this.cardGame;
    g.guess = guess;
    g.playerCard = 1 + Math.floor(Math.random() * 10); // 1-10
    const bet = this.bufferBet;
    let win = 0;
    if (g.playerCard === g.systemCard) {
      win = bet; // 平局退还赌注
      this.bufferMsg = `平局（都是 ${g.systemCard}），退还 ${win} 收集币`;
    } else {
      const isBig = g.playerCard > g.systemCard;
      const hit = (guess === "big" && isBig) || (guess === "small" && !isBig);
      if (hit) {
        win = Math.round(bet * 1.9);
        this.bufferMsg = `猜中「${guess === "big" ? "大" : "小"}」！赢得 ${win} 收集币`;
        this.particles.burst(this.game.width / 2, this.game.height * 0.45, PALETTE.gold, 22, { speed: 140, life: 0.8, size: 3 });
      } else {
        this.bufferMsg = "猜错了，未中奖";
      }
    }
    this.bufferCoins += win;
    g.win = win;
    g.phase = "result";
  }

  _bufferCardRects() {
    const W = this.game.width;
    return {
      back: { x: 8, y: 8, w: 60, h: 20 },
      betMinus: { x: W / 2 - 120, y: 200, w: 30, h: 22 },
      betLabel: { x: W / 2 - 84, y: 200, w: 100, h: 22 },
      betPlus: { x: W / 2 + 20, y: 200, w: 30, h: 22 },
      betAll: { x: W / 2 + 56, y: 200, w: 40, h: 22 },
      action: { x: W / 2 - 60, y: 232, w: 120, h: 26 },
      big: { x: W / 2 + 10, y: 232, w: 70, h: 26 },
      small: { x: W / 2 - 80, y: 232, w: 70, h: 26 },
    };
  }

  // ===== 牛牛纸牌：双方各抽5张，三张凑10的倍数，剩余两张点数和个位数为"牛几" =====
  _updateNiuGame(dt, input) {
    const g = this.niuGame;
    const r = this._bufferNiuRects();
    if (input.tapIn(r.back)) {
      audio.play("click");
      this.bufferView = "menu"; this.bufferGame = null; this.niuGame = null;
      return;
    }

    if (g.phase === "bet") {
      if (input.tapIn(r.betMinus)) { audio.play("click"); this.bufferBet = Math.max(0, this.bufferBet - 10); }
      else if (input.tapIn(r.betPlus)) { audio.play("click"); this.bufferBet = Math.min(this.bufferCoins, this.bufferBet + 10); }
      else if (input.tapIn(r.betAll)) { audio.play("click"); this.bufferBet = this.bufferCoins; }
      else if (input.tapIn(r.action)) {
        if (this.bufferPlays.niuniu > 0 && this.bufferBet > 0 && this.bufferBet <= this.bufferCoins) {
          audio.play("click");
          this.bufferPlays.niuniu--;
          this.bufferCoins -= this.bufferBet;
          this._dealNiuGame();
        }
      }
      return;
    }

    if (g.phase === "result") {
      if (input.tapIn(r.action)) {
        audio.play("click");
        g.phase = "bet";
        this.bufferMsg = "";
      }
    }
  }

  _dealNiuGame() {
    const g = this.niuGame;
    const deck = shuffleDeck(makeDeck());
    g.playerHand = deck.slice(0, 5);
    g.systemHand = deck.slice(5, 10);
    g.playerNiu = evaluateNiu(g.playerHand);
    g.systemNiu = evaluateNiu(g.systemHand);

    const bet = this.bufferBet;
    let win = 0;
    if (g.playerNiu === g.systemNiu) {
      win = bet;
      this.bufferMsg = `双方都是「${niuLabel(g.playerNiu)}」，平局退还 ${win} 收集币`;
    } else if (g.playerNiu > g.systemNiu) {
      const mul = niuPayoutMul(g.playerNiu);
      win = Math.round(bet * mul);
      this.bufferMsg = `你是「${niuLabel(g.playerNiu)}」赢过「${niuLabel(g.systemNiu)}」！赢得 ${win} 收集币`;
      this.particles.burst(this.game.width / 2, this.game.height * 0.4, PALETTE.gold, 24, { speed: 140, life: 0.8, size: 3 });
    } else {
      this.bufferMsg = `你是「${niuLabel(g.playerNiu)}」，系统「${niuLabel(g.systemNiu)}」更大，未中奖`;
    }
    this.bufferCoins += win;
    g.win = win;
    g.phase = "result";
  }

  _bufferNiuRects() {
    const W = this.game.width;
    return {
      back: { x: 8, y: 8, w: 60, h: 20 },
      betMinus: { x: W / 2 - 120, y: 208, w: 30, h: 22 },
      betLabel: { x: W / 2 - 84, y: 208, w: 100, h: 22 },
      betPlus: { x: W / 2 + 20, y: 208, w: 30, h: 22 },
      betAll: { x: W / 2 + 56, y: 208, w: 40, h: 22 },
      action: { x: W / 2 - 60, y: 238, w: 120, h: 26 },
    };
  }

  _checkCollisions() {
    // 收集物用玩家全宽判定（拾取手感好）；障碍判定水平内缩，视觉不变但更宽松，
    // 避免"看起来能过却被判定撞上"，尤其是成组细障碍。
    const inset = CONFIG.hitboxInset;
    const pL = this.player.x;
    const pR = this.player.x + this.player.w;
    const hL = pL + inset;
    const hR = pR - inset;
    for (const e of this.spawner.entities) {
      if (e.dead) continue;

      // 六芒星在中间轨(lane=-1)：必须主动切轨经过中线附近才能拾到，
      // 而不是停在某条固定轨道上就被动收走。
      // 之前 dy<24 时，静止停在上轨(dy≈22)也满足条件，等于不切轨也能白拿；
      // 收紧到 dy<10——两条轨道静止时的 dy 分别约 22 / 50，只有真正切轨经过
      // 中线的那一瞬间才会落入这个窗口，逼玩家必须移动才能收集。
      if (e.orbKind === "rarestar") {
        const prevRight = (e.prevX != null ? e.prevX : e.x) + e.w;
        const overlapX = e.x < pR && prevRight > pL;
        const dy = Math.abs(this.player.cy - CONFIG.laneMidY);
        if (overlapX && dy < 10) {
          e.dead = true;
          const doubleMul = 1 + this.stacks("double");
          const val = CONFIG.rareStarValue * doubleMul;
          audio.play("rareStar");
          this._gainTrial(val, e.x + e.w / 2, CONFIG.laneMidY, PALETTE.gold, "rarestar");
          //拾取特效更华丽
          this.particles.burst(e.x + e.w / 2, CONFIG.laneMidY, PALETTE.gold, 24, { speed: 170, life: 0.8, size: 3 });
          Save.recordCollect(this.save, 1);
          Save.addHexagram(this.save, 1); // 六芒星：独立于金币的收集货币，用于商店解锁武器
        }
        continue;
      }

      if (e.lane !== this.player.lane) continue;

      if (e.type === "orb") {
        const prevRight = (e.prevX != null ? e.prevX : e.x) + e.w;
        if (!(e.x < pR && prevRight > pL)) continue;
        e.dead = true;
        const doubleMul = 1 + this.stacks("double");
        const base = e.orbKind === "potion" ? CONFIG.potionValue : CONFIG.starValue;
        const val = base * doubleMul;
        const color = e.orbKind === "potion" ? PALETTE.cyan : PALETTE.gold;
        audio.play(e.orbKind === "potion" ? "collectPotion" : "collectStar");
        this._gainTrial(val, e.x + e.w / 2, this.player.cy, color, e.orbKind);
        Save.recordCollect(this.save, 1);
      } else {
        // 障碍从右向左移动，用"扫掠区间"判定：本帧覆盖 [e.x, prevRight]，
        // 避免高速下细障碍一帧内跨过玩家判定区而漏检（碰到不受伤）。
        const prevRight = (e.prevX != null ? e.prevX : e.x) + e.w;
        if (!(e.x < hR && prevRight > hL)) continue;
        this._hitObstacle(e);
        break;
      }
    }
  }

  _hitObstacle(e) {
    if (this.player.invuln > 0) return;

    // ===== 海於专属：契约鲸鱼护盾——不可叠加，攒满就挡下这一次碰撞伤害 =====
    if (this.petShieldReady) {
      this.petShieldReady = false;
      e.dead = true;
      this.player.invuln = 0.3;
      audio.play("rareStar");
      this.particles.burst(this.player.cx, this.player.cy, this.pet.color, 22, { speed: 150, life: 0.5, size: 3 });
      return;
    }

    // ===== 地狱难度：生命制（撞满 maxLives 次即死）=====
    // 破障魔法在地狱下不再"直接碾压"，而是把耐撞上限翻倍(见 maxLives)
    if (this.diff.runLifeMode) {
      e.dead = true;
      this.hitsTaken++;
      this.combo = 0;
      Save.recordObstacleHit(this.save);
      this.player.hit();
      audio.play("hit");
      this.hitStop = CONFIG.hitStop;
      this.shake = CONFIG.shakeOnHit;
      this.particles.burst(this.player.cx, this.player.cy, PALETTE.danger, 18, { speed: 130, life: 0.6, size: 3 });
      // 小幅扣试炼值（不为负）
      const guardMul = Math.pow(0.5, this.stacks("guard"));
      let hellPenalty = Math.round(CONFIG.hitPenalty * guardMul);
      if (this.towerNode) hellPenalty = Math.round(hellPenalty * TowerRun.hitPenaltyMul());
      this.trial = Math.max(0, this.trial - hellPenalty);
      if (this.hitsTaken >= this.maxLives) {
        if (this.towerNode && TowerRun.tryConsumeRevive()) {
          this._reviveInTower();
        } else {
          this._die();
        }
      }
      return;
    }

    const smash = this.stacks("smash");
    if (smash > 0) {
      e.dead = true;
      this.player.invuln = 0.2;
      // 破障魔法 2 层以上：碾压时完全不受僵直（不触发 hitStop）
      if (smash < 2) {
        this.hitStop = CONFIG.hitStop * 0.4;
      }
      this._smashFx(e);
      // 破障碾压不计入"撞击"次数（不算障碍撞击），不打断连续拾取
      return;
    }

    const guardMul = Math.pow(0.5, this.stacks("guard"));
    let penalty = Math.round(CONFIG.hitPenalty * guardMul);
    if (this.towerNode) penalty = Math.round(penalty * TowerRun.hitPenaltyMul());

    this.trial -= penalty;
    this.player.hit();
    this.combo = 0;
    Save.recordObstacleHit(this.save);
    audio.play("hit");
    this.hitStop = CONFIG.hitStop;
    this.shake = CONFIG.shakeOnHit;
    this.particles.burst(this.player.cx, this.player.cy, PALETTE.danger, 18, { speed: 130, life: 0.6, size: 3 });
    e.dead = true;

    if (this.trial < 0) {
      this.trial = 0;
      if (this.towerNode && TowerRun.tryConsumeRevive()) {
        this._reviveInTower();
      } else {
        this._die();
      }
    }
  }

  // 魔女回廊 · "石化之心"圣骸生效：免死一次，恢复少量试炼值并短暂无敌
  _reviveInTower() {
    this.trial = Math.max(this.trial, Math.round(CONFIG.hitPenalty));
    this.player.invuln = 1.0;
    audio.play("rareStar");
    this.particles.burst(this.player.cx, this.player.cy, PALETTE.gold, 30, { speed: 170, life: 0.9, size: 3 });
  }

  // 障碍碾压特效：冲击环 + 碎片飞溅 + 拖尾冲击线，配合短震
  _smashFx(e) {
    const cx = e.x + e.w / 2;
    const cy = this.player.cy;
    // 碎片飞溅（橙红+白）
    this.particles.burst(cx, cy, PALETTE.danger, 22, { speed: 220, life: 0.45, size: 3 });
    this.particles.burst(cx, cy, "#ffffff", 10, { speed: 160, life: 0.3, size: 2 });
    this.particles.burst(cx, cy, PALETTE.gold, 12, { speed: 180, life: 0.4, size: 2 });
    // 碾压冲击环（用于 render 层绘制的短生命特效）
    if (!this.smashRings) this.smashRings = [];
    this.smashRings.push({ x: cx, y: cy, r: 6, life: 0.32, maxLife: 0.32 });
    this.shake = 7;
  }

  _die() {
    this.state = "dead";
    audio.play("death");
    this.hitStop = CONFIG.hitStop;
    this.shake = CONFIG.shakeOnHit;
    this.particles.burst(this.player.cx, this.player.cy, PALETTE.danger, 24, { speed: 150, life: 0.7, size: 3 });
    this.earned = this.collected;
    this.save.coins += this.earned;
    if (this.score > this.save.hi) this.save.hi = this.score;
    Save.save(this.save);
    // 魔女回廊：石化倒下即本次爬塔彻底失败，清空月光结晶/咒物/圣骸积累
    if (this.towerNode) TowerRun.reset();
  }

  _button(ctx, r, label, color) {
    ctx.fillStyle = "rgba(185,107,255,0.14)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = color;
    ctx.font = "11px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  }

  render(ctx) {
    const W = this.game.width, H = this.game.height;

    ctx.save();
    if (this.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }
    this.bg.render(ctx, this.t);
    this.spawner.render(ctx, this.t);
    this.player.render(ctx);
    this._renderPet(ctx);
    this._renderSmashRings(ctx);
    this.particles.render(ctx);
    ctx.restore();

    this._renderHUD(ctx, W, H);

    if (this.state === "bufferApproach" || this.state === "bufferExit") this._renderTransitionHint(ctx, W, H);
    if (this.state === "choose") this._renderChoose(ctx, W, H);
    if (this.state === "buffer") this._renderBuffer(ctx, W, H);
    if (this.state === "goal") this._renderGoal(ctx, W, H);
    if (this.state === "towerDone") this._renderTowerDone(ctx, W, H);
    if (this.state === "paused") this._renderPause(ctx, W, H);
    if (this.state === "dead" && this.hitStop <= 0) this._renderDead(ctx, W, H);
  }

  // 契约鲸鱼跟随伙伴 + 护盾环（攒满一层护盾时在玩家身周画一圈微光提示）
  _renderPet(ctx) {
    if (!this.pet) return;
    const col = this.pet.color;
    if (this.petShieldReady) {
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = col; ctx.shadowBlur = 8;
      ctx.globalAlpha = 0.75 + Math.sin(this.t * 6) * 0.2;
      ctx.beginPath();
      ctx.arc(this.player.cx, this.player.cy, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.shadowBlur = 0;
    }
    ctx.save();
    ctx.translate(Math.round(this.petX), Math.round(this.petY));
    ctx.fillStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 5;
    // 身体
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 尾巴
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(-15, -5);
    ctx.lineTo(-15, 5);
    ctx.closePath();
    ctx.fill();
    // 喷水
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(3, -5);
    ctx.lineTo(2, -9 - Math.sin(this.petBob * 4) * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  _renderSmashRings(ctx) {
    if (!this.smashRings || !this.smashRings.length) return;
    for (const s of this.smashRings) {
      const a = Math.max(0, s.life / s.maxLife);
      ctx.save();
      ctx.globalAlpha = a;
      // 冲击环
      ctx.strokeStyle = PALETTE.gold;
      ctx.lineWidth = 3 * a + 0.5;
      ctx.shadowColor = PALETTE.gold; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
      // 内层白环
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5 * a;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.6, 0, Math.PI * 2); ctx.stroke();
      // 放射冲击线（碾压爆裂感）
      ctx.strokeStyle = PALETTE.danger;
      ctx.lineWidth = 2* a;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + s.maxLife;
        const r0 = s.r * 0.7, r1 = s.r * 1.25;
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(ang) * r0, s.y + Math.sin(ang) * r0);
        ctx.lineTo(s.x + Math.cos(ang) * r1, s.y + Math.sin(ang) * r1);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.shadowBlur = 0;
  }

  _renderHUD(ctx, W, H) {
    // 目标进度条（当前累计 / 关卡目标）
    // 无限模式：进度按"本轮"计算（从 roundBase 到 goalTrial）
    const base = this.roundBase || 0;
    const span = Math.max(1, this.goalTrial - base);
    const goalProg = Math.max(0, Math.min(1, (this.totalTrial - base) / span));
    const barW = W - 20, barX = 10, barY = 8, barH = 6;
    ctx.fillStyle = "rgba(20,10,31,0.6)";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(barX, barY, barW * goalProg, barH);
    ctx.strokeStyle = "rgba(255,207,92,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);

    // 试炼奖励节点标记（每 trialPerLevel 一个三选一，进度条上标特殊符号）
    const step = CONFIG.trialPerLevel;
    const cyMark = barY + barH / 2;
  ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let v = base + step; v < this.goalTrial; v += step) {
      const mx = barX + barW * ((v - base) / span);
      const reached = this.totalTrial >= v;
      // 特殊符号：✦ 已达成金色发光，未达成暗色
      ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      if (reached) {
        ctx.fillStyle = PALETTE.gold;
        ctx.shadowColor = PALETTE.gold; ctx.shadowBlur = 6;
      } else {
        ctx.fillStyle = "rgba(233,220,255,0.55)";
        ctx.shadowBlur = 0;
      }
      ctx.fillText("✦", mx, cyMark);
      ctx.shadowBlur = 0;
    }
    // 终点标记（关卡目标 = Boss）用六芒星
    ctx.font = "11px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = goalProg >= 1 ? PALETTE.danger : "rgba(255,92,138,0.85)";
    ctx.shadowColor = PALETTE.danger; ctx.shadowBlur = goalProg >= 1 ? 8 : 0;
    ctx.fillText("✶", barX + barW - 2, cyMark);
    ctx.shadowBlur = 0;
    ctx.textAlign = "left";

 ctx.fillStyle = PALETTE.text;
    ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    if (this.endless) {
      ctx.fillText(`♾ 无尽试炼 第${this.round}轮  试炼值 ${this.trial}`, 10, 20);
    } else if (this.towerNode) {
      const nodeLabel = this.towerNode.type === "boss" ? "回廊主宰试炼" : (this.towerNode.type === "elite" ? "精英试炼" : "试炼战斗");
      ctx.fillText(`🏯 ${nodeLabel} · ${this.level.name}  试炼值 ${this.trial}`, 10, 20);
    } else {
      ctx.fillText(`第${this.level.index}关 ${this.level.name}  试炼值 ${this.trial}`, 10, 20);
    }
    ctx.fillStyle = "rgba(233,220,255,0.7)";
    ctx.fillText(`形态 ${this.player.form.name}`, 10, 34);

    //地狱难度：血量爱心显示（撞 maxLives 次即死）
    if (this.diff.runLifeMode) {
      const lives = this.lives, max = this.maxLives;
      let hx = 10, hy = 48;
      ctx.font = "11px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.textBaseline = "top";
      ctx.fillStyle = this.diff.color;
      ctx.fillText("🔥", hx, hy);
      hx += 16;
      for (let i = 0; i < max; i++) {
        ctx.fillStyle = i < lives ? "#ff5c8a" : "rgba(120,80,100,0.5)";
        ctx.fillText(i < lives ? "♥" : "♡", hx + i * 11, hy);
      }
    }

    ctx.fillStyle = "rgba(255,207,92,0.85)";
    ctx.textAlign = "right";
    if (this.endless) {
      ctx.fillText(`本轮 ${this.totalTrial - base}/${this.goalTrial - base}`, W - 34, 34);
    } else {
  ctx.fillText(`目标 ${this.totalTrial}/${this.goalTrial}`, W - 34, 34);
    }

    // 契约鲸鱼护盾状态（海於专属，独立于 Buff 图标行显示在其上方）
    if (this.pet) {
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillStyle = this.pet.color;
      const label = this.petShieldReady
        ? "🐋 护盾已就位"
        : `🐋 护盾 ${Math.max(0, this.petShieldInterval - this.petShieldT).toFixed(0)}s`;
      // 原来固定在 H-30，和下方 Buff 图标行（H-18，图标框顶边在 H-26）几乎贴死，
      // 中文字号稍高时会视觉重叠，上移到 H-34 留出安全间距。
      ctx.fillText(label, 10, H - 34);
    }

    // Buff 图标列表（左下）
    this._renderBuffIcons(ctx, H);

    // 连续收集连击：屏幕最右侧竖排显示，撞障碍立即清零消失
    this._renderCombo(ctx, W, H);

    // 暂停按钮
    this._renderPauseBtn(ctx);

    ctx.textAlign = "left";
  }

  // 收集连击达到 3 个以上才显示，避免刷屏；每次新增有一次短暂的弹出放大动画
  _renderCombo(ctx, W, H) {
    if (this.combo < 3) return;
    const pop = Math.max(0, 1 - this.comboT * 4); // 0.25s 内的弹出缩放动画
    const scale = 1 + pop * 0.6;
    ctx.save();
    ctx.translate(W - 12, H * 0.42);
    ctx.scale(scale, scale);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.gold;
    ctx.shadowColor = PALETTE.gold;
    ctx.shadowBlur = 8 + pop * 10;
    ctx.font = "bold 20px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText(`${this.combo}`, 0, 0);
    ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = "rgba(255,207,92,0.9)";
    ctx.fillText("连击 COMBO", 0, 15);
    ctx.shadowBlur = 0;
    ctx.restore();
    ctx.textAlign = "left";
  }

  _renderPauseBtn(ctx) {
    const b = this._pauseBtn();
    ctx.fillStyle = "rgba(20,10,31,0.6)";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = PALETTE.neon; ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    ctx.fillStyle = PALETTE.neon;
    ctx.fillRect(b.x + 5, b.y + 4, 3, 8);
    ctx.fillRect(b.x + 10, b.y + 4, 3, 8);
  }

  _renderBuffIcons(ctx, H) {
    const ids = Object.keys(this.buffs).filter((k) => this.buffs[k] > 0);
    let y = H - 18;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const meta = this._buffMeta(id);
      const x = 10 + i * 34;
      ctx.fillStyle = "rgba(20,10,31,0.6)";
      ctx.fillRect(x, y - 8, 30, 16);
      ctx.fillStyle = meta.color;
      ctx.fillText(`${meta.icon}${this.buffs[id]}`, x + 4, y + 1);
    }
  }

  _buffMeta(id) {
    const map = {
      smash: { icon: "✦", color: "#ff5c8a" },
      double: { icon: "✷", color: "#ffcf5c" },
      guard: { icon: "❖", color: "#4fe0d0" },
      magnet: { icon: "◆", color: "#b96bff" },
      haste: { icon: "➤", color: "#5cff9a" },
      lucky: { icon: "★", color: "#5cc8ff" },
      bossInvuln: { icon: "✵", color: "#ffd94a" },
    };
    return map[id] || { icon: "?", color: "#fff" };
  }

  // 缓冲区进入/离开的安全过渡段提示：轻量文字浮层，不遮挡玩法
  _renderTransitionHint(ctx, W, H) {
    const label = this.state === "bufferApproach" ? "☾ 前方安全地带 · 即将进入缓冲休息区" : "▶ 安全地带 · 即将回归试炼之路";
    const alpha = 0.5 + Math.sin(this.t * 6) * 0.25;
    ctx.save();
    ctx.globalAlpha = Math.max(0.25, alpha);
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = PALETTE.cyan;
    ctx.shadowColor = PALETTE.cyan; ctx.shadowBlur = 6;
    ctx.fillText(label, W / 2, 44);
    ctx.restore();
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  _renderChoose(ctx, W, H) {
    ctx.fillStyle = "rgba(20,10,31,0.82)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.gold;
    ctx.font = "bold 18px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.shadowColor = PALETTE.gold;
    ctx.shadowBlur = 8;
    ctx.fillText("★ 试炼奖励 · 三选一 ★", W / 2, H * 0.2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(233,220,255,0.7)";
    ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText("点击卡片 / 按 1 2 3 选择（可叠加）", W / 2, H * 0.2 + 22);

    const rects = this._choiceRects();
    for (let i = 0; i < this.choices.length; i++) {
      const b = this.choices[i];
      const r = rects[i];
      const owned = this.stacks(b.id);
      const anim = Math.min(1, this.chooseAppearT * 4 - i * 0.15);
      if (anim <= 0) continue;
      const oy = (1 - anim) * 30;
      ctx.globalAlpha = Math.max(0, anim);

      ctx.fillStyle = "rgba(42,26,58,0.95)";
      ctx.fillRect(r.x, r.y + oy, r.w, r.h);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 10;
      ctx.strokeRect(r.x + 1, r.y + oy + 1, r.w - 2, r.h - 2);
      ctx.shadowBlur = 0;

      ctx.fillStyle = b.color;
      ctx.font = "bold 12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${i + 1}`, r.x + 8, r.y + oy + 14);

      ctx.textAlign = "center";
      ctx.font = "30px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(b.icon, r.x + r.w / 2, r.y + oy + 44);

      ctx.fillStyle = PALETTE.text;
      ctx.font = "bold 13px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(b.name, r.x + r.w / 2, r.y + oy + 78);

      if (owned > 0) {
        ctx.fillStyle = PALETTE.gold;
        ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
        ctx.fillText(`已拥有 ${owned} 层 → ${owned + 1}`, r.x + r.w / 2, r.y + oy + 96);
      }

      ctx.fillStyle = "rgba(233,220,255,0.8)";
      ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      this._wrapText(ctx, b.desc, r.x + r.w / 2, r.y + oy + 116, r.w - 16, 12);

      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
  }

  // ===== 缓冲休息区渲染 =====
  _renderBuffer(ctx, W, H) {
    // 进入时黑屏淡入，营造"离开跑道进入缓冲区"的切换感
    const fade = Math.min(1, this.bufferT * 2.5);
    ctx.fillStyle = `rgba(10,6,18,${0.92 * fade})`;
    ctx.fillRect(0, 0, W, H);
    if (fade < 1) return;

    if (this.bufferView === "menu") this._renderBufferMenu(ctx, W, H);
    else if (this.bufferView === "rules" && this.bufferGame === "slot") this._renderBufferSlot(ctx, W, H);
    else if (this.bufferView === "rules" && this.bufferGame === "cards") this._renderCardGame(ctx, W, H);
    else if (this.bufferView === "rules" && this.bufferGame === "niuniu") this._renderNiuGame(ctx, W, H);
    else if (this.bufferView === "shop") this._renderBufferShop(ctx, W, H);
  }

  _bufferCard(ctx, r, icon, label, color) {
    ctx.fillStyle = "rgba(42,26,58,0.9)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.shadowColor = color; ctx.shadowBlur = 6;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.shadowBlur = 0;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "18px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = color;
    ctx.fillText(icon, r.x + r.w / 2, r.y + r.h * 0.38);
    ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h * 0.75);
  }

  _renderBufferMenu(ctx, W, H) {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.gold;
    ctx.font = "bold 16px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.shadowColor = PALETTE.gold; ctx.shadowBlur = 8;
    ctx.fillText("☾ 缓冲休息区 ☾", W / 2, 30);
    ctx.shadowBlur = 0;

    ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = "rgba(233,220,255,0.75)";
    ctx.fillText(`本段收集 ✦星光×${this._bufferSegStar || 0}  ✧药水×${this._bufferSegPotion || 0}  已兑换收集币`, W / 2, 50);

    ctx.font = "bold 20px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = PALETTE.cyan;
    ctx.shadowColor = PALETTE.cyan; ctx.shadowBlur = 8;
    ctx.fillText(`◈ ${this.bufferCoins} 收集币`, W / 2, 72);
    ctx.shadowBlur = 0;

    const r = this._bufferMenuRects();
    this._bufferCard(ctx, r.slot, "🎰", "欢乐老虎机", PALETTE.danger);
    this._bufferCard(ctx, r.cards, "🃏", "卡牌比大小", PALETTE.neon);
    this._bufferCard(ctx, r.niuniu, "🎴", "牛牛纸牌", "#ffcf5c");
    this._bufferCard(ctx, r.shop, "🛒", "道途商城", PALETTE.gold);

    this._button(ctx, r.continue, "继续前行 ▶", PALETTE.cyan);
    ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = "rgba(255,92,138,0.85)";
    const warnCx = r.continue.x + r.continue.w / 2;
    ctx.fillText("⚠ 离开后本轮", warnCx, r.continue.y + r.continue.h + 16);
    ctx.fillText("收集币清空", warnCx, r.continue.y + r.continue.h + 28);
    ctx.textAlign = "left";
  }

  _renderBufferSlot(ctx, W, H) {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.danger;
    ctx.font = "bold 15px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.shadowColor = PALETTE.danger; ctx.shadowBlur = 6;
    ctx.fillText("🎰 欢乐老虎机", W / 2, 28);
    ctx.shadowBlur = 0;

    ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = "rgba(233,220,255,0.75)";
    this._wrapText(ctx, "押上收集币摇奖：三个相同图标按倍率赢奖（✧×10 ☾×6 ★×4 ✦×3 ✷×2），凑到一对小赚×1.2，全不同则输掉赌注。", W / 2, 44, W - 60, 11);

    const slotW = 46, gap = 10, totalW = slotW * 3 + gap * 2, sx0 = (W - totalW) / 2, sy = 94;
    for (let i = 0; i < 3; i++) {
      const rx = sx0 + i * (slotW + gap);
      ctx.fillStyle = "rgba(20,10,31,0.7)";
      ctx.fillRect(rx, sy, slotW, slotW);
      ctx.strokeStyle = "rgba(255,207,92,0.5)"; ctx.lineWidth = 1;
      ctx.strokeRect(rx + 0.5, sy + 0.5, slotW - 1, slotW - 1);
      let sym = null;
      if (this.slotSpin && this.slotSpin.spinning) sym = this._rollSlotSymbol();
      else if (this.slotSpin) sym = this.slotSpin.symbols[i];
      if (sym) {
        ctx.fillStyle = sym.color;
        ctx.font = "24px 'Microsoft YaHei', 'PingFang SC', sans-serif";
        ctx.fillText(sym.icon, rx + slotW / 2, sy + slotW / 2 + 2);
      }
    }

    if (this.bufferMsg) {
      ctx.fillStyle = PALETTE.gold;
      ctx.font = "11px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(this.bufferMsg, W / 2, sy + slotW + 18);
    }

    ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = "rgba(233,220,255,0.8)";
    ctx.fillText(`收集币 ${this.bufferCoins}   剩余次数 ${this.bufferPlays.slot}/${CONFIG.bufferPlaysPerGame}`, W / 2, sy + slotW + 36);

    const r = this._bufferSlotRects();
    this._button(ctx, r.betMinus, "－", PALETTE.cyan);
    ctx.fillStyle = PALETTE.text;
    ctx.font = "bold 12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText(`押注 ${this.bufferBet}`, r.betLabel.x + r.betLabel.w / 2, r.betLabel.y + r.betLabel.h / 2);
    this._button(ctx, r.betPlus, "＋", PALETTE.cyan);
    this._button(ctx, r.betAll, "梭哈", PALETTE.gold);

    const spinning = this.slotSpin && this.slotSpin.spinning;
    const spinDisabled = this.bufferPlays.slot <= 0 || this.bufferBet <= 0 || this.bufferBet > this.bufferCoins || spinning;
    this._button(ctx, r.spin, this.bufferPlays.slot <= 0 ? "次数已用完" : "▶ 摇奖", spinDisabled ? "rgba(233,220,255,0.35)" : PALETTE.danger);
    this._button(ctx, r.back, "◀ 返回", PALETTE.neon);
    ctx.textAlign = "left";
  }

  // ===== 卡牌比大小渲染 =====
  _drawCard(ctx, cx, cy, w, h, rankText, red) {
    ctx.fillStyle = "#f4eefc";
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.strokeStyle = red ? "#ff5c8a" : "#2a1a3a";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - w / 2 + 0.5, cy - h / 2 + 0.5, w - 1, h - 1);
    ctx.fillStyle = red ? "#ff5c8a" : "#2a1a3a";
    ctx.font = `bold ${Math.round(h * 0.4)}px 'Microsoft YaHei', 'PingFang SC', sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(rankText), cx, cy);
  }

  _renderCardGame(ctx, W, H) {
    const g = this.cardGame;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.neon;
    ctx.font = "bold 15px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.shadowColor = PALETTE.neon; ctx.shadowBlur = 6;
    ctx.fillText("🃏 卡牌比大小", W / 2, 26);
    ctx.shadowBlur = 0;

    ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = "rgba(233,220,255,0.75)";
    this._wrapText(ctx, "系统先抽一张牌（2-9），你猜接下来抽到的牌（1-10）是「大」还是「小」，猜中赢得赌注×1.9，平局退还赌注，猜错则输掉赌注。", W / 2, 42, W - 60, 11);

    const cardY = 96, cardW = 40, cardH = 56;
    if (g.systemCard != null) {
      this._drawCard(ctx, W / 2 - 36, cardY, cardW, cardH, g.systemCard, false);
      ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillStyle = "rgba(233,220,255,0.7)";
      ctx.fillText("系统牌", W / 2 - 36, cardY + cardH / 2 + 14);
    }
    if (g.playerCard != null) {
      this._drawCard(ctx, W / 2 + 36, cardY, cardW, cardH, g.playerCard, true);
      ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillStyle = "rgba(233,220,255,0.7)";
      ctx.fillText("你的牌", W / 2 + 36, cardY + cardH / 2 + 14);
    }

    if (this.bufferMsg) {
      ctx.fillStyle = PALETTE.gold;
      ctx.font = "11px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(this.bufferMsg, W / 2, cardY + cardH / 2 + 34);
    }

    ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = "rgba(233,220,255,0.8)";
    ctx.fillText(`收集币 ${this.bufferCoins}   剩余次数 ${this.bufferPlays.cards}/${CONFIG.bufferPlaysPerGame}`, W / 2, cardY + cardH / 2 + 50);

    const r = this._bufferCardRects();
    if (g.phase === "bet") {
      this._button(ctx, r.betMinus, "－", PALETTE.cyan);
      ctx.fillStyle = PALETTE.text;
      ctx.font = "bold 12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(`押注 ${this.bufferBet}`, r.betLabel.x + r.betLabel.w / 2, r.betLabel.y + r.betLabel.h / 2);
      this._button(ctx, r.betPlus, "＋", PALETTE.cyan);
      this._button(ctx, r.betAll, "梭哈", PALETTE.gold);
      const disabled = this.bufferPlays.cards <= 0 || this.bufferBet <= 0 || this.bufferBet > this.bufferCoins;
      this._button(ctx, r.action, this.bufferPlays.cards <= 0 ? "次数已用完" : "抽签开始", disabled ? "rgba(233,220,255,0.35)" : PALETTE.neon);
    } else if (g.phase === "guess") {
      this._button(ctx, r.small, "◀ 小", PALETTE.cyan);
      this._button(ctx, r.big, "大 ▶", PALETTE.danger);
    } else if (g.phase === "result") {
      this._button(ctx, r.action, "再来一局", PALETTE.neon);
    }
    this._button(ctx, r.back, "◀ 返回", PALETTE.neon);
    ctx.textAlign = "left";
  }

  // ===== 牛牛纸牌渲染 =====
  _renderNiuHand(ctx, cx, y, cards, label, niu) {
    const cardW = 26, cardH = 36, gap = 4;
    const totalW = cardW * 5 + gap * 4;
    const x0 = cx - totalW / 2;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const cardCx = x0 + i * (cardW + gap) + cardW / 2;
      this._drawCard(ctx, cardCx, y, cardW, cardH, c.rank + c.suit, c.red);
    }
    ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = "rgba(233,220,255,0.7)";
    ctx.fillText(label, cx, y - cardH / 2 - 8);
    if (niu !== undefined) {
      ctx.fillStyle = PALETTE.gold;
      ctx.font = "bold 11px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(niuLabel(niu), cx, y + cardH / 2 + 12);
    }
  }

  _renderNiuGame(ctx, W, H) {
    const g = this.niuGame;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffcf5c";
    ctx.font = "bold 15px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.shadowColor = "#ffcf5c"; ctx.shadowBlur = 6;
    ctx.fillText("🎴 牛牛纸牌", W / 2, 24);
    ctx.shadowBlur = 0;

    // 收集币/次数状态行固定在顶部，不再和下方结算文字挤在同一处
    ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = "rgba(233,220,255,0.8)";
    ctx.fillText(`收集币 ${this.bufferCoins}   剩余次数 ${this.bufferPlays.niuniu}/${CONFIG.bufferPlaysPerGame}`, W / 2, 40);

    if (g.phase === "result") {
      // 结算阶段不再显示长规则说明，腾出空间让两手牌 + 结果文字互不重叠
      this._renderNiuHand(ctx, W / 2, 88, g.systemHand, "系统", g.systemNiu);
      this._renderNiuHand(ctx, W / 2, 160, g.playerHand, "你的牌", g.playerNiu);
      if (this.bufferMsg) {
        ctx.fillStyle = PALETTE.gold;
        ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
        this._wrapText(ctx, this.bufferMsg, W / 2, 212, W - 40, 12);
      }
    } else {
      ctx.font = "8px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillStyle = "rgba(233,220,255,0.75)";
      this._wrapText(ctx, "双方各抽5张牌：三张凑成10的倍数，剩余两张点数和的个位数即为「牛几」（个位0为最大的牛牛）；凑不成则「无牛」。牛值大者赢，按牌型倍率赢取赌注，平局退还。", W / 2, 60, W - 50, 10);
      ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillStyle = "rgba(233,220,255,0.6)";
      ctx.fillText("押下赌注，开始比牌吧～", W / 2, 130);
    }

    const r = this._bufferNiuRects();
    if (g.phase === "bet") {
      this._button(ctx, r.betMinus, "－", PALETTE.cyan);
      ctx.fillStyle = PALETTE.text;
      ctx.font = "bold 12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(`押注 ${this.bufferBet}`, r.betLabel.x + r.betLabel.w / 2, r.betLabel.y + r.betLabel.h / 2);
      this._button(ctx, r.betPlus, "＋", PALETTE.cyan);
      this._button(ctx, r.betAll, "梭哈", PALETTE.gold);
      const disabled = this.bufferPlays.niuniu <= 0 || this.bufferBet <= 0 || this.bufferBet > this.bufferCoins;
      this._button(ctx, r.action, this.bufferPlays.niuniu <= 0 ? "次数已用完" : "开始比牌", disabled ? "rgba(233,220,255,0.35)" : "#ffcf5c");
    } else if (g.phase === "result") {
      this._button(ctx, r.action, "再来一局", "#ffcf5c");
    }
    this._button(ctx, r.back, "◀ 返回", PALETTE.neon);
    ctx.textAlign = "left";
  }

  _renderBufferShop(ctx, W, H) {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.gold;
    ctx.font = "bold 15px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText("🛒 道途商城", W / 2, 26);
    ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = "rgba(233,220,255,0.8)";
    ctx.fillText(`收集币 ${this.bufferCoins}（可重复进入）`, W / 2, 42);

    const items = this._bufferShopItems();
    const rects = this._bufferShopRects();
    for (let i = 0; i < items.length; i++) {
      const it = items[i], r = rects.items[i];
      const boughtOut = it.limit && (this.bufferShopBuys[it.id] || 0) >= it.limit;
      ctx.fillStyle = "rgba(42,26,58,0.9)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = boughtOut ? "rgba(233,220,255,0.3)" : it.color; ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = boughtOut ? "rgba(233,220,255,0.4)" : it.color;
      ctx.font = "13px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(it.icon, r.x + 9, r.y + r.h / 2 + 5);
      ctx.fillStyle = PALETTE.text;
      ctx.font = "bold 9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(it.name, r.x + 28, r.y + 13);
      ctx.font = "7.5px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillStyle = "rgba(233,220,255,0.7)";
      ctx.fillText(it.desc, r.x + 28, r.y + 24);
      ctx.textAlign = "right";
      ctx.fillStyle = boughtOut ? "rgba(233,220,255,0.4)" : PALETTE.gold;
      ctx.font = "bold 10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(boughtOut ? "已售罄" : `◈${it.cost}`, r.x + r.w - 8, r.y + 14);
      // 限购道具：右下角显示本轮已购/限购次数，与左侧描述文字不同水平区域，避免重叠
      if (it.limit) {
        ctx.font = "7px 'Microsoft YaHei', 'PingFang SC', sans-serif";
        ctx.fillStyle = "rgba(233,220,255,0.55)";
        ctx.fillText(`限购${this.bufferShopBuys[it.id] || 0}/${it.limit}`, r.x + r.w - 8, r.y + r.h - 5);
      }
    }

    if (this.bufferMsg) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = PALETTE.cyan;
      ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      const lastR = rects.items[rects.items.length - 1];
      ctx.fillText(this.bufferMsg, W / 2, lastR.y + lastR.h + 16);
    }

    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    this._button(ctx, rects.back, "◀ 返回", PALETTE.neon);
    ctx.textAlign = "left";
  }

  _renderGoal(ctx, W, H) {
    ctx.fillStyle = "rgba(20,10,31,0.78)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.gold;
    ctx.font = "bold 20px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.shadowColor = PALETTE.gold;
    ctx.shadowBlur = 10;
    ctx.fillText("试炼值已满！", W / 2, H * 0.4);
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.text;
    ctx.font = "12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText("准备迎战 Boss —— 选择你的武器", W / 2, H * 0.52);
    if (Math.floor(this.t * 2) % 2 === 0) {
      ctx.fillStyle = PALETTE.cyan;
      ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText("▼ 点击继续", W / 2, H * 0.62);
    }
    ctx.textAlign = "left";
  }

  // 魔女回廊 · 非Boss节点通关结算面板
  _renderTowerDone(ctx, W, H) {
    ctx.fillStyle = "rgba(20,10,31,0.82)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.gold;
    ctx.font = "bold 18px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.shadowColor = PALETTE.gold;
    ctx.shadowBlur = 10;
    const isElite = this.towerNode.type === "elite";
    ctx.fillText(isElite ? "精英试炼通过！" : "试炼战斗通过！", W / 2, H * 0.36);
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.cyan;
    ctx.font = "13px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText(`☾ 月光结晶 +${this._towerCrystalGain || 0}`, W / 2, H * 0.48);
    if (this._towerDrop) {
      ctx.fillStyle = this._towerDrop.color || PALETTE.text;
      ctx.font = "12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      const kind = REMAINS.some((r) => r.id === this._towerDrop.id) ? "圣骸" : "咒物";
      ctx.fillText(`获得${kind}「${this._towerDrop.icon || ""} ${this._towerDrop.name}」`, W / 2, H * 0.58);
    }
    if (Math.floor(this.t * 2) % 2 === 0) {
      ctx.fillStyle = "rgba(233,220,255,0.6)";
      ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText("▼ 点击返回回廊地图", W / 2, H * 0.68);
    }
    ctx.textAlign = "left";
  }

  _renderPause(ctx, W, H) {
    ctx.fillStyle = "rgba(20,10,31,0.82)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.neon;
    ctx.font = "bold 22px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.shadowColor = PALETTE.neon;
    ctx.shadowBlur = 8;
    ctx.fillText("暂停", W / 2, H * 0.32);
    ctx.shadowBlur = 0;

    const b = this._pauseMenuButtons();
    this._button(ctx, b.resume, "继续游戏", PALETTE.cyan);
    this._button(ctx, b.exit, "退出到主菜单", PALETTE.danger);

    ctx.fillStyle = "rgba(233,220,255,0.45)";
    ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText("P / Esc 继续", W / 2, H * 0.7);
    ctx.textAlign = "left";
  }

  _wrapText(ctx, text, cx, y, maxW, lh) {
    const chars = text.split("");
    let line = "";
    let yy = y;
    for (const ch of chars) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, cx, yy);
        line = ch;
        yy += lh;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, cx, yy);
  }

  _renderDead(ctx, W, H) {
    ctx.fillStyle = "rgba(20,10,31,0.72)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.danger;
    ctx.font = "bold 24px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText("试炼失败", W / 2, H * 0.24);
    ctx.fillStyle = PALETTE.text;
    ctx.font = "12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText(`最终形态  ${this.player.form.name}`, W / 2, H * 0.37);
    ctx.fillText(`本次分数  ${this.score}`, W / 2, H * 0.45);
    ctx.fillStyle = PALETTE.gold;
    ctx.font = "11px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText(`收集 ${this.collected}   金币 +${this.earned}   （共 ${this.save.coins}）`, W / 2, H * 0.53);
    ctx.fillStyle = "rgba(233,220,255,0.7)";
    ctx.fillText(`历史最高  ${this.hi}`, W / 2, H * 0.61);
    if (this.towerNode) {
      ctx.fillStyle = PALETTE.danger;
      ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText("身体彻底石化……魔女回廊的这次试炼就此终结", W / 2, H * 0.68);
    }

    if (this.deadT > 0.4) {
      const b = this._deadButtons();
      this._button(ctx, b.restart, this.towerNode ? "返回主菜单" : "重开", PALETTE.cyan);
      this._button(ctx, b.menu, "主菜单", PALETTE.neon);
    }
    ctx.textAlign = "left";
  }
}
