// 弹幕Boss 战场景（横屏）：
// - 玩家在左侧，上下移动(↑ ↓ / W S / 点击拖动)，自动/持续向右射击
// - Boss在右侧，依据 bosses.js 的 patterns 向左发射弹幕
// - 玩家子弹击中Boss 扣血，Boss 弹幕/接触扣玩家血
// - 击败Boss → 通关，解锁下一关；玩家血量耗尽 → 失败
// 肉鸽爽游调性：玩家血条长、攻击强，Boss 弹幕稀疏偏慢，打起来爽。
import { Scene } from "../engine/Scene.js";
import { PALETTE } from "../engine/Game.js";
import { Particles } from "../systems/Particles.js";
import { Save } from "../systems/Save.js";
import { getLevelBoss, getLevel, TOTAL_LEVELS } from "../data/levels.js";
import { getSkin } from "../data/skins.js";
import { getWitchSprite, WITCH_SPRITES_ENABLED } from "../systems/WitchSprites.js";
import { getBossSprite } from "../systems/BossSprites.js";
import { Difficulty } from "../data/difficulty.js";
import { ACHIEVEMENTS } from "../data/achievements.js";
import { MenuScene } from "./MenuScene.js";
import { audio } from "../engine/Audio.js";
import { TowerRun } from "../systems/TowerRun.js";
import { REMAINS } from "../data/curses.js";

// 全局难度系数（肉鸽爽游：玩家肉、能连续输出，Boss 耐打能撑30秒+、弹幕稀疏好躲）
const PLAYER_MAX_HP = 40;         // 玩家基础血量（长血条，很肉）
const BOSS_HP_SCALE = 1;          // Boss 血量整体缩放（血量在 bosses.js 里已调到能撑 30s+）
const BOSS_BULLET_SPEED_SCALE = 0.6;  // Boss 弹幕速度缩放（越小越慢越好躲）
const BOSS_INTERVAL_SCALE = 1.4;  // Boss 弹幕间隔缩放（越大越稀疏）
const PLAYER_DMG_SCALE = 1;       // 玩家武器伤害系数（血量已按此系数配平）
const PLAYER_HIT_DMG = 1;         // 玩家每次被击扣血
const PLAYER_INVULN = 1.0;        // 受击无敌时间

export class BossScene extends Scene {
  constructor(game, level, weapon, carry = {}) {
    super(game);
    this.level = level;
    this.weapon = weapon;
    this.carry = carry;
    this.towerNode = (carry && carry.towerNode) || null;
    this.endless = !!(level && level.endless);
    this.round = (carry && carry.round) || level.round || 1;
    this.save = Save.load();
    this.boss = getLevelBoss(level);
    this.particles = new Particles();
    // ===== 难度 =====
    this.diff = Difficulty.get();

    const W = game.width, H = game.height;

    // 玩家（左侧，纵向移动）
    // 地狱难度：3 血制（开局三滴血），撞满即败；普通：长血条 40。
    const baseHp = this.diff.bossLifeMode ? this.diff.bossLives : PLAYER_MAX_HP;
    this.player = {
      x: 46, y: H / 2, w: 18, h: 16,
    hp: baseHp, maxHp: baseHp,
      speed: 210,
 invuln: 0,
      fireCd: 0,
      // 东方式判定点：真实受弹半径远小于角色贴图（贴图只是"外观"，
      // 只有中心这个高亮小圆点才会真正碰到弹幕），躲弹更精确、更爽快。
      hitR: 3,
    };
    // ===== Buff 属性叠加进 Boss 战（无限模式下随轮次不断变强）=====
    const B = (carry && carry.buffs) || {};
  // 护盾结界：受伤减半 → 换算成更多血量（地狱 3 血制下不加血，保持生死张力）
    const guard = B.guard || 0;
    if (guard > 0 && !this.diff.bossLifeMode) { this.player.maxHp += guard * 4; this.player.hp += guard * 4; }
    // 缓冲休息区道具「Boss战·开局无敌」：每层 +3 秒开局无敌
    const bossInvulnStacks = B.bossInvuln || 0;
    if (bossInvulnStacks > 0) this.player.invuln = bossInvulnStacks * 3;
    // 迅捷：射速加成（每层 +8%，boss 战体现为冷却缩短）
    this.hasteMul = 1 + (B.haste || 0) * 0.08;
    // 双倍/破障：转化为额外伤害倍率（每层 +12%）
    this.dmgBuffMul = 1 + ((B.double || 0) + (B.smash || 0)) * 0.12;
    // 幸运：略微提升六芒星生成频率
    this.starLuck = (B.lucky || 0);

    // 星辰牵引：每层召唤一颗跟随玩家的绿色小星星，在 Boss 战协同攻击
    // （伤害约为玩家单发的 0.5 倍）
    this.companions = [];
    const magnetLv = B.magnet || 0;
    for (let i = 0; i < magnetLv; i++) {
      this.companions.push({
        // 环绕玩家的相位/半径，营造"跟随"感
        ang: (Math.PI * 2 * i) / Math.max(1, magnetLv),
        orbitR: 26 + i * 6,
        x: this.player.x, y: this.player.y,
        fireCd: 0.5 + i * 0.15, // 错开开火节奏
        spin: 0,
      });
    }

    // ===== 先天角色能力：海於专属契约鲸鱼，Boss 战中协同攻击 =====
    const charSkin = getSkin("character", this.save.equipped.character);
    if (charSkin && charSkin.pet) {
      this.companions.push({
        innate: true,
        color: charSkin.pet.color,
        ang: Math.PI, // 从与星星相反的方位起步，视觉上不重叠
        orbitR: 30,
        x: this.player.x, y: this.player.y,
        fireCd: 0.4,
        spin: 0,
      });
    }

    // ===== 魔女回廊 · "沉眠之眼"圣骸：召出协同攻击的幻影，但自身输出略微削弱 =====
    if (this.towerNode && TowerRun.hasCompanionRemain()) {
      this.companions.push({
        color: "#5cc8ff",
        ang: Math.PI * 0.5,
        orbitR: 34,
        x: this.player.x, y: this.player.y,
        fireCd: 0.5,
        spin: 0,
      });
      this.dmgBuffMul *= 0.85;
    }

    // Boss 状态（右侧）  地狱难度：血量 ×3
    this.bhp = Math.max(20, Math.round(this.boss.hp * BOSS_HP_SCALE * this.diff.bossHpMul));
    this.bMaxHp = this.bhp;
    this.bx = W - 70;
    this.by = H / 2;
    this.bw = 46; this.bh = 46;
    this.bDir = 1;
    this.bTeleT = 0;
    this.spiralAng = 0;
    // 弹幕 pattern 列表：地狱难度额外追加一道 Boss 专属"符卡"式弹幕
    // （环形缺口/双臂交织螺旋等有明确规律、可读可练的攻击，而不是单纯把普通弹幕调快调密）
    this.patterns = this.boss.patterns.slice();
    if (this.diff.id === "hell" && this.boss.hellPattern) {
      this.patterns.push(this.boss.hellPattern);
    }
    // 每个 pattern 独立计时器
    this.patTimers = this.patterns.map(() => 0);

    // ===== 开场"热身"小技能：血量首次掉到 85% 时额外追加一波弹幕 =====
    // 全难度通用（不受"地狱难度专属"限制），只是在常规弹幕节奏之上插入一次
    // 一次性的、更有辨识度的小爆发，作为战斗刚开局不久的一个小高潮点；
    // 不暂停常规弹幕、不显示符卡横幅，纯粹是"这个 Boss 亮了下招牌动作"。
    this.warmupSkill = this.boss.warmupSkill || null;
    this.warmupTriggered = false;

    this.playerBullets = [];
    this.bossBullets = [];

    // ===== 六芒星特殊道具 =====
    this.stars = [];           // 场上漂浮的六芒星
    this.starSpawnT = 0;       // 生成计时
    this.starInterval = Math.max(2.2, 4.5 - (this.starLuck || 0) * 0.4);   // 幸运越高越勤
    this.starCollected = 0;    // 已收集数量
    this.powerT = 0;           // 六芒星增益（火力狂暴）剩余时间
    // 地狱难度：六芒星出现频率大幅降低——整局只出现一次，
    // 且触发时机改为"Boss 血量掉到半血左右"（而非固定时间），命中战斗节奏更合理，
    // 也让"半血无敌"成为一次有战术意义的救场机会。
    this.hellStarOnce = !!this.diff.bossLifeMode;
    this.hellStarSpawned = false;      // 是否已生成过那唯一一次
    this.hellStarHpRatio = 0.46 + Math.random() * 0.08; // 46%~54%，即"半血左右"

    // ===== 地狱难度：Boss 大招符卡（参考东方 Project 符卡系统）=====
    // 血量每掉到一个阈值就触发一次：暂停常规弹幕，改为播放编排好的多段攻击循环，
    // 并在屏幕上展示符卡名，持续一段时间后自动结束、恢复常规攻击。
    // 半血(50%)一次，残血(15%)"背水一战"再来一发——越到残局越有压迫感。
    this.ultimate = (this.diff.id === "hell" && this.boss.ultimate) ? this.boss.ultimate : null;
    this.ultimateThresholds = [0.5, 0.15];
    this.ultimateTriggerIdx = 0;   // 已触发过几次（用于依次比对 thresholds）
    this.ultimateActive = false;
    this.ultimateT = 0;
    this.ultimateLoopTimers = this.ultimate ? this.ultimate.loop.map(() => 0) : [];
    this.ultimateNameT = 0;   // 符卡名横幅淡入淡出计时

    this.state = "fight";// fight | win | lose | paused
    this.t = 0;
    this.endT = 0;
    // 黄金魔女先天技能「点石成金」：通关奖励的金币数量翻倍（coinMultiplier 来自 skins.js）
    const charSkinForReward = getSkin("character", this.save.equipped.character);
    this.coinMultiplier = (charSkinForReward && charSkinForReward.coinMultiplier) || 1;
    this.reward = (level.reward || 30) * this.coinMultiplier;
  }

  _pauseBtn() { return { x: this.game.width - 26, y: 8, w: 18, h: 16 }; }
  _pauseMenuButtons() {
    const W = this.game.width, H = this.game.height;
    return {
      resume: { x: W / 2 - 70, y: H * 0.46, w: 140, h: 26 },
      exit: { x: W / 2 - 70, y: H * 0.46 + 34, w: 140, h: 26 },
    };
  }
  _endButtons() {
    const W = this.game.width, H = this.game.height;
    return {
      next: { x: W / 2 - 86, y: H * 0.72, w: 80, h: 24 },
      menu: { x: W / 2 + 6, y: H * 0.72, w: 80, h: 24 },
    };
  }

  update(dt, input) {
    this.t += dt;

    // 进入 Boss 战 / 武器选择 后的首次"输入缓冲"：0.4 秒内忽略回车/点击，
    // 避免上一场景（结算点"下一关"按钮）的最后一次 tap 被原样带进来，
    // 触发"刚切进武器选择就立刻被确认"——手机端关卡衔接 Bug 的根因之一。
    if (this._guardT == null) this._guardT = 0.4;
    if (this._guardT > 0) this._guardT -= dt;

    if (this.state === "paused") {
      const b = this._pauseMenuButtons();
      if (input.justPressed("p", "escape") || input.tapIn(b.resume)) { audio.play("click"); this.state = "fight"; }
      else if (input.tapIn(b.exit)) { audio.play("click"); this.game.changeScene(new MenuScene(this.game)); }
      return;
    }

    if (this.state === "win" || this.state === "lose") {
      this.endT += dt;
      this.particles.update(dt);
      this._updateBullets(dt, true);
      // 结算时同样需要输入缓冲，否则"刚结束"那帧回车/点击会直接进入下一场景
      if (this.endT > 0.5 && !this._navigating && this._guardT <= 0) {
        const b = this._endButtons();
        if (this.state === "win") {
          if (input.justPressed("enter", " ") || input.tapIn(b.next)) { this._navigating = true; audio.play("click"); this._goNext(); }
          else if (input.justPressed("escape") || input.tapIn(b.menu)) { this._navigating = true; audio.play("click"); this._goSelect(); }
        } else {
          if (input.justPressed("enter", " ") || input.tapIn(b.next)) {
            this._navigating = true; audio.play("click");
            if (this.towerNode) this.game.changeScene(new MenuScene(this.game));
            else this._retry();
          }
          else if (input.justPressed("escape") || input.tapIn(b.menu)) { this._navigating = true; audio.play("click"); this.game.changeScene(new MenuScene(this.game)); }
        }
      }
      return;
    }

    // 暂停
    if (input.justPressed("p", "escape") || input.tapIn(this._pauseBtn())) {
      audio.play("click");
      this.state = "paused";
      return;
    }

    // ===== 玩家移动（前后左右四方向）=====
    const p = this.player;
    let dy = 0, dx = 0;
    if (input.isDown("arrowup", "w")) dy -= 1;
    if (input.isDown("arrowdown", "s")) dy += 1;
    if (input.isDown("arrowleft", "a")) dx -= 1;
    if (input.isDown("arrowright", "d")) dx += 1;
    // 归一化斜向速度
    if (dx !== 0 && dy !== 0) { const inv = 0.7071; dx *= inv; dy *= inv; }
    p.x += dx * p.speed * dt;
    p.y += dy * p.speed * dt;
    // 指针拖动控制（可任意方向移动到指针处）
    if (input.pointer.down) {
      p.x += (input.pointer.x - p.x) * Math.min(1, 12 * dt);
      p.y += (input.pointer.y - p.y) * Math.min(1, 12 * dt);
    }
    // 活动范围：左侧 ~ 屏幕中线偏右一点（不能贴到 Boss 身上）
    const W = this.game.width, H = this.game.height;
    p.x = Math.max(p.w / 2 + 8, Math.min(W * 0.62, p.x));
    p.y = Math.max(p.h / 2 + 20, Math.min(H - p.h / 2 - 8, p.y));
    if (p.invuln > 0) p.invuln -= dt;

    // ===== 射击（持续自动开火，向右）=====
    p.fireCd -= dt;
    if (p.fireCd <= 0) {
      this._fire();
      // 六芒星狂暴时射速翻倍；迅捷 buff 额外缩短冷却
   p.fireCd = this.weapon.cooldown / this.hasteMul * (this.powerT > 0 ? 0.5 : 1);
    }

    // ===== 星辰牵引小星星：环绕玩家 + 协同开火 =====
    this._updateCompanions(dt);

    // ===== Boss移动 =====
    this._updateBoss(dt);

    // ===== 开场热身小技能：血量首次掉到 85% 时先放一波（所有难度通用）=====
    this._updateWarmupSkill();

    // ===== Boss 大招符卡：血量掉到阈值时触发（仅地狱难度）=====
    this._updateUltimateTrigger();

    // ===== Boss 弹幕生成：大招进行中改为播放符卡循环，否则走常规弹幕 =====
    if (this.ultimateActive) this._updateUltimatePatterns(dt);
    else this._updatePatterns(dt);

    // ===== 子弹推进与碰撞 =====
    this._updateBullets(dt, false);

    // ===== 六芒星道具 =====
    this._updateStars(dt);
    if (this.powerT > 0) this.powerT -= dt;

    this.particles.update(dt);
  }

  _updateStars(dt) {
    const W = this.game.width, H = this.game.height;
    // 生成逻辑：
    // - 地狱难度：整局只出现一次，在 Boss 血量掉到半血左右（hellStarHpRatio）时触发，
    //   而不是固定时间——契合"打到一半给一次无敌喘息"的设计意图
    // - 普通难度：按 starInterval 周期性生成
    if (this.hellStarOnce) {
      if (!this.hellStarSpawned && this.bhp > 0 && this.bhp <= this.bMaxHp * this.hellStarHpRatio) {
        this.hellStarSpawned = true;
        this._spawnStar();
      }
    } else {
      this.starSpawnT += dt;
      if (this.starSpawnT >= this.starInterval) {
        this.starSpawnT = 0;
        this._spawnStar();
      }
    }
    const p = this.player;
    for (const s of this.stars) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.spin += dt * 2;
      s.life -= dt;
      // 轻微上下漂浮
      s.y += Math.sin(this.t * 3 + s.x * 0.05) * 8 * dt;
      if (s.y < 40) s.vy = Math.abs(s.vy);
      if (s.y > H - 30) s.vy = -Math.abs(s.vy);
      if (s.x < -20 || s.life <= 0) s.dead = true;
      // 拾取判定
      if (!s.dead && Math.abs(s.x - p.x) < (p.w / 2 + s.r) && Math.abs(s.y - p.y) < (p.h / 2 + s.r)) {
        s.dead = true;
        this._collectStar();
      }
    }
    this.stars = this.stars.filter((s) => !s.dead);
  }

  _spawnStar() {
    const H = this.game.height;
    this.stars.push({
      x: this.bx - 20,
      y: 60 + Math.random() * (H - 120),
      vx: -(46 + Math.random() * 24),
      vy: (Math.random() - 0.5) * 30,
      r: 10,
      spin: 0,
      // 地狱唯一星停留更久，给玩家足够时间接住
      life: this.hellStarOnce ? 18 : 12,
      dead: false,
    });
  }

  // 收集六芒星：回血 + 触发短暂火力狂暴（地狱难度额外给短暂无敌）
  _collectStar() {
    const p = this.player;
    this.starCollected++;
    Save.recordCollect(this.save, 1);
    Save.addHexagram(this.save, 1); // 六芒星：独立于金币的收集货币，用于商店解锁武器
    audio.play("rareStar");
    // 回血：普通 +6；地狱 3 血制下最多回 1 滴（避免瞬间回满，无敌才是核心收益）
    p.hp = Math.min(p.maxHp, p.hp + (this.diff.bossLifeMode ? 1 : 6));
    // 火力狂暴 5 秒（叠加时间）
    this.powerT = Math.min(12, this.powerT + 5);
    // 地狱难度：拾取后短暂无敌
    if (this.diff.starInvuln > 0) {
      p.invuln = Math.max(p.invuln, this.diff.starInvuln);
    }
    this.particles.burst(p.x, p.y, "#ffd94a", 26, { speed: 180, life: 0.7, size: 3 });
    this.particles.burst(p.x, p.y, "#ffffff", 12, { speed: 120, life: 0.4, size: 2 });
  }

  _fire() {
    const p = this.player;
    const w = this.weapon;
    const bx = p.x + p.w / 2, by = p.y;
    const dmg = w.damage * PLAYER_DMG_SCALE * this.dmgBuffMul * (this.powerT > 0 ? 2 : 1);
    const col = this.powerT > 0 ? "#ffd94a" : w.color;
    // 向右发射（vx 为正）
    const mk = (vx, vy, homing = false) => ({
      x: bx, y: by, vx, vy, r: this.powerT > 0 ? 5 : 4, dmg, color: col, homing, dead: false,
    });
    if (w.fireMode === "single") {
      this.playerBullets.push(mk(w.bulletSpeed, 0));
    } else if (w.fireMode === "spread") {
      // 三发扇形弹，且各自持续外扩(curve)——距离越远越分散，特色弹道
      for (const a of [-0.28, 0, 0.28]) {
        const b = mk(Math.cos(a) * w.bulletSpeed, Math.sin(a) * w.bulletSpeed);
        b.curve = a === 0 ? 0 : Math.sign(a) * (w.spreadCurve || 0);
        this.playerBullets.push(b);
      }
    } else if (w.fireMode === "beam") {
      // 高伤贯穿大弹：只对Boss结算一次伤害(hitOnce,见_updateBullets)，且飞行途中持续加速
      const b = mk(w.bulletSpeed, 0); b.r = 7; b.pierce = true; b.accel = w.beamAccel || 0;
      this.playerBullets.push(b);
    } else if (w.fireMode === "homing") {
      this.playerBullets.push(mk(w.bulletSpeed, 0, true));
    }
    this.particles.burst(bx, by, w.color, 4, { speed: 60, life: 0.2, size: 2 });
  }

  // 星辰牵引小星星：绕玩家旋转跟随；持续向Boss 发射绿色小弹（0.5 倍玩家伤害）
  _updateCompanions(dt) {
    if (!this.companions || !this.companions.length) return;
    const p = this.player;
    const w = this.weapon;
    // 单发基础伤害（含 buff 与狂暴），星星取其一半
    const baseDmg = w.damage * PLAYER_DMG_SCALE * this.dmgBuffMul * (this.powerT > 0 ? 2 : 1);
    const starDmg = baseDmg * 0.5;
    const interval = (this.weapon.cooldown / this.hasteMul) * (this.powerT > 0 ? 0.5 : 1) * 1.3; // 略慢于玩家
    for (const c of this.companions) {
      c.ang += dt * 2.4;
      c.spin += dt * 3;
      // 平滑跟随到环绕位置
      const tx = p.x + Math.cos(c.ang) * c.orbitR;
      const ty = p.y + Math.sin(c.ang) * (c.orbitR * 0.6);
      c.x += (tx - c.x) * Math.min(1, 10 * dt);
      c.y += (ty - c.y) * Math.min(1, 10 * dt);
      // 开火
      c.fireCd -= dt;
      if (c.fireCd <= 0) {
        c.fireCd = interval;
        this.playerBullets.push({
          x: c.x, y: c.y,
          vx: w.bulletSpeed * 0.95, vy: 0,
          r: 3, dmg: starDmg, color: c.color || "#5cff9a",
          homing: false, dead: false, fromCompanion: true,
        });
        this.particles.burst(c.x, c.y, c.color || "#5cff9a", 3, { speed: 50, life: 0.18, size: 2 });
      }
    }
  }

  _renderCompanions(ctx) {
    if (!this.companions || !this.companions.length) return;
    for (const c of this.companions) {
      if (c.innate) this._renderPetCompanion(ctx, c);
      else this._renderStarCompanion(ctx, c);
    }
  }

  _renderStarCompanion(ctx, c) {
    ctx.save();
    ctx.translate(Math.round(c.x), Math.round(c.y));
    ctx.rotate(c.spin);
    ctx.fillStyle = "#5cff9a";
    ctx.shadowColor = "#5cff9a";
    ctx.shadowBlur = 8;
    // 简易五角星
    const R =5, r = 2.2;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? R : r;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // 契约鲸鱼协同攻击造型（海於专属）：小鲸鱼跟随玩家一起对 Boss 开火
  _renderPetCompanion(ctx, c) {
    const col = c.color || "#4fc3ff";
    ctx.save();
    ctx.translate(Math.round(c.x), Math.round(c.y));
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(-12, -4);
    ctx.lineTo(-12, 4);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  _updateBoss(dt) {
    const H = this.game.height;
    const b = this.boss;
    const spd = b.moveSpeed * 0.8; // 略降移动速度
    if (b.moveMode === "sway") {
      this.by += this.bDir * spd * dt;
      if (this.by < 60) { this.by = 60; this.bDir = 1; }
      if (this.by > H - 60) { this.by = H - 60; this.bDir = -1; }
    } else if (b.moveMode === "chase") {
      const dy = this.player.y - this.by;
      this.by += Math.sign(dy) * Math.min(Math.abs(dy), spd * dt);
      this.by = Math.max(60, Math.min(H - 60, this.by));
    } else if (b.moveMode === "teleport") {
      this.bTeleT += dt;
      if (this.bTeleT > 2.6) {
        this.bTeleT = 0;
        this.by = 70 + Math.random() * (H - 140);
        this.particles.burst(this.bx, this.by, b.color, 16, { speed: 120, life: 0.5 });
      }
    }
    //轻微左右浮动
    this.bx = (this.game.width - 70) + Math.sin(this.t * 1.5) * 6;
  }

  // 触发判定：Boss 血量首次掉到 85% 时，额外追加一波"热身"小技能弹幕。
  // 与大招符卡不同——只是插入一次 _emitPattern，不暂停常规弹幕、不进入"符卡状态"、
  // 不显示横幅，全难度通用，纯粹作为开局不久的一个小节奏点缀。
  _updateWarmupSkill() {
    if (!this.warmupSkill || this.warmupTriggered) return;
    if (this.bhp > 0 && this.bhp <= this.bMaxHp * 0.85) {
      this.warmupTriggered = true;
      this._emitPattern(this.warmupSkill);
      this.particles.burst(this.bx, this.by, this.boss.color, 20, { speed: 150, life: 0.6, size: 2.5 });
    }
  }

  // 触发判定：Boss 血量每掉到一个阈值（50% → 15%）就触发一次大招符卡
  _updateUltimateTrigger() {
    if (!this.ultimate || this.ultimateTriggerIdx >= this.ultimateThresholds.length) return;
    const ratio = this.ultimateThresholds[this.ultimateTriggerIdx];
    if (this.bhp > 0 && this.bhp <= this.bMaxHp * ratio) {
      this.ultimateTriggerIdx++;
      this.ultimateActive = true;
      this.ultimateT = 0;
      this.ultimateLoopTimers = this.ultimate.loop.map(() => 0);
      this.ultimateNameT = 3; // 符卡名横幅展示 3 秒
      audio.play("rareStar");
      this.particles.burst(this.bx, this.by, this.boss.color, 40, { speed: 200, life: 0.8, size: 3 });
    }
  }

  // 大招符卡进行中：按编排好的循环节奏播放多段攻击，时间到自动结束、恢复常规弹幕
  _updateUltimatePatterns(dt) {
    this.ultimateT += dt;
    const loop = this.ultimate.loop;
    for (let i = 0; i < loop.length; i++) {
      const pat = loop[i];
      this.ultimateLoopTimers[i] += dt;
      if (this.ultimateLoopTimers[i] >= pat.interval) {
        this.ultimateLoopTimers[i] = 0;
        // 大招弹幕使用专属高亮配色（多色 + 白色描边发光），一眼就能看出"这是大招"
        this._emitPattern(pat, this.ultimate.colors);
      }
    }
    if (this.ultimateNameT > 0) this.ultimateNameT -= dt;
    if (this.ultimateT >= this.ultimate.duration) {
      this.ultimateActive = false;
      // 大招结束后重置常规弹幕计时，避免恢复瞬间叠加一次额外攻击
      this.patTimers = this.patterns.map(() => 0);
    }
  }

  _updatePatterns(dt) {
    const patterns = this.patterns;
    for (let i = 0; i < patterns.length; i++) {
      const pat = patterns[i];
      this.patTimers[i] += dt;
      // 地狱难度：攻击频率加快（间隔缩短）
      const interval = pat.interval * BOSS_INTERVAL_SCALE * this.diff.bossIntervalMul;
      if (this.patTimers[i] >= interval) {
        this.patTimers[i] = 0;
        this._emitPattern(pat);
      }
    }
  }

  // colorOverride：大招符卡专用的多色数组（按发射顺序轮流取色 + 高亮发光），
  // 不传则沿用 Boss 主题色（常规弹幕原有效果不变）。
  _emitPattern(pat, colorOverride) {
    const ox = this.bx - this.bw / 2, oy = this.by;
    // 地狱难度：弹速加快
    const spd = pat.bulletSpeed * BOSS_BULLET_SPEED_SCALE * this.diff.bossBulletSpeedMul;
    const colors = colorOverride && colorOverride.length ? colorOverride : [this.boss.color];
    const glow = !!colorOverride;
    let ci = 0;
    const push = (vx, vy) => {
      const color = colors[ci % colors.length]; ci++;
      this.bossBullets.push({ x: ox, y: oy, vx, vy, r: glow ? 5 : 4, color, glow, dead: false });
    };

    if (pat.type === "aimed") {
      const ang = Math.atan2(this.player.y - oy, this.player.x - ox);
      const n = pat.count || 1;
      for (let i = 0; i < n; i++) {
        const a = ang + (i - (n - 1) / 2) * 0.12;
        push(Math.cos(a) * spd, Math.sin(a) * spd);
      }
    } else if (pat.type === "spread") {
      const n = pat.count, half = ((pat.spreadDeg || 60) * Math.PI / 180) / 2;
      const base = Math.PI; // 向左
      for (let i = 0; i < n; i++) {
        const a = base - half + (2 * half) * (n === 1 ? 0.5 : i / (n - 1));
        push(Math.cos(a) * spd, Math.sin(a) * spd);
      }
    } else if (pat.type === "wave") {
      const n = pat.count, half = ((pat.spreadDeg || 90) * Math.PI / 180) / 2;
      const base = Math.PI + Math.sin(this.t * 2) * 0.4; // 向左摆动
      for (let i = 0; i < n; i++) {
        const a = base - half + (2 * half) * (i / (n - 1));
        push(Math.cos(a) * spd, Math.sin(a) * spd);
      }
    } else if (pat.type === "ring") {
      const n = pat.count;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        push(Math.cos(a) * spd, Math.sin(a) * spd);
      }
    } else if (pat.type === "spiral") {
      const n = pat.count;
      for (let i = 0; i < n; i++) {
        const a = this.spiralAng + (i / n) * Math.PI * 2;
        push(Math.cos(a) * spd, Math.sin(a) * spd);
      }
      this.spiralAng += 0.5;
    } else if (pat.type === "ringGap") {
      // 东方式"符卡"：环形弹幕带一道缺口，缺口位置每次发射都旋转一点，
      // 玩家需要持续追踪缺口走位才能穿过——有明确规律、可读可练，比单纯堆弹幕量更有逻辑。
      const n = pat.count;
      const gap = ((pat.gapDeg || 55) * Math.PI) / 180;
      this._ringGapAng = (this._ringGapAng || 0) + (pat.gapRotate || 0.5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        let da = a - this._ringGapAng;
        da = ((da % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (da < gap) continue; // 缺口扇区不发弹
        push(Math.cos(a) * spd, Math.sin(a) * spd);
      }
    } else if (pat.type === "crossSpiral") {
      // 东方式"符卡"：双臂反向旋转螺旋交织成花瓣状弹幕网，密度更高但左右对称、规律清晰，
      // 玩家可通过观察两组弹道的交叉节奏找到穿行时机。
      const n = pat.count;
      for (let i = 0; i < n; i++) {
        const a1 = this.spiralAng + (i / n) * Math.PI * 2;
        const a2 = -this.spiralAng + (i / n) * Math.PI * 2 + Math.PI / n;
        push(Math.cos(a1) * spd, Math.sin(a1) * spd);
        push(Math.cos(a2) * spd, Math.sin(a2) * spd);
      }
      this.spiralAng += 0.5;
    }
  }

  _updateBullets(dt, endMode) {
    const W = this.game.width, H = this.game.height;

    // 玩家子弹
    for (const b of this.playerBullets) {
      if (b.homing && this.state === "fight") {
        const ang = Math.atan2(this.by - b.y, this.bx - b.x);
        const cur = Math.atan2(b.vy, b.vx);
        const spd = Math.hypot(b.vx, b.vy);
        const na = cur + Math.max(-3 * dt, Math.min(3 * dt, ang - cur));
        b.vx = Math.cos(na) * spd; b.vy = Math.sin(na) * spd;
      }
      // 群星散射的特色弹道：持续向外扩散（curve 为加速度 px/s²）
      if (b.curve) b.vy += b.curve * dt;
      // 月光贯穿的特色弹道：飞行途中持续加速
      if (b.accel) b.vx += b.accel * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < -10 || b.x > W + 10 || b.y < -10 || b.y > H + 10) b.dead = true;
    }
    // 玩家子弹 vs Boss
    if (!endMode && this.state === "fight") {
      for (const b of this.playerBullets) {
        if (b.dead || b.hitOnce) continue;
        if (Math.abs(b.x - this.bx) < this.bw / 2 && Math.abs(b.y - this.by) < this.bh / 2) {
          this.bhp -= b.dmg;
          this.particles.burst(b.x, b.y, b.color, 6, { speed: 80, life: 0.3, size: 2 });
          // 贯穿弹只结算一次伤害后继续飞行(不再重复触发)，非贯穿弹直接消失——
          // 修复此前贯穿弹每帧重叠都扣血、实际伤害远超数值面板的问题
          if (b.pierce) b.hitOnce = true;
          else b.dead = true;
          if (this.bhp <= 0) { this._win(); break; }
        }
      }
    }
    this.playerBullets = this.playerBullets.filter((b) => !b.dead);

    // Boss 子弹
    for (const b of this.bossBullets) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < -10 || b.x > W + 10 || b.y < -10 || b.y > H + 10) b.dead = true;
    }
    // Boss 子弹 vs 玩家：东方式判定，只用玩家中心的高亮小圆点(hitR)做圆形碰撞，
    // 远小于角色贴图视觉范围，躲弹判定更精确（贴图只是外观，不代表真实受弹范围）。
    if (!endMode && this.state === "fight") {
      const p = this.player;
      for (const b of this.bossBullets) {
        if (b.dead) continue;
        const dx = b.x - p.x, dy = b.y - p.y;
        const rr = p.hitR + b.r * 0.5; // 子弹判定也只取一半视觉半径，避免"看起来没碰到却扣血"
        if (dx * dx + dy * dy < rr * rr) {
          b.dead = true;
          if (p.invuln <= 0) {
            p.hp -= PLAYER_HIT_DMG;
            p.invuln = PLAYER_INVULN;
            Save.recordBossHit(this.save);
            audio.play("hit");
            this.particles.burst(p.x, p.y, PALETTE.danger, 12, { speed: 110, life: 0.5, size: 3 });
            if (p.hp <= 0) this._lose();
          }
        }
      }
    }
    this.bossBullets = this.bossBullets.filter((b) => !b.dead);
  }

  _win() {
    this.state = "win";
    this.endT = 0;
    this.stars = [];
    this.particles.burst(this.bx, this.by, PALETTE.gold, 40, { speed: 180, life: 1.0, size: 3 });

    // ===== 魔女回廊 · 回廊主宰战胜利：独立经济结算，不写入主线存档进度 =====
    if (this.towerNode) {
      const baseGain = Math.round(this.reward * 1.4 * TowerRun.rewardMul());
      const before = TowerRun.state.crystals;
      TowerRun.addCrystals(baseGain);
      this._towerCrystalGain = TowerRun.state.crystals - before;
      this._towerDrop = Math.random() < 0.7 ? TowerRun.grantRandomItem("rare") : null;
      TowerRun.markNodeDone(this.towerNode.id);
      TowerRun.moveTo(this.towerNode.id);
      this._towerIsLastFloor = TowerRun.state.floor >= TowerRun.state.totalFloors;
      this._nextPromise = import("./TowerScene.js").catch((e) => {
        console.warn("[BossScene] 预加载 TowerScene 失败，将在切换时重试", e);
        return null;
      });
      return;
    }

    if (this.endless) {
      // 无限模式：不解锁关卡，仅累加金币奖励并存档
      this.save.coins += this.reward;
      this.save.statCoinsTotal = (this.save.statCoinsTotal || 0) + this.reward;
      // 更新无限模式最高轮次
      if ((this.save.statBestEndlessRound || 0) < this.round) {
        this.save.statBestEndlessRound = this.round;
      }
      // 记录本局无限模式轮次
      if (this.save.runStats) this.save.runStats.bossEndlessRound = this.round;
      Save.save(this.save);
    } else {
      // 记录通关 + 奖励 + 解锁下一关
      Save.clearLevel(this.save, this.level.id, this.level.index, TOTAL_LEVELS, this.reward);
      // 地狱难度：累计通关关卡
      if (this.diff.id === "hell") {
        this.save.statHellCleared = (this.save.statHellCleared || 0) + 1;
      }
      // 记录本局通关关卡id
      if (this.save.runStats && !(this.save.runStats.clearedLevelIds || []).includes(this.level.id)) {
        if (!this.save.runStats.clearedLevelIds) this.save.runStats.clearedLevelIds = [];
        this.save.runStats.clearedLevelIds.push(this.level.id);
      }
      Save.save(this.save);
    }
    // 记录通关时的护盾结界层数（成就"电波系"用）
    if (this.save.runStats) this.save.runStats.guardStacks = (this.carry.buffs && this.carry.buffs.guard) || 0;
    // ===== 成就结算检查 =====
    // Boss战不受伤通关
    if (this.save.runStats && (this.save.runStats.bossHits || 0) === 0 && !this.endless) {
      this.save.statBossClearNoHit = (this.save.statBossClearNoHit || 0) + 1;
    }
    // 撞满血量上限仍通关（地狱"永不退缩"）：RunScene 端统计的 hitsTaken 通过 carry 传不过来，
    // 简化处理：只要 hitsTaken 不存在就跳过；保留口子留给后续 RunScene 写入。
    // 跑酷无伤通关（无限模式不算）——需要 RunScene 端把"无伤通关"写进 runStats，
    // 这里由 Save.checkAchievements 在结算时统一读取并计算。
    if (this.save.runStats) {
      // 本局是否无伤：障碍撞击=0 且 boss 受击=0
      const noObstacleHit = (this.save.runStats.obstacleHits || 0) === 0;
      const noBossHit = (this.save.runStats.bossHits || 0) === 0;
      if (!this.endless && noObstacleHit && noBossHit) {
        this.save.statClearWithoutHit = (this.save.statClearWithoutHit || 0) + 1;
      }
      // 撞满血量上限仍通关（地狱）——需要在 RunScene 端判断并写入 statFullBloodClear。
      // 这里仅在 RunScene 已写入的前提下生效。
    }
    // 666 倍数金币 / 护盾 ≥6 / 终极甜蜜 触发判定（普通模式才统计666等）
    if (!this.endless) {
      const finalCoins = this.save.coins;
      if (finalCoins > 0 && finalCoins % 666 === 0) {
        this.save.statCoins666 = (this.save.statCoins666 || 0) + 1;
      }
      const guard = (this.carry.buffs && this.carry.buffs.guard) || 0;
      if (guard >= 6) {
        this.save.statGuard6 = (this.save.statGuard6 || 0) + 1;
      }
      // 一周目通关（5 关都打过）
      if ((this.save.runStats.clearedLevelIds || []).length >= 5) {
        this.save.statOneShotClear = (this.save.statOneShotClear || 0) + 1;
      }
      // 终极甜蜜：通关 + 黄金魔女皮肤已解锁
      if ((this.save.owned.character || []).includes("gold")) {
        this.save.statFinalSweet = (this.save.statFinalSweet || 0) + 1;
      }
    }
    Save.save(this.save);
    // 触发成就解锁
    const newly = Save.checkAchievements(this.save, ACHIEVEMENTS);
    if (newly.length) this._newAchievements = newly;
    // 胜利判定出来就立刻在后台预取"下一步"要用到的场景模块，结算画面展示
    // 期间正好用来把加载做完，避免点击"下一关/下一轮"瞬间才发起请求造成卡顿。
    this._nextPromise = (this.endless
      ? Promise.all([import("../data/levels.js"), import("./RunScene.js")])
      : this.level.index < TOTAL_LEVELS
        ? import("./IntroScene.js")
        : import("./LevelSelectScene.js")
    ).catch((e) => {
      console.warn("[BossScene] 预加载下一场景失败，将在切换时重试", e);
      return null;
    });
  }

  _lose() {
    this.state = "lose";
    this.endT = 0;
    this.stars = [];
    audio.play("death");
    this.particles.burst(this.player.x, this.player.y, PALETTE.danger, 30, { speed: 160, life: 0.9, size: 3 });

    // ===== 魔女回廊 · Boss战失败：石化之心可免死一次，否则本次爬塔彻底终结 =====
    if (this.towerNode) {
      if (TowerRun.tryConsumeRevive()) {
        this.state = "fight";
        this.player.hp = this.player.maxHp;
        this.player.invuln = 1.2;
        this.particles.burst(this.player.x, this.player.y, PALETTE.gold, 30, { speed: 170, life: 0.9, size: 3 });
        audio.play("rareStar");
        return;
      }
      TowerRun.reset();
      return;
    }

    // 失败结算展示期间预取重试所需的武器选择场景。
    this._retryPromise = import("./WeaponSelectScene.js").catch((e) => {
      console.warn("[BossScene] 预加载重试场景失败，将在切换时重试", e);
      return null;
    });
  }

  _goNext() {
if (this.towerNode) {
      // 魔女回廊：推进楼层（或全通关结算），回到回廊地图
      if (this._towerIsLastFloor) {
        TowerRun.completeTower();
      } else {
        TowerRun.advanceFloor();
      }
      const loader = this._nextPromise || import("./TowerScene.js");
      loader
        .then((m) => {
          if (!m) throw new Error("TowerScene module not loaded");
          this.game.changeScene(new m.TowerScene(this.game));
        })
        .catch((e) => {
          console.warn("[BossScene] 返回回廊地图失败，可再次点击重试", e);
          this._navigating = false;
          this._nextPromise = null;
        });
      return;
    }
    if (this.endless) {
      // 无限模式：进入下一轮（round+1），累加 buffs / totalTrial 到下一轮 RunScene
   const carry = {
   buffs: { ...(this.carry.buffs || {}) },
        formId: this.carry.formId,
        collected: this.carry.collected || 0,
     score: this.carry.score || 0,
        endless: true,
        round: this.round + 1,
 totalTrial: this.carry.totalTrial || 0,
        trial: this.carry.trial || 0,
      };
      const loader = this._nextPromise || Promise.all([import("../data/levels.js"), import("./RunScene.js")]);
      loader
        .then((r) => {
          if (!r) throw new Error("next scene modules not loaded");
          const [lv, rs] = r;
          this.game.changeScene(new rs.RunScene(this.game, lv.makeEndlessLevel(this.round + 1), carry));
        })
        .catch((e) => {
          console.warn("[BossScene] 进入下一轮失败，可再次点击重试", e);
          this._navigating = false;
          this._nextPromise = null;
        });
    return;
    }
    const loader = this._nextPromise || (this.level.index < TOTAL_LEVELS
      ? import("./IntroScene.js")
      : import("./LevelSelectScene.js"));
    if (this.level.index < TOTAL_LEVELS) {
      loader
        .then((m) => {
          if (!m) throw new Error("IntroScene module not loaded");
          this.game.changeScene(new m.IntroScene(this.game, getLevel(this.level.index + 1)));
        })
        .catch((e) => {
          console.warn("[BossScene] 进入下一关失败，可再次点击重试", e);
          this._navigating = false;
          this._nextPromise = null;
        });
 } else {
      // 通关全部 → 回选关（显示全通关）
      this._goSelect();
    }
  }

  _goSelect() {
    // 魔女回廊：胜利画面的"选关/主菜单"按钮直接返回主菜单（继续爬塔用另一个按钮）
    if (this.towerNode) {
      this.game.changeScene(new MenuScene(this.game));
      return;
    }
    const loader = this._nextPromise || import("./LevelSelectScene.js");
    loader
      .then((m) => {
        if (!m) throw new Error("LevelSelectScene module not loaded");
        this.game.changeScene(new m.LevelSelectScene(this.game));
      })
      .catch((e) => {
        console.warn("[BossScene] 返回选关失败，可再次点击重试", e);
        this._navigating = false;
        this._nextPromise = null;
      });
  }

  _retry() {
    const loader = this._retryPromise || import("./WeaponSelectScene.js");
    loader
      .then((m) => {
        if (!m) throw new Error("WeaponSelectScene module not loaded");
        this.game.changeScene(new m.WeaponSelectScene(this.game, this.level, this.carry));
      })
      .catch((e) => {
        console.warn("[BossScene] 重试失败，可再次点击重试", e);
        this._navigating = false;
        this._retryPromise = null;
      });
  }

  render(ctx) {
    const W = this.game.width, H = this.game.height;
    // 背景
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, this.level.sky[0]);
    g.addColorStop(0.6, this.level.sky[1]);
    g.addColorStop(1, this.level.sky[2]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // 星尘
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    for (let i = 0; i < 30; i++) {
      const x = (i * 71 - this.t * 12) % W;
      const y = (i * 43) % H;
      ctx.fillRect((x + W) % W, y, 1, 1);
    }

    // Boss
    this._renderBoss(ctx);

    // 六芒星特殊道具
    this._renderStars(ctx);

    // Boss 子弹（大招弹幕带白色描边高亮，一眼区分于常规弹幕）
    for (const b of this.bossBullets) {
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.glow ? "#ffffff" : b.color;
      ctx.shadowBlur = b.glow ? 12 : 6;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      if (b.glow) {
        ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;

    // 玩家子弹
    for (const b of this.playerBullets) {
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;

    // 玩家
    this._renderPlayer(ctx);
    // 星辰牵引小星星（跟随玩家）
    this._renderCompanions(ctx);

    this.particles.render(ctx);

    // HUD
    this._renderHUD(ctx, W, H);
    // 大招符卡名横幅 / 进行中提示
    this._renderUltimateBanner(ctx, W, H);

    if (this.state === "paused") this._renderPause(ctx, W, H);
    if (this.state === "win") this._renderWin(ctx, W, H);
    if (this.state === "lose") this._renderLose(ctx, W, H);
  }

  _renderBoss(ctx) {
    const b = this.boss;
    const cx = this.bx, cy = this.by;
    ctx.save();
    ctx.translate(cx, cy);

    // Boss 专属贴图：按 Boss 名取图，命中判定始终只用 this.bw/this.bh（未改动），
    // 这里只是换个画法——贴图统一绘制进 bw×bh 的可视框（居中对齐），
    // 保证换成贴图后视觉大小与原矢量形状占位一致，不会出现忽大忽小/错位。
    const sprite = getBossSprite(b.name);
    if (sprite) {
      ctx.shadowColor = b.color; ctx.shadowBlur = 10;
      const drawH = this.bh;
      const drawW = (sprite.width / sprite.height) * drawH;
      ctx.drawImage(sprite, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.shadowBlur = 0;
      ctx.restore();
      return;
    }

    ctx.shadowColor = b.color; ctx.shadowBlur = 10;
    ctx.fillStyle = b.color;
    ctx.strokeStyle = b.capColor; ctx.lineWidth = 2;

    if (b.shape === "mushroom") {
      //菌盖
      ctx.fillStyle = b.capColor;
      ctx.beginPath(); ctx.arc(0, -4, 22, Math.PI, 0); ctx.fill();
      // 斑点
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath(); ctx.arc(-8, -8, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(7, -6, 4, 0, Math.PI * 2); ctx.fill();
      // 菌柄
      ctx.fillStyle = b.color;
      ctx.fillRect(-10, -4, 20, 22);
      // 怒眼
      ctx.fillStyle = "#000";
      ctx.fillRect(-6, 4, 4, 4); ctx.fillRect(3, 4, 4, 4);
    } else if (b.shape === "vine") {
      ctx.strokeStyle = b.color; ctx.lineWidth = 5;
      for (let s = -1; s <= 1; s += 1) {
        ctx.beginPath();
        ctx.moveTo(s * 14, 20);
        ctx.quadraticCurveTo(s * 24 + Math.sin(this.t * 3 + s) * 6, 0, s * 10, -18);
        ctx.stroke();
      }
      ctx.fillStyle = b.capColor;
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#000";
      ctx.fillRect(-6, -3, 4, 5); ctx.fillRect(3, -3, 4, 5);
    } else if (b.shape === "golem") {
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.moveTo(0, -22); ctx.lineTo(20, -6); ctx.lineTo(14, 20); ctx.lineTo(-14, 20); ctx.lineTo(-20, -6);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = b.capColor; ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.fillRect(-7, -2, 5, 5); ctx.fillRect(4, -2, 5, 5);
    } else if (b.shape === "ghost") {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(0, -4, 20, Math.PI, 0);
      ctx.lineTo(20, 18); ctx.lineTo(10, 10); ctx.lineTo(0, 18); ctx.lineTo(-10, 10); ctx.lineTo(-20, 18);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.arc(-7, -4, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(7, -4, 3, 0, Math.PI * 2); ctx.fill();
    } else {
      // witch（最终 Boss）
      ctx.fillStyle = b.capColor;
      ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(-16, 2); ctx.lineTo(16, 2); ctx.closePath(); ctx.fill();
      ctx.fillRect(-20, 2, 40, 5);
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(0, 16, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#000";
      ctx.fillRect(-6, 12, 3, 4); ctx.fillRect(3, 12, 3, 4);
      // 月蚀光环
      ctx.strokeStyle = b.color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 8, 28 + Math.sin(this.t * 2) * 2, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  //绘制六芒星特殊道具（两个交叠正三角形 + 发光旋转）
  _renderStars(ctx) {
    for (const s of this.stars) {
      const blink = s.life < 3 ? (Math.floor(this.t * 12) % 2 === 0 ? 0.4 : 1) : 1;
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.translate(s.x, s.y);
      ctx.rotate(s.spin);
      ctx.shadowColor = "#ffd94a"; ctx.shadowBlur = 12;
      ctx.strokeStyle = "#ffd94a"; ctx.lineWidth = 2;
      ctx.fillStyle = "rgba(255,217,74,0.35)";
      this._sixStarPath(ctx, s.r);
      ctx.fill();
      ctx.stroke();
      // 中心亮点
      ctx.shadowBlur = 6;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.shadowBlur = 0;
  }

  _sixStarPath(ctx, r) {
    // 正三角形
    const tri = (rot) => {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = rot + i * (Math.PI * 2 / 3) - Math.PI / 2;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    tri(0);
    tri(Math.PI);
  }

  _renderPlayer(ctx) {
    const p = this.player;
    // 无敌闪烁
    if (p.invuln > 0 && Math.floor(this.t * 20) % 2 === 0) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    // 六芒星狂暴光环
    if (this.powerT > 0) {
      ctx.strokeStyle = "#ffd94a";
      ctx.lineWidth = 1.5;
      ctx.shadowColor = "#ffd94a"; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(0, 2, 16 + Math.sin(this.t * 8) * 2, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ===== 立绘：命中角色专属立绘时，画立绘替代下方的尖顶帽+方块矢量造型 =====
    // Boss 战里原矢量画法的身体底边大致在 y=12，这里让立绘底部对齐同一位置，
    // 站位与弹幕高度对得上；战斗场景站定射击，画得比跑酷小一些避免遮挡弹幕。
    if (WITCH_SPRITES_ENABLED) {
      const formId = (this.carry && this.carry.formId) || "sailor";
      const sprite = getWitchSprite(this.save.equipped.character, formId);
      if (sprite) {
        const drawH = 30;
        const drawW = (sprite.width / sprite.height) * drawH;
        ctx.drawImage(sprite, -drawW / 2, 12 - drawH, drawW, drawH);
        this._renderHitDot(ctx);
        ctx.restore();
        return;
      }
    }

    ctx.fillStyle = this.weapon.color;
    ctx.shadowColor = this.weapon.color; ctx.shadowBlur = 8;
    // 尖顶帽
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(-7, -2); ctx.lineTo(7, -2); ctx.closePath(); ctx.fill();
    ctx.fillRect(-8, -2, 16, 2);
    // 身体
    ctx.fillStyle = "#3d2a54";
    ctx.strokeStyle = this.weapon.color; ctx.lineWidth = 1;
    ctx.fillRect(-6, 0, 12, 12);
    ctx.strokeRect(-6.5, 0.5, 13, 12);
    ctx.shadowBlur = 0;
    this._renderHitDot(ctx);
    ctx.restore();
  }

  // 东方式判定点：白色光晕 + 亮色实心圆点，标出玩家真实受弹范围（半径 hitR），
  // 贴图/立绘只是外观装饰，真正的碰撞判定只在这个点上——躲弹更精确、也更"好看得懂"。
  _renderHitDot(ctx) {
    const r = this.player.hitR;
    ctx.save();
    ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 9;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath(); ctx.arc(0, 0, r + 2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 4;
    ctx.fillStyle = "#ff3860";
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  _renderHUD(ctx, W, H) {
    // Boss 血条（顶部长条）
    const bw = W - 40, bx = 20, by = 6, bh = 8;
    ctx.fillStyle = "rgba(20,10,31,0.7)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = this.boss.color;
    ctx.fillRect(bx, by, bw * Math.max(0, this.bhp / this.bMaxHp), bh);
    ctx.strokeStyle = this.boss.capColor; ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = PALETTE.text; ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(`${this.boss.name}  ${Math.max(0, Math.ceil(this.bhp))}/${this.bMaxHp}`, W / 2, by + bh + 2);

    // 玩家血量（地狱：爱心命制；普通：长血条）
    const php = Math.max(0, this.player.hp);
    const pbx = 10, pby = H - 16, pbw = 160, pbh = 9;
    if (this.diff.bossLifeMode) {
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.font = "13px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillStyle = this.diff.color;
      ctx.fillText("🔥", pbx, pby + pbh / 2);
      let hx = pbx + 18;
      for (let i = 0; i < this.player.maxHp; i++) {
        ctx.fillStyle = i < php ? "#ff5c8a" : "rgba(120,80,100,0.5)";
        ctx.fillText(i < php ? "♥" : "♡", hx + i * 14, pby + pbh / 2);
      }
      // 无敌状态提示
      if (this.player.invuln > 0) {
        ctx.fillStyle = "#ffd94a"; ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
        ctx.fillText(`无敌 ${this.player.invuln.toFixed(1)}s`, hx + this.player.maxHp * 14 + 6, pby + pbh / 2 + 1);
      }
    } else {
      const pratio = php / this.player.maxHp;
      ctx.fillStyle = "rgba(20,10,31,0.7)";
      ctx.fillRect(pbx, pby, pbw, pbh);
      // 血量颜色随比例变化
      const hpColor = pratio > 0.5 ? "#5cff9a" : pratio > 0.25 ? PALETTE.gold : PALETTE.danger;
      ctx.fillStyle = hpColor;
      ctx.fillRect(pbx, pby, pbw * pratio, pbh);
      ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1;
      ctx.strokeRect(pbx + 0.5, pby + 0.5, pbw - 1, pbh - 1);
      ctx.fillStyle = PALETTE.text; ctx.font = "8px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(`HP ${php}/${this.player.maxHp}`, pbx + pbw + 6, pby + pbh / 2 + 1);
    }

    // 武器名
    ctx.fillStyle = this.weapon.color; ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.textAlign = "right"; ctx.textBaseline = "bottom";
    ctx.fillText(`${this.weapon.icon} ${this.weapon.name}`, W - 10, H - 8);

    // 六芒星收集数 + 狂暴状态（顶部靠右，避免与底部血量/爱心重叠）
    ctx.textAlign = "right"; ctx.textBaseline = "top";
    ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = "#ffd94a";
    ctx.shadowColor = "#ffd94a"; ctx.shadowBlur = this.powerT > 0 ? 6 : 0;
    ctx.fillText(`✶六芒星 x${this.starCollected}`, W - 30, by + bh + 2);
    ctx.shadowBlur = 0;
    if (this.powerT > 0) {
      ctx.fillStyle = "#ffd94a";
      ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(`星辉狂暴 ${this.powerT.toFixed(1)}s`, W - 30, by + bh + 15);
    }

    // 暂停按钮
    const pb = this._pauseBtn();
    ctx.fillStyle = "rgba(20,10,31,0.6)"; ctx.fillRect(pb.x, pb.y, pb.w, pb.h);
    ctx.strokeStyle = PALETTE.neon; ctx.lineWidth = 1;
    ctx.strokeRect(pb.x + 0.5, pb.y + 0.5, pb.w - 1, pb.h - 1);
    ctx.fillStyle = PALETTE.neon;
    ctx.fillRect(pb.x + 5, pb.y + 4, 3, 8); ctx.fillRect(pb.x + 10, pb.y + 4, 3, 8);

    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  // 大招符卡展示：触发瞬间居中弹出符卡名（淡入-停留-淡出），
  // 大招持续期间在顶部常驻一条小提示，呼应东方 Project 的"符卡宣告"演出。
  _renderUltimateBanner(ctx, W, H) {
    if (!this.ultimate) return;
    if (this.ultimateActive) {
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillStyle = this.boss.color;
      ctx.shadowColor = this.boss.color; ctx.shadowBlur = 6;
      ctx.fillText("★ 符卡发动中", W / 2, 16);
      ctx.shadowBlur = 0;
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    }
    if (this.ultimateNameT > 0) {
      // 0~0.5s 淡入，中段停留，最后 0.6s 淡出
      let alpha = 1;
      if (this.ultimateNameT > 2.5) alpha = Math.max(0, 1 - (this.ultimateNameT - 2.5) / 0.5);
      else if (this.ultimateNameT < 0.6) alpha = this.ultimateNameT / 0.6;
      ctx.save();
      ctx.globalAlpha = alpha;
      const by = H * 0.4;
      ctx.fillStyle = "rgba(10,4,16,0.55)";
      ctx.fillRect(0, by - 14, W, 28);
      ctx.strokeStyle = this.boss.color; ctx.lineWidth = 1;
      ctx.strokeRect(0.5, by - 13.5, W - 1, 27);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "bold 15px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillStyle = this.boss.color;
      ctx.shadowColor = this.boss.color; ctx.shadowBlur = 10;
      ctx.fillText(this.ultimate.name, W / 2, by);
      ctx.shadowBlur = 0;
      ctx.restore();
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    }
  }

  _renderPause(ctx, W, H) {
    ctx.fillStyle = "rgba(20,10,31,0.82)"; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.neon; ctx.font = "bold 22px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText("暂停", W / 2, H * 0.32);
    const b = this._pauseMenuButtons();
    this._btn(ctx, b.resume, "继续战斗", PALETTE.cyan);
    this._btn(ctx, b.exit, "退出到主菜单", PALETTE.danger);
    ctx.textAlign = "left";
  }

  _renderWin(ctx, W, H) {
    ctx.fillStyle = "rgba(20,10,31,0.78)"; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.gold; ctx.font = "bold 24px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.shadowColor = PALETTE.gold; ctx.shadowBlur = 10;
    const allClear = !this.endless && !this.towerNode && this.level.index >= TOTAL_LEVELS;
    if (this.towerNode) {
      ctx.fillText(this._towerIsLastFloor ? "回廊主宰镇压！魔女回廊通关！" : `第 ${TowerRun.state.floor} 层回廊主宰已镇压！`, W / 2, H * 0.3);
    } else if (this.endless) {
      ctx.fillText(`第${this.round}轮达成！击败 ${this.boss.name}`, W / 2, H * 0.3);
    } else {
 ctx.fillText(allClear ? "全部试炼达成！" : "击败 " + this.boss.name, W / 2, H * 0.3);
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.text; ctx.font = "12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    if (this.towerNode) {
      ctx.fillStyle = PALETTE.cyan;
      ctx.fillText(`☾ 月光结晶 +${this._towerCrystalGain || 0}（结余 ${TowerRun.state.crystals}）`, W / 2, H * 0.44);
      if (this._towerDrop) {
        ctx.fillStyle = this._towerDrop.color || PALETTE.text;
        const kind = REMAINS.some((r) => r.id === this._towerDrop.id) ? "圣骸" : "咒物";
        ctx.fillText(`获得${kind}「${this._towerDrop.icon || ""} ${this._towerDrop.name}」`, W / 2, H * 0.5);
      }
    } else {
      const rewardSuffix = this.coinMultiplier > 1 ? `（点石成金 ×${this.coinMultiplier}）` : "";
      ctx.fillText(`金币 +${this.reward}${rewardSuffix}   （共 ${this.save.coins}）`, W / 2, H * 0.44);
      ctx.fillStyle = "#ffd94a";
      ctx.fillText(`✶ 六芒星收集 x${this.starCollected}`, W / 2, H * 0.5);
    }
    if (this.towerNode) ctx.fillText(this._towerIsLastFloor ? "你镇压了所有回廊主宰！" : "点击继续爬塔，前往下一层", W / 2, H * 0.58);
    else if (this.endless) ctx.fillText(`继续挑战 第${this.round + 1}轮（Boss 随机·属性继续叠加）`, W / 2, H * 0.58);
    else if (!allClear) ctx.fillText(`已解锁 第${this.level.index + 1}关`, W / 2, H * 0.58);
    else ctx.fillText("你已成为真正的魔女！", W / 2, H * 0.58);

    if (this.endT > 0.5) {
      const b = this._endButtons();
    this._btn(ctx, b.next, this.towerNode ? (this._towerIsLastFloor ? "完成回廊" : "继续爬塔") : (this.endless ? "下一轮" : (allClear ? "选关" : "下一关")), PALETTE.cyan);
      this._btn(ctx, b.menu, this.towerNode ? "返回主菜单" : "选关界面", PALETTE.neon);
    }
    ctx.textAlign = "left";
  }

  _renderLose(ctx, W, H) {
    ctx.fillStyle = "rgba(20,10,31,0.78)"; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.danger; ctx.font = "bold 24px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText("试炼失败", W / 2, H * 0.32);
    ctx.fillStyle = PALETTE.text; ctx.font = "12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText(`${this.boss.name} 太强大了……`, W / 2, H * 0.46);
    if (this.towerNode) {
      ctx.fillStyle = PALETTE.danger; ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText("魔女回廊的这次试炼就此终结……", W / 2, H * 0.56);
    }
    if (this.endT > 0.5) {
      const b = this._endButtons();
      this._btn(ctx, b.next, this.towerNode ? "返回主菜单" : "再战", PALETTE.cyan);
      this._btn(ctx, b.menu, "主菜单", PALETTE.neon);
    }
    ctx.textAlign = "left";
  }

  _btn(ctx, r, label, color) {
    ctx.fillStyle = "rgba(185,107,255,0.14)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = color; ctx.font = "11px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  }
}
