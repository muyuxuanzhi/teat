// 魔女回廊 · 地图场景：横向节点图，从入口走向回廊主宰。
// 战斗/精英/回廊主宰节点会真正进入跑酷试炼（RunScene）与弹幕Boss战（BossScene），
// 暗巷炼金铺/月光祭坛/遗骸宝匣为地图内直接结算的功能节点。
import { Scene } from "../engine/Scene.js";
import { PALETTE } from "../engine/Game.js";
import { Background } from "../systems/Background.js";
import { Save } from "../systems/Save.js";
import { getSkin } from "../data/skins.js";
import { audio } from "../engine/Audio.js";
import { TowerRun } from "../systems/TowerRun.js";
import { NODE_TYPES, nextNodeIds, themeForNode, buildNodeLevel, buildBossLevel } from "../data/towerMap.js";
import { getBossById } from "../data/bosses.js";
import { rollCurseChoices, getCurse } from "../data/curses.js";
import { MenuScene } from "./MenuScene.js";

const MARKET_COST = { common: 15, rare: 28 };

export class TowerScene extends Scene {
  constructor(game) {
    super(game);
    this.t = 0;
    this.save = Save.load();
    this.bg = new Background(game.width, game.height, getSkin("background", this.save.equipped.background));
    if (!TowerRun.isActive() && !TowerRun.state.completed) TowerRun.start();
    this.overlay = TowerRun.state.completed ? "complete" : null;   // null | "battle" | "elite" | "market" | "altar" | "coffer" | "boss" | "complete"
    this.activeNode = null;
    this.toast = "";
    this.toastT = 0;
  }

  onEnter() {
    this.save = Save.load();
    this.bg.setSkin(getSkin("background", this.save.equipped.background));
    if (!TowerRun.isActive() && !TowerRun.state.completed) TowerRun.start();
    if (TowerRun.state.completed) this.overlay = "complete";
  }

  _showToast(msg) {
    this.toast = msg;
    this.toastT = 2.2;
  }

  _backBtn() {
    return { x: 8, y: 6, w: 54, h: 18 };
  }

  // 计算当前楼层地图每个节点的屏幕坐标
  _layout() {
    const W = this.game.width, H = this.game.height;
    const map = TowerRun.state.map;
    const marginX = 42;
    const usableW = W - marginX * 2;
    const topY = 46, bottomY = H - 34;
    const usableH = bottomY - topY;
    const pos = {};
    const cols = map.columns;
    cols.forEach((col, c) => {
      const x = marginX + (usableW * c) / (cols.length - 1);
      const spacing = Math.min(36, usableH / Math.max(1, col.length));
      const startY = topY + usableH / 2 - ((col.length - 1) * spacing) / 2;
      col.forEach((node, r) => {
        pos[node.id] = { x, y: startY + r * spacing };
      });
    });
    return pos;
  }

  _nodeRect(p) {
    const r = 11;
    return { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 };
  }

  _openNode(node) {
    audio.play("click");
    this.activeNode = node;
    if (node.type === "market" && !node.offers) {
      node.offers = rollCurseChoices(3).map((c) => ({ curse: c, bought: false }));
    }
    this.overlay = node.type;
  }

  _finalizeNode(node) {
    TowerRun.markNodeDone(node.id);
    TowerRun.moveTo(node.id);
    this.overlay = null;
    this.activeNode = null;
  }

  // 进入试炼战斗/精英试炼/回廊主宰节点：真正跑一段跑酷试炼（+弹幕Boss战），
  // 完成后由 RunScene/BossScene 自行结算并把玩家带回本地图。
  _enterTowerLevel(node, isBoss) {
    const level = isBoss ? buildBossLevel(TowerRun.state.floor, node) : buildNodeLevel(TowerRun.state.floor, node);
    this._enterPromise = import("./IntroScene.js")
      .then((m) => {
        this.game.changeScene(new m.IntroScene(this.game, level, node));
      })
      .catch((e) => {
        console.warn("[TowerScene] 进入试炼失败，可再次点击重试", e);
        this._enterPromise = null;
      });
  }

  _updateOverlay(dt, input) {
    const node = this.activeNode;
    const closeBtn = { x: 14, y: 14, w: 70, h: 18 };

    if (this.overlay === "complete") {
      const btn = { x: this.game.width / 2 - 70, y: this.game.height - 46, w: 140, h: 24 };
      if (input.justPressed("enter", " ", "escape") || input.tapIn(btn)) {
        audio.play("click");
        this.game.changeScene(new MenuScene(this.game));
      }
      return;
    }

    if (!node) { this.overlay = null; return; }

    if (this.overlay === "battle" || this.overlay === "elite") {
      const goBtn = { x: this.game.width / 2 - 60, y: this.game.height - 46, w: 120, h: 24 };
      if (input.justPressed("enter", " ") || input.tapIn(goBtn)) {
        audio.play("click");
        this._enterTowerLevel(node, false);
        return;
      }
      if (input.justPressed("escape") || input.tapIn(closeBtn)) {
        audio.play("click");
        this.overlay = null; this.activeNode = null;
      }
      return;
    }

    if (this.overlay === "boss") {
      const goBtn = { x: this.game.width / 2 - 60, y: this.game.height - 46, w: 120, h: 24 };
      if (input.justPressed("enter", " ") || input.tapIn(goBtn)) {
        audio.play("click");
        this._enterTowerLevel(node, true);
        return;
      }
      if (input.justPressed("escape") || input.tapIn(closeBtn)) {
        audio.play("click");
        this.overlay = null; this.activeNode = null;
      }
      return;
    }

    if (this.overlay === "market") {
      const rects = (node.offers || []).map((_, i) => ({ x: this.game.width / 2 - 132 + i * 90, y: 96, w: 82, h: 74 }));
      node.offers.forEach((offer, i) => {
        if (offer.bought) return;
        if (input.tapIn(rects[i])) {
          const cost = MARKET_COST[offer.curse.tier] || 20;
          if (TowerRun.spendCrystals(cost)) {
            TowerRun.addCurseStacks(offer.curse.id, 1);
            offer.bought = true;
            audio.play("click");
            this._showToast(`购入「${offer.curse.name}」`);
          } else {
            this._showToast("月光结晶不足");
          }
        }
      });
      const leaveBtn = { x: this.game.width / 2 - 60, y: this.game.height - 40, w: 120, h: 22 };
      if (input.justPressed("enter", " ", "escape") || input.tapIn(leaveBtn)) {
        audio.play("click");
        this._finalizeNode(node);
      }
      return;
    }

    if (this.overlay === "altar") {
      const wishBtn = { x: this.game.width / 2 - 60, y: 128, w: 120, h: 24 };
      const leaveBtn = { x: this.game.width / 2 - 60, y: this.game.height - 40, w: 120, h: 22 };
      if (!node.usedAltar && input.tapIn(wishBtn)) {
        if (TowerRun.spendCrystals(10)) {
          const item = TowerRun.grantRandomItem("common");
          node.usedAltar = true;
          node.altarResult = item.name;
          audio.play("click");
        } else {
          this._showToast("月光结晶不足（需 10）");
        }
      }
      if (input.justPressed("enter", " ", "escape") || input.tapIn(leaveBtn)) {
        audio.play("click");
        this._finalizeNode(node);
      }
      return;
    }

    if (this.overlay === "coffer") {
      const openBtn = { x: this.game.width / 2 - 60, y: 128, w: 120, h: 24 };
      const leaveBtn = { x: this.game.width / 2 - 60, y: this.game.height - 40, w: 120, h: 22 };
      if (!node.opened && (input.justPressed("enter", " ") || input.tapIn(openBtn))) {
        const roll = Math.random();
        const tier = roll < 0.03 ? "epic" : roll < 0.18 ? "rare" : "common";
        const item = TowerRun.grantRandomItem(tier);
        node.opened = true;
        node.cofferResult = item.name;
        audio.play("click");
      }
      if (node.opened && (input.justPressed("escape") || input.tapIn(leaveBtn))) {
        this._finalizeNode(node);
      } else if (input.justPressed("escape") && !node.opened) {
        this.overlay = null; this.activeNode = null;
      }
      return;
    }
  }

  update(dt, input) {
    this.t += dt;
    this.bg.update(dt, 70);
    if (this.toastT > 0) this.toastT -= dt;

    if (this.overlay) {
      this._updateOverlay(dt, input);
      return;
    }

    if (input.justPressed("escape", "backspace") || input.tapIn(this._backBtn())) {
      audio.play("click");
      this.game.changeScene(new MenuScene(this.game));
      return;
    }

    const map = TowerRun.state.map;
    const reachable = new Set(nextNodeIds(map, TowerRun.state.currentNodeId));
    const pos = this._layout();
    for (const col of map.columns) {
      for (const node of col) {
        if (!reachable.has(node.id) || node.done) continue;
        if (input.tapIn(this._nodeRect(pos[node.id]))) {
          this._openNode(node);
          return;
        }
      }
    }
  }

  _drawMap(ctx) {
    const map = TowerRun.state.map;
    const pos = this._layout();
    const reachable = new Set(nextNodeIds(map, TowerRun.state.currentNodeId));

    // 连线
    ctx.lineWidth = 1;
    for (const e of map.edges) {
      const a = pos[e.from], b = pos[e.to];
      const fromNode = a && b ? true : false;
      if (!fromNode) continue;
      const lit = e.from === TowerRun.state.currentNodeId || TowerRun.state.completedNodeIds.includes(e.from);
      ctx.strokeStyle = lit ? "rgba(255,207,92,0.55)" : "rgba(233,220,255,0.18)";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // 节点
    for (const col of map.columns) {
      for (const node of col) {
        const p = pos[node.id];
        const def = NODE_TYPES[node.type];
        const isCurrent = node.id === TowerRun.state.currentNodeId;
        const isDone = node.done;
        const isReachable = reachable.has(node.id) && !isDone;

        ctx.beginPath();
        ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
        ctx.fillStyle = isDone ? "rgba(120,110,140,0.35)" : (isCurrent ? "rgba(255,207,92,0.28)" : "rgba(42,26,58,0.85)");
        ctx.fill();
        ctx.lineWidth = isCurrent ? 2 : 1;
        ctx.strokeStyle = isDone ? "rgba(180,170,200,0.5)" : def.color;
        if (isReachable) {
          ctx.shadowColor = def.color;
          ctx.shadowBlur = 6 + Math.sin(this.t * 4) * 3;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = "11px 'Microsoft YaHei', 'PingFang SC', sans-serif";
        ctx.fillStyle = isDone ? "rgba(220,210,240,0.5)" : def.color;
        ctx.fillText(def.icon, p.x, p.y + 1);

        if (isCurrent) {
          ctx.fillStyle = PALETTE.gold;
          ctx.font = "8px 'Microsoft YaHei', 'PingFang SC', sans-serif";
          ctx.fillText("现在", p.x, p.y + 20);
        } else if (!isDone) {
          ctx.fillStyle = isReachable ? "rgba(233,220,255,0.75)" : "rgba(233,220,255,0.35)";
          ctx.font = "8px 'Microsoft YaHei', 'PingFang SC', sans-serif";
          ctx.fillText(def.name, p.x, p.y + 20);
        }
      }
    }
  }

  _drawPanelFrame(ctx, x, y, w, h, title) {
    ctx.fillStyle = "rgba(42,26,58,0.95)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = PALETTE.neon;
    ctx.lineWidth = 1;
    ctx.shadowColor = PALETTE.neon; ctx.shadowBlur = 8;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.shadowBlur = 0;
    if (title) {
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillStyle = PALETTE.gold;
      ctx.font = "bold 13px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(title, x + w / 2, y + 8);
    }
  }

  _drawButton(ctx, r, label, accent = PALETTE.gold, enabled = true) {
    ctx.fillStyle = enabled ? "rgba(185,107,255,0.18)" : "rgba(80,70,95,0.25)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = enabled ? accent : "rgba(120,110,140,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = enabled ? accent : "rgba(180,170,200,0.6)";
    ctx.font = "12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  }

  _drawOverlay(ctx) {
    const W = this.game.width, H = this.game.height;
    ctx.fillStyle = "rgba(10,5,18,0.72)";
    ctx.fillRect(0, 0, W, H);
    const node = this.activeNode;

    if (this.overlay === "complete") {
      this._drawPanelFrame(ctx, W / 2 - 130, 50, 260, H - 100, "✦ 魔女回廊 · 通关 ✦");
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillStyle = PALETTE.text; ctx.font = "12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText("你镇压了所有回廊主宰，完成本次试炼回廊！", W / 2, 78);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillText(`结余月光结晶：${TowerRun.state.crystals}`, W / 2, 100);
      const owned = Object.keys(TowerRun.state.curses).filter((k) => TowerRun.state.curses[k] > 0);
      ctx.fillStyle = "rgba(233,220,255,0.75)"; ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(`携带咒物：${owned.length ? owned.map((id) => getCurse(id)?.name || id).join("、") : "无"}`, W / 2, 122);
      ctx.fillText(`携带圣骸：${TowerRun.state.remains.length ? TowerRun.state.remains.join("、") : "无"}`, W / 2, 138);
      this._drawButton(ctx, { x: W / 2 - 70, y: H - 46, w: 140, h: 24 }, "▶ 返回主界面", PALETTE.gold);
      return;
    }

    if (!node) return;
    const def = NODE_TYPES[node.type];

    if (this.overlay === "battle" || this.overlay === "elite" || this.overlay === "boss") {
      const theme = themeForNode(TowerRun.state.floor, node);
      const boss = getBossById(theme.bossId);
      this._drawPanelFrame(ctx, W / 2 - 120, 56, 240, 132, `${def.icon} ${def.name}`);
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillStyle = theme.accentA; ctx.font = "12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(theme.name, W / 2, 82);
      ctx.fillStyle = "rgba(233,220,255,0.75)"; ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      const desc = this.overlay === "boss" ? `回廊主宰：${boss.name}` : theme.desc;
      ctx.fillText(desc, W / 2, 100);
      ctx.fillStyle = "rgba(233,220,255,0.55)"; ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(this.overlay === "boss" ? "（击败主宰后攒满试炼值即可进入弹幕对决）" : "（跑酷试炼：攒满试炼值即可结算离开）", W / 2, 118);
      this._drawButton(ctx, { x: W / 2 - 60, y: H - 46, w: 120, h: 24 }, this.overlay === "boss" ? "⚔ 迎战主宰" : "⚔ 开始试炼", PALETTE.danger);
      this._drawButton(ctx, { x: 14, y: 14, w: 70, h: 18 }, "‹ 返回", "rgba(233,220,255,0.6)");
      return;
    }

    if (this.overlay === "market") {
      this._drawPanelFrame(ctx, W / 2 - 150, 70, 300, 150, `${def.icon} 暗巷炼金铺`);
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(233,220,255,0.7)"; ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText("以月光结晶购入咒物，跨节点持续生效", W / 2, 84);
      (node.offers || []).forEach((offer, i) => {
        const r = { x: W / 2 - 132 + i * 90, y: 96, w: 82, h: 74 };
        const c = offer.curse;
        ctx.fillStyle = offer.bought ? "rgba(80,70,95,0.35)" : "rgba(20,10,31,0.6)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = offer.bought ? "rgba(120,110,140,0.5)" : c.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        ctx.fillStyle = offer.bought ? "rgba(180,170,200,0.6)" : c.color;
        ctx.font = "16px 'Microsoft YaHei', 'PingFang SC', sans-serif";
        ctx.fillText(c.icon, r.x + r.w / 2, r.y + 16);
        ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
        ctx.fillText(c.name, r.x + r.w / 2, r.y + 36);
        ctx.font = "8px 'Microsoft YaHei', 'PingFang SC', sans-serif";
        ctx.fillStyle = "rgba(233,220,255,0.6)";
        const lines = c.desc.length > 16 ? [c.desc.slice(0, 16), c.desc.slice(16, 32)] : [c.desc];
        lines.forEach((l, li) => ctx.fillText(l, r.x + r.w / 2, r.y + 46 + li * 9));
        ctx.font = "9px 'Microsoft YaHei', 'PingFang SC', sans-serif";
        ctx.fillStyle = offer.bought ? "rgba(180,170,200,0.6)" : PALETTE.gold;
        ctx.fillText(offer.bought ? "已购入" : `${MARKET_COST[c.tier]} 结晶`, r.x + r.w / 2, r.y + r.h - 10);
      });
      this._drawButton(ctx, { x: W / 2 - 60, y: H - 40, w: 120, h: 22 }, "离开货摊");
      return;
    }

    if (this.overlay === "altar") {
      this._drawPanelFrame(ctx, W / 2 - 120, 66, 240, 130, `${def.icon} 月光祭坛`);
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(233,220,255,0.75)"; ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText("献上月光结晶祈愿，随机获得一件常见咒物", W / 2, 84);
      if (node.usedAltar) {
        ctx.fillStyle = PALETTE.gold;
        ctx.fillText(`祈愿应验：获得「${node.altarResult}」`, W / 2, 104);
      } else {
        this._drawButton(ctx, { x: W / 2 - 60, y: 118, w: 120, h: 24 }, "🌙 月光祈愿（10）", PALETTE.neon);
      }
      this._drawButton(ctx, { x: W / 2 - 60, y: H - 40, w: 120, h: 22 }, "离开祭坛");
      return;
    }

    if (this.overlay === "coffer") {
      this._drawPanelFrame(ctx, W / 2 - 120, 66, 240, 130, `${def.icon} 遗骸宝匣`);
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(233,220,255,0.75)"; ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText("尘封的石化残骸，开启后随机获得咒物，偶有圣骸", W / 2, 84);
      if (node.opened) {
        ctx.fillStyle = PALETTE.gold;
        ctx.fillText(`匣中之物：「${node.cofferResult}」`, W / 2, 104);
        this._drawButton(ctx, { x: W / 2 - 60, y: H - 40, w: 120, h: 22 }, "离开");
      } else {
        this._drawButton(ctx, { x: W / 2 - 60, y: 118, w: 120, h: 24 }, "🗝 打开宝匣", PALETTE.cyan);
      }
      return;
    }
  }

  render(ctx) {
    const W = this.game.width, H = this.game.height;
    this.bg.render(ctx, this.t);
    ctx.fillStyle = "rgba(20,10,31,0.55)";
    ctx.fillRect(0, 0, W, H);

    // 返回
    const back = this._backBtn();
    ctx.fillStyle = "rgba(185,107,255,0.14)"; ctx.fillRect(back.x, back.y, back.w, back.h);
    ctx.strokeStyle = PALETTE.neon; ctx.lineWidth = 1;
    ctx.strokeRect(back.x + 0.5, back.y + 0.5, back.w - 1, back.h - 1);
    ctx.fillStyle = PALETTE.neon; ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("‹ 返回", back.x + back.w / 2, back.y + back.h / 2 + 1);

    // 标题
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillStyle = PALETTE.text; ctx.font = "bold 16px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.shadowColor = PALETTE.neon; ctx.shadowBlur = 6;
    ctx.fillText(`魔女回廊 · 第 ${TowerRun.state.floor} / ${TowerRun.state.totalFloors} 层`, W / 2, 8);
    ctx.shadowBlur = 0;

    // 月光结晶
    ctx.textAlign = "right";
    ctx.fillStyle = PALETTE.cyan; ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText(`☾ 月光结晶 ${TowerRun.state.crystals}`, W - 10, 8);

    this._drawMap(ctx);

    // 底部咒物/圣骸栏
    const curseIds = Object.keys(TowerRun.state.curses).filter((k) => TowerRun.state.curses[k] > 0);
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    let bx = 10;
    const by = H - 12;
    if (curseIds.length || TowerRun.state.remains.length) {
      curseIds.forEach((id) => {
        const c = getCurse(id);
        if (!c) return;
        ctx.fillStyle = c.color;
        ctx.fillText(`${c.icon}${TowerRun.state.curses[id] > 1 ? "×" + TowerRun.state.curses[id] : ""}`, bx, by);
        bx += 22;
      });
      TowerRun.state.remains.forEach((id) => {
        bx += 4;
        ctx.fillStyle = PALETTE.gold;
        ctx.fillText("◈", bx, by);
        bx += 16;
      });
    } else {
      ctx.fillStyle = "rgba(233,220,255,0.4)";
      ctx.fillText("尚未拾取咒物 / 圣骸", bx, by);
    }

    if (this.overlay) this._drawOverlay(ctx);

    if (this.toastT > 0) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const a = Math.min(1, this.toastT);
      ctx.fillStyle = `rgba(20,10,31,${0.8 * a})`;
      ctx.fillRect(W / 2 - 150, H / 2 - 88, 300, 20);
      ctx.fillStyle = `rgba(255,207,92,${a})`;
      ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText(this.toast, W / 2, H / 2 - 78);
    }

    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }
}
