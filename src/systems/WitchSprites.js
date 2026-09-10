// 角色立绘精灵缓存：
// 读取 assets/witches 下三位魔女各四阶段的立绘 PNG。
// 图片已经离线预处理好（黑底抠图为透明 + 按内容裁边 + 压缩），
// 这里只需要按 (角色皮肤id, 形态id) 缓存加载好的 Image 对象即可，
// 不用再在运行时读像素做抠图（避免 file:// 打开时画布污染读不到像素的问题）。
//
// 只有下面 SPRITE_MAP 里列出的角色皮肤 id 才会用立绘渲染；
// 没有对应立绘的皮肤（如绯红魔女）会自动回退到原有的像素风矢量绘制，不受影响。
import { WITCH_FORMS } from "../data/witchForms.js";

// 角色皮肤 id → 立绘文件名前缀
const SPRITE_MAP = {
  default: "forest", // 叶林 · 森林魔女
  gold: "golden",    // 金橙 · 黄金魔女
  cyan: "haiyu",     // 海於 · 碧海魔女
};

const STAGE_ORDER = WITCH_FORMS.map((f) => f.id); // ["sailor","apprentice","witch","broom_witch"]

const cache = new Map(); // key: `${prefix}-${stage}` -> "loading" | "error" | HTMLImageElement

function loadSprite(prefix, stage) {
  const key = `${prefix}-${stage}`;
  const hit = cache.get(key);
  if (hit) return hit;
  cache.set(key, "loading");
  const img = new Image();
  img.onload = () => cache.set(key, img);
  img.onerror = () => cache.set(key, "error");
  img.src = `assets/witches/${prefix}-${stage}.png`;
  return "loading";
}

// 根据角色皮肤 id + 当前魔女形态 id，取立绘图片。
// 没有立绘 / 还没加载完成时返回 null，调用方应回退到原有矢量绘制。
export function getWitchSprite(skinId, formId) {
  const prefix = SPRITE_MAP[skinId];
  if (!prefix) return null;
  const stage = STAGE_ORDER.indexOf(formId);
  if (stage < 0) return null;
  const entry = loadSprite(prefix, stage);
  return entry instanceof HTMLImageElement ? entry : null;
}

// 该角色皮肤是否配有立绘（用于商城/图鉴判断要不要走立绘展示分支）
export function hasWitchSprites(skinId) {
  return !!SPRITE_MAP[skinId];
}

// 预加载所有角色立绘（3 套皮肤 × 4 个形态，共 12 张）。
// 修复"角色贴图有概率消失"问题：原先每张立绘都是第一次要画的时候才发起加载，
// 图片下载/解码完成前 getWitchSprite 会返回 null，导致那几帧回退成纯色方块（无立绘）。
// 这里在游戏一启动（还在标题页时）就把全部立绘提前发起加载，
// 等玩家真正进入关卡/切换形态时图片大概率早就绪，基本消除这个空窗期。
export function preloadWitchSprites() {
  for (const prefix of Object.values(SPRITE_MAP)) {
    for (let stage = 0; stage < STAGE_ORDER.length; stage++) {
      loadSprite(prefix, stage);
    }
  }
}

// 预览开关：给 Player / BossScene 一个总闸，方便整体关掉，恢复矢量画法。
export const WITCH_SPRITES_ENABLED = true;
