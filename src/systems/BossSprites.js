// Boss 贴图缓存：
// 读取 assets/bosses 下按 Boss 名命名的贴图（邪恶蘑菇/邪恶藤蔓/水晶魔像/幽灵领主/月蚀魔女），
// 图片已离线预处理好（紧裁边框 + 压缩），运行时只需按 Boss 名缓存加载好的 Image 对象。
// 没有对应贴图的 Boss 会自动回退到原有的像素风矢量绘制，不受影响。
import { BOSSES } from "../data/bosses.js";

const cache = new Map(); // key: Boss名 -> "loading" | "error" | HTMLImageElement

function loadSprite(bossName) {
  const hit = cache.get(bossName);
  if (hit) return hit;
  cache.set(bossName, "loading");
  const img = new Image();
  img.onload = () => cache.set(bossName, img);
  img.onerror = () => cache.set(bossName, "error");
  img.src = `assets/bosses/${bossName}.png`;
  return "loading";
}

// 根据 Boss 名取贴图。没有贴图/还没加载完成时返回 null，调用方应回退到原有矢量绘制。
export function getBossSprite(bossName) {
  if (!bossName) return null;
  const entry = loadSprite(bossName);
  return entry instanceof HTMLImageElement ? entry : null;
}

// 预加载全部 5 个 Boss 贴图，游戏启动时提前发起加载，
// 避免刚进入 Boss 战那几帧图片还没下载完，回退成纯色矢量形状。
export function preloadBossSprites() {
  for (const b of BOSSES) loadSprite(b.name);
}
