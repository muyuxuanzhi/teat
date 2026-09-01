// 开场对话：点击开始游戏后进入。逐句显示对话，点击/回车推进，
// 最后一句后进入 RunScene 正式开始魔女试炼。
import { Scene } from "../engine/Scene.js";
import { PALETTE } from "../engine/Game.js";
import { Background } from "../systems/Background.js";
import { Save } from "../systems/Save.js";
import { getSkin } from "../data/skins.js";

export class IntroScene extends Scene {
  // towerNode: 若从"魔女回廊"地图进入，携带当前回廊节点信息，会一路透传给 RunScene
  constructor(game, level, towerNode = null) {
    super(game);
    this.t = 0;
    this.save = Save.load();
    this.level = level || null;
    this.towerNode = towerNode || null;
    this.bg = new Background(game.width, game.height, getSkin("background", this.save.equipped.background));
    // 说话人：跟随玩家当前装备的角色皮肤，而不是固定写死叶林；
    // 台词内容也按角色人设分开写（叶林认真型 / 金橙慵懒电波型 / 海於冷淡独处型），
    // 不是简单换个名字。
    const charSkin = getSkin("character", this.save.equipped.character);
    const who = charSkin?.charName || "叶林";
    const isGolden = who === "金橙";
    const isHaiyu = who === "海於";
    // 对话按关卡定制
    const lvName = this.level ? this.level.name : "";
    const bossName = this.level ? this.level.subtitle : "";
    if (this.level && this.level.endless) {
      if (isGolden) {
        this.lines = [
          { who, text: "♾ 无尽试炼……那岂不是巧克力也能无限吃？" },
          { who, text: "Boss 一直来也没关系，正好当运动，不然甜食都要堆成山了。" },
          { who, text: "为了金灿灿和甜品……power！！！出发～" },
        ];
      } else if (isHaiyu) {
        this.lines = [
          { who, text: "♾ 无尽……那我们俩就慢慢耗着。" },
          { who, text: "累了就换你顶一会儿，我不会说出去的。" },
          { who, text: "出发。" },
        ];
      } else {
        this.lines = [
          { who, text: "♾ 无尽试炼……星光没有尽头呢。" },
          { who, text: "Boss 会一直降临，收集度与属性也会一直叠加……" },
          { who, text: "看我能撑到第几轮吧——出发！" },
        ];
      }
    } else if (this.level) {
      if (isGolden) {
        this.lines = [
          { who, text: `第${this.level.index}关 · ${lvName}` },
          { who, text: "唔……先让我打个哈欠。呼啊——好，精神了（一半）。" },
          { who, text: `那……为了金灿灿和甜品，${bossName}，就交给我了！` },
        ];
      } else if (isHaiyu) {
        this.lines = [
          { who, text: `第${this.level.index}关 · ${lvName}` },
          { who, text: "人多的地方不适合我，有你在旁边就够了。" },
          { who, text: "嗯？你说作弊？那可是我海之力契约的伙伴哎，也就是说是我的一部分，哼哼~" },
        ];
      } else {
        this.lines = [
          { who, text: `第${this.level.index}关 · ${lvName}` },
          { who, text: "呼……我准备好了。" },
          { who, text: `那……我的魔女试炼，${bossName}，现在开始！` },
        ];
      }
    } else {
      if (isGolden) {
        this.lines = [
          { who, text: "唔……那就慢慢开始吧，别催我。" },
          { who, text: "为了金灿灿和甜品……power！！！" },
        ];
      } else if (isHaiyu) {
        this.lines = [
          { who, text: "安静点比较好。走吧。" },
          { who, text: "嗯，出发。" },
        ];
      } else {
        this.lines = [
          { who, text: "深呼吸……我准备好了。" },
          { who, text: "我的魔女试炼，现在开始！" },
        ];
      }
    }
    this.idx = 0;
    this.charT = 0;       // 打字机计时
    this.done = false;    // 当前句是否显示完
    // 对话一开始就在后台预取 RunScene 模块（及其依赖链），而不是等到对话
    // 读完点击“开始试炼”那一刻才发起加载：这样有对话展示的这几秒时间可以
    // 把模块请求 + 解析都提前做完，避免"点击瞬间"才发起一大串请求导致的
    // 明显卡顿；弱网下也能大幅降低"点了没反应/进不去"的概率。
    this._runScenePromise = import("./RunScene.js").catch((e) => {
      console.warn("[IntroScene] 预加载 RunScene 失败，将在点击时重试", e);
      return null;
    });
  }

  _curFullText() {
    return this.lines[this.idx].text;
  }

  _shownText() {
    const full = this._curFullText();
    const n = Math.floor(this.charT * 22);
 return full.slice(0, n);
  }

  // 按最大宽度把一整句台词按字符切成多行（中文不含空格，逐字符累加测量最稳）。
  // 调用前需确保 ctx.font 已设置为正文字号，否则测量宽度不准。
  _wrapLines(ctx, text, maxWidth) {
    const lines = [];
    let cur = "";
    for (const ch of text) {
      const test = cur + ch;
      if (cur.length > 0 && ctx.measureText(test).width > maxWidth) {
        lines.push(cur);
        cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  _advance() {
    const full = this._curFullText();
    if (this._shownText().length < full.length) {
      // 未显示完：直接显示完整句
      this.charT = full.length / 22 + 0.01;
      return;
    }
    // 已显示完：进入下一句或开始游戏
    if (this.idx < this.lines.length - 1) {
      this.idx++;
      this.charT = 0;
    } else {
      this._startGame();
    }
  }

  _startGame() {
    // 防止异步模块加载期间用户再次点击，重复触发切场景
    if (this._starting) return;
    this._starting = true;
    this._loadT = 0;         // 加载计时，用于 render 显示"加载中"与超时兜底
    // 优先复用对话期间就已经在后台预取的 Promise（此时大概率已经加载完成，
    // 几乎瞬间进入下一场景）；如果预取失败了（或还没建立），才现场再 import 一次。
    const loader = this._runScenePromise || import("./RunScene.js");
    loader
      .then((m) => {
        if (!m) throw new Error("RunScene module not loaded");
        this.game.changeScene(new m.RunScene(this.game, this.level, null, this.towerNode));
      })
      .catch((e) => {
        // 加载失败（弱网/超时等）：不能让玩家卡在这里点了完全没反应——
        // 重置状态允许再次点击重试，并现场发起一次全新的 import。
        console.warn("[IntroScene] 进入关卡失败，可再次点击重试", e);
        this._starting = false;
        this._loadT = 0;
        this._runScenePromise = null;
      });
  }

  update(dt, input) {
    this.t += dt;
    this.charT += dt;
    this.bg.update(dt, 40);

    // ===== 移动端衔接 Bug 修复 =====
    // 刚切换进来的 0.25 秒内忽略任何点击 / 回车 / 空格，
    // 避免上一场景（菜单/选关/结算）的最后一次 tap 或回车被原样带入本场景
    // ——这正是"对话框出现瞬间立刻被当作下一句跳过"的根因。
    // 注意：用独立的初始化标记，而不是 `if (!this._guardT)`——否则守卫时间
    // 递减到 0 后，下一帧 `!0` 为真会把守卫重新置回 0.25，造成反复重置。
    if (this._guardT === undefined) this._guardT = 0.25;
    if (this._guardT > 0) this._guardT -= dt;

    // 触发源：键盘回车/空格 + canvas 指针按下 + 触摸轻触(tap) 三者任一。
    // 手机上 pointerdown 偶尔不派发，tap 作为兜底，保证独白一定点得动。
    const advanceInput = input.justPressed("enter", " ") || input.pointer.justDown || input.tap;
    if (this._guardT <= 0 && !this._starting && advanceInput) {
      this._advance();
    }

    // ===== 加载超时兜底 =====
    // 已经点击"开始试炼"进入加载态后，若 RunScene 迟迟没加载完（弱网/请求丢失），
    // 4 秒后自动重置 _starting 并丢弃旧 Promise，允许玩家再点一次重新发起加载，
    // 避免手机弱网下永久卡在独白最后一句。
    if (this._starting) {
      this._loadT = (this._loadT || 0) + dt;
      if (this._loadT > 4) {
        console.warn("[IntroScene] 加载超时，重置以便重试");
        this._starting = false;
        this._loadT = 0;
        this._runScenePromise = null;
      }
    }
  }

  render(ctx) {
    const W = this.game.width, H = this.game.height;
    this.bg.render(ctx, this.t);
    ctx.fillStyle = "rgba(20,10,31,0.68)";
    ctx.fillRect(0, 0, W, H);

    // 对话框：先按最终整句台词换行，算出需要几行，再决定框高——
    // 避免固定单行高度时长台词（如海於的作弊梗那句）直接撑破/溢出对话框。
    const textX = 28;
    const lineH = 15;
    ctx.font = "14px 'Microsoft YaHei', 'PingFang SC', sans-serif"; // 换行测量要用正文字号，否则宽度不准
    const maxTextWidth = W - textX - 24; // 右侧留出与左侧对称的边距
    const fullLines = this._wrapLines(ctx, this._curFullText(), maxTextWidth);
    const boxH = Math.max(70, 34 + fullLines.length * lineH + 16);
    const boxY = H - boxH - 16;
    ctx.fillStyle = "rgba(42,26,58,0.92)";
    ctx.fillRect(16, boxY, W - 32, boxH);
    ctx.strokeStyle = PALETTE.neon;
 ctx.lineWidth = 1;
    ctx.shadowColor = PALETTE.neon;
    ctx.shadowBlur = 8;
    ctx.strokeRect(16.5, boxY + 0.5, W - 33, boxH - 1);
    ctx.shadowBlur = 0;

    // 说话人
    const line = this.lines[this.idx];
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = PALETTE.gold;
    ctx.font = "bold 12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText(line.who, textX, boxY + 10);

    // 正文（打字机，按已换好的行逐行揭示字符，行数与框高在上面已经算好）
    ctx.fillStyle = PALETTE.text;
    ctx.font = "14px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    let remaining = this._shownText().length;
    for (let i = 0; i < fullLines.length; i++) {
      const lineText = fullLines[i];
      const shown = lineText.slice(0, Math.max(0, remaining));
      remaining -= lineText.length;
      if (shown) ctx.fillText(shown, textX, boxY + 30 + i * lineH);
    }

    // 提示：进入加载态时显示"加载中"，否则显示闪烁的继续/开始箭头
    if (this._starting) {
      // 已点击开始试炼，正在加载 RunScene：给出明确反馈，避免被误认为"卡死点不动"
      ctx.fillStyle = PALETTE.gold;
      ctx.font = "12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.textAlign = "right";
      const dots = ".".repeat(1 + (Math.floor(this.t * 2) % 3));
      ctx.fillText("✦ 加载中" + dots, W - 28, boxY + boxH - 18);
    } else if (this._shownText().length >= this._curFullText().length) {
      if (Math.floor(this.t * 2) % 2 === 0) {
        ctx.fillStyle = PALETTE.cyan;
        ctx.font = "12px 'Microsoft YaHei', 'PingFang SC', sans-serif";
        ctx.textAlign = "right";
        const tip = this.idx < this.lines.length - 1 ? "▼ 点击继续" : "▼ 点击开始试炼";
      ctx.fillText(tip, W - 28, boxY + boxH - 18);
      }
    }
    ctx.textAlign = "left";

    // ===== 顶部小提示：移动端竖屏请横屏 =====
    if (this.game.scale && this.game.scale < 0.55) {
      // 当前缩放比 < 0.55（典型竖屏场景）：顶部一条横屏提示
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,207,92,0.85)";
      ctx.font = "10px 'Microsoft YaHei', 'PingFang SC', sans-serif";
      ctx.fillText("📱 建议横屏体验更佳（请转动手机）", W / 2, 12);
      ctx.textAlign = "left";
    }
  }
}
