// 主菜单：霓虹标题 + 视差城市 + 上下键/点击选择（开始 / 商城），显示金币与最高分
import { Scene } from "../engine/Scene.js";
import { PALETTE } from "../engine/Game.js";
import { Background } from "../systems/Background.js";
import { Save } from "../systems/Save.js";
import { getSkin } from "../data/skins.js";
import { LevelSelectScene } from "./LevelSelectScene.js";
import { ShopScene } from "./ShopScene.js";
import { AchievementsScene } from "./AchievementsScene.js";
import { Difficulty, DIFF_ORDER, getDifficulty } from "../data/difficulty.js";
import { audio } from "../engine/Audio.js";
import { TowerRun } from "../systems/TowerRun.js";

export class MenuScene extends Scene {
  constructor(game) {
    super(game);
    this.t = 0;
    this.save = Save.load();
    this.bg = new Background(game.width, game.height, getSkin("background", this.save.equipped.background));
    //菜单项：难度为可切换项（左右/点击循环）
    // 魔女回廊暂时隐藏，入口保留在代码里（见下方注释掉的分支），不移除功能本身
    this.items = ["开始试炼", "图鉴", "商城", "成就", "难度"];
    this.sel = 0;
    this.diffId = Difficulty.load();
  }

  onEnter() {
    this.save = Save.load();
    this.bg.setSkin(getSkin("background", this.save.equipped.background));
    this.diffId = Difficulty.load();
    audio.playBgm("menu");
  }

  _cycleDifficulty(dir = 1) {
    const idx = DIFF_ORDER.indexOf(this.diffId);
    const next = (idx + dir + DIFF_ORDER.length) % DIFF_ORDER.length;
    this.diffId = DIFF_ORDER[next];
    Difficulty.save(this.diffId);
  }

  _itemRects() {
    const W = this.game.width, H = this.game.height;
    // 6 项时把间距收到 22 + 整体再上移一点，避免 480x270 内挤到底边
    const startY = H * 0.49 - 14;
    const gap = 22;
    return this.items.map((_, i) => ({ x: W / 2 - 90, y: startY + i * gap, w: 180, h: 20 }));
  }

  _activate(i) {
    audio.play("click");
    if (i === 0) this.game.changeScene(new LevelSelectScene(this.game));
    // 魔女回廊入口已隐藏（原 i===1 分支），保留下方代码供后续恢复：
    // import("./TowerScene.js").then((m) => { if (!TowerRun.isActive()) TowerRun.start(); this.game.changeScene(new m.TowerScene(this.game)); });
    else if (i === 1) {
      import("./CodexScene.js")
        .then((m) => this.game.changeScene(new m.CodexScene(this.game)))
        .catch((e) => console.warn("[MenuScene] 打开图鉴失败", e));
    }
    else if (i === 2) this.game.changeScene(new ShopScene(this.game));
    else if (i === 3) this.game.changeScene(new AchievementsScene(this.game));
    else if (i === 4) this._cycleDifficulty(1); // 难度项：确认即切换
  }

  update(dt, input) {
    this.t += dt;
    this.bg.update(dt, 120);

    if (input.justPressed("arrowup", "w")) this.sel = (this.sel + this.items.length - 1) % this.items.length;
    if (input.justPressed("arrowdown", "s")) this.sel = (this.sel + 1) % this.items.length;
    // 选中难度项时，左右键切换难度
    if (this.sel === 4) {
      if (input.justPressed("arrowleft", "a")) this._cycleDifficulty(-1);
      if (input.justPressed("arrowright", "d")) this._cycleDifficulty(1);
    }
    if (input.justPressed("enter", " ")) this._activate(this.sel);

    // 触屏：直接点击菜单项
    const rects = this._itemRects();
    for (let i = 0; i < rects.length; i++) {
      if (input.tapIn(rects[i])) { this.sel = i; this._activate(i); }
    }
  }

  render(ctx) {
    const W = this.game.width, H = this.game.height;
    this.bg.render(ctx, this.t);
    ctx.fillStyle = "rgba(20,10,31,0.5)";
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const glow = 8 + Math.sin(this.t * 2) * 4;
    ctx.shadowColor = PALETTE.neon;
    ctx.shadowBlur = glow;
    ctx.fillStyle = PALETTE.text;
    ctx.font = "bold 32px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText("魔女试炼", W / 2, H * 0.26);
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.neon;
 ctx.font = "11px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText("W I T C H   T R I A L", W / 2, H * 0.26 + 26);
    ctx.fillStyle = "rgba(233,220,255,0.55)";
    ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    // 副标题跟随当前装备的角色皮肤，而不是固定写死叶林
    const charSkin = getSkin("character", this.save.equipped.character);
    const subtitle = charSkin ? `${charSkin.charName} · ${charSkin.name}` : "叶林 · 森林魔女";
    ctx.fillText(subtitle, W / 2, H * 0.26 + 42);

    const rects = this._itemRects();
    ctx.font = "13px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    const curDiff = getDifficulty(this.diffId);
    for (let i = 0; i < this.items.length; i++) {
      const r = rects[i];
      const on = i === this.sel;
      // 难度项：显示 "难度：◄ 地狱 ►"
      let label = this.items[i];
      if (i === 4) label = `难度  ◄ ${curDiff.icon}${curDiff.name} ►`;
      if (on) {
        ctx.fillStyle = "rgba(185,107,255,0.16)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = (i === 4) ? curDiff.color : PALETTE.gold;
        ctx.fillText((i === 4 ? "" : "▶  ") + label + (i === 4 ? "" : "  ◀"), W / 2, r.y + r.h / 2 + 1);
      } else {
        ctx.fillStyle = (i === 4) ? curDiff.color : "rgba(233,220,255,0.6)";
        ctx.fillText(label, W / 2, r.y + r.h / 2 + 1);
      }
    }
    // 地狱难度说明
    if (this.diffId === "hell") {
      ctx.font = "8px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillStyle = "rgba(255,120,120,0.75)";
      ctx.fillText("🔥 三命定生死 · Boss 血量×3 · 破障魔法改为耐撞翻倍", W / 2, rects[4].y + rects[4].h + 10);
    }

    ctx.textAlign = "right";
    ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle = PALETTE.gold;
    ctx.textBaseline = "top";
    ctx.fillText(`金币 ${this.save.coins}`, W - 10, 8);
    ctx.fillStyle = "rgba(233,220,255,0.6)";
    ctx.fillText(`最高 ${this.save.hi}`, W - 10, 22);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(233,220,255,0.45)";
    ctx.font = "8px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText("↑↓选择 · ←→ 切换难度 · Enter 确认", W / 2, H * 0.92);
    ctx.textAlign = "left";
  }
}
