// 入口：初始化引擎（横屏 480x270）并进入标题
import { Game } from "./engine/Game.js";
import { MenuScene } from "./scenes/MenuScene.js";
import { preloadWitchSprites } from "./systems/WitchSprites.js";
import { preloadBossSprites } from "./systems/BossSprites.js";
import { preloadObstacleSprites } from "./systems/ObstacleSprites.js";

// 修复"角色/Boss/障碍物贴图有概率消失(卡成纯色方块)"问题：
// 这几类贴图原先都是第一次要画的时候才临时发起加载（懒加载），
// 图片还没下载解码完的那几帧会回退成纯色矢量方块，网络/磁盘慢一点就容易被撞见。
// 这里在游戏一启动、还停留在标题页时就把全部贴图提前发起加载，
// 等玩家真正进入关卡/形态进化/Boss战时图片基本都已就绪。
preloadWitchSprites();
preloadBossSprites();
preloadObstacleSprites();

const game = new Game({
  canvas: document.getElementById("game"),
  width: 480,   // 横屏 16:9 内部分辨率
  height: 270,
});

game.changeScene(new MenuScene(game));
game.start();

window.__game = game;
