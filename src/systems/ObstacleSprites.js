// 障碍物贴图缓存：
// 读取 assets/obstacles 下按关卡命名的贴图（迷雾森林/毒沼藤林/水晶洞窟/幽灵城堡/月蚀祭坛），
// 图片已离线预处理好（紧裁边框 + 压缩），运行时只需按关卡名缓存加载好的 Image 对象。
// 无尽模式等没有对应贴图的关卡名会自动回退到原有的像素风矢量绘制，不受影响。
import { LEVELS } from "../data/levels.js";

const cache = new Map(); // key: 关卡名 -> "loading" | "error" | HTMLImageElement

function loadSprite(levelName) {
  const hit = cache.get(levelName);
  if (hit) return hit;
  cache.set(levelName, "loading");
  const img = new Image();
  img.onload = () => cache.set(levelName, img);
  img.onerror = () => cache.set(levelName, "error");
  img.src = `assets/obstacles/${levelName}.png`;
  return "loading";
}

// 根据关卡名取障碍物贴图。没有贴图/还没加载完成时返回 null，调用方应回退到原有矢量绘制。
export function getObstacleSprite(levelName) {
  if (!levelName) return null;
  const entry = loadSprite(levelName);
  return entry instanceof HTMLImageElement ? entry : null;
}

// 预加载全部关卡的障碍物贴图，游戏启动时提前发起加载，
// 避免刚进关卡那几帧图片还没下载完，回退成纯色矢量形状。
export function preloadObstacleSprites() {
  for (const l of LEVELS) loadSprite(l.name);
}
