// 音频管理器：BGM 循环播放（菜单/关卡自动切换）+ 音效叠放播放 + 静音开关（记忆到本地存档）
//
// 说明：改用 Web Audio API（AudioContext + AudioBufferSourceNode）而不是原生
// <audio> 元素实现。原因：
// 1. 旧实现每次 play() 都会 new Audio()/cloneNode() 生成一个新的 <audio> 元素，
//    这些元素播放结束后并不会被立刻回收，且部分浏览器（尤其移动端 WebKit）对同时
//    存在的 <audio> 元素数量有硬性上限——一旦点击音效连续触发导致元素堆积超限，
//    浏览器会“抢占”/静音其中的一路播放，正在循环的 BGM 就可能被顶掉，
//    表现为“点击之后 BGM 突然卡顿或没声音”。
// 2. Web Audio 里所有声音都在同一个 AudioContext 里混音输出，不受“并发音频元素数”
//    限制，AudioBufferSourceNode 是一次性轻量对象，播放结束(onended)后自动可回收，
//    不会累积。
// 3. 可以给 BGM 和每种音效分别接一个 GainNode，独立、精确地控制音量，
//    解决“音效被 BGM 盖住听不见”的问题（之前所有音效共用同一个音量倍数，
//    但各段素材原始响度不同，导致有的音效相对 BGM 音量偏小）。
//
// 重要：本模块任何环节（AudioContext 不可用 / 解码失败 / 浏览器策略限制等）
// 出问题都只应“听不到声音”，绝不能抛出未捕获异常向外传播——否则会打断
// 场景切换所在的 requestAnimationFrame 循环，导致整个游戏卡死（点哪都没反应）。
// 因此所有对外方法、以及 AudioContext 的创建，都包了 try/catch 兜底。
const BASE = "assets/audio/";

const SFX_FILES = {
  collectStar: "sfx_collect_star.mp3",
  collectPotion: "sfx_collect_potion.mp3",
  rareStar: "sfx_rarestar.mp3",
  hit: "sfx_hit.mp3",
  death: "sfx_death.mp3",
  click: "sfx_click.mp3",
};

// 各音效相对增益微调：原始素材响度不完全一致（click 天生比较“冲耳”，
// 其余几个偏弱），这里单独放大后几个，让它们在 BGM 播放时也能被听清。
// hit（受击/碰撞音效）：略调低响度，配合下方低通滤波去掉刺耳高频，听感更柔和。
const SFX_GAIN = {
  collectStar: 1.0,
  collectPotion: 1.0,
  rareStar: 1.2,
  hit: 1.15,
  death: 1.7,
  click: 1.0,
};

// 部分音效额外接一个 BiquadFilter，柔化音色（目前仅 hit：低通滤波器削掉
// 尖锐高频，让"碰撞"声从"哔"的一声变得闷一些、更柔和，不那么刺耳）。
const SFX_FILTER = {
  hit: { type: "lowpass", frequency: 2200, q: 0.7 },
};

const BGM_FILES = {
  menu: "bgm_menu.mp3",
  run: "bgm_run.mp3",
};

const MUTE_KEY = "witchTrial_audioMuted";

class AudioManager {
  constructor() {
    this.muted = (() => {
      try { return localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { return false; }
    })();
    this.sfxVol = 0.85;
    this.bgmVol = 0.32;

    this.ctx = null;
    this._masterGain = null;
    this._sfxBus = null;
    this._bgmBus = null;

    this._buffers = {};          // url -> 已解码的 AudioBuffer（BGM/SFX 共用缓存，只解码一次）
    this._loadPromises = {};     // url -> 解码中的 Promise，避免重复请求
    this._bgmSource = null;      // 当前播放中的 BGM 节点
    this._curBgmId = null;       // 当前已经在播的 BGM id
    this._wantedBgmId = null;    // 期望播放的 BGM id（用于处理"加载中又切换"的竟态）
    this._pendingBgm = null;     // 解锁前排队等待播放的 BGM id

    this._unlocked = false;      // 浏览器要求一次用户交互后才允许真正出声
    this._ctxFailed = false;     // AudioContext 不可用/创建失败时置位，避免反复重试

    // 注意：这里只绑定"解锁"监听，不在构造函数里创建 AudioContext / 发网络请求，
    // 尽量保证 import 这个模块本身绝对不会有副作用报错（哪怕运行环境完全不支持音频）。
    try {
      const unlock = () => this._unlock();
      window.addEventListener("pointerdown", unlock, { once: true });
      window.addEventListener("keydown", unlock, { once: true });
      window.addEventListener("touchstart", unlock, { once: true, passive: true });
    } catch (e) { /* 忽略：极端环境下 window 事件绑定失败也不影响游戏主体 */ }
  }

  _ensureCtx() {
    if (this.ctx) return this.ctx;
    if (this._ctxFailed) return null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this._ctxFailed = true; return null; }
      const ctx = new AC();
      const masterGain = ctx.createGain();
      // 主输出限幅：多路音效/BGM 同时叠加时把峰值压住，避免任何一次意外的
      // 多路重叠（连续拾取六芒星、快速连点等）在输出端直接削波产生刺耳爆音。
      const masterLimiter = ctx.createDynamicsCompressor();
      masterLimiter.threshold.value = -12;
      masterLimiter.knee.value = 6;
      masterLimiter.ratio.value = 12;
      masterLimiter.attack.value = 0.003;
      masterLimiter.release.value = 0.25;
      masterGain.connect(masterLimiter);
      masterLimiter.connect(ctx.destination);
      const sfxBus = ctx.createGain();
      sfxBus.gain.value = this.muted ? 0 : this.sfxVol;
      // 音效专用压缩：拾取物密集出现时会短时间内多次重叠播放同一音效，
      // 未经压缩的话叠加响度会远超单次播放，听起来又大又刺耳；压缩器让
      // 叠加几次也不会明显更炸耳。
      const sfxLimiter = ctx.createDynamicsCompressor();
      sfxLimiter.threshold.value = -20;
      sfxLimiter.knee.value = 10;
      sfxLimiter.ratio.value = 8;
      sfxLimiter.attack.value = 0.002;
      sfxLimiter.release.value = 0.15;
      sfxBus.connect(sfxLimiter);
      sfxLimiter.connect(masterGain);
      const bgmBus = ctx.createGain();
      bgmBus.gain.value = this.muted ? 0 : this.bgmVol;
      bgmBus.connect(masterGain);
      this.ctx = ctx;
      this._masterGain = masterGain;
      this._sfxBus = sfxBus;
      this._bgmBus = bgmBus;
      // 拿到可用的 ctx 后才开始后台预解码素材，避免播放时的加载卡顿。
      this._preloadAll();
      return ctx;
    } catch (e) {
      this._ctxFailed = true;
      return null;
    }
  }

  _preloadAll() {
    try {
      const urls = [
        ...Object.values(SFX_FILES),
        ...Object.values(BGM_FILES),
      ].map((f) => BASE + f);
      for (const url of urls) this._loadBuffer(url).catch(() => {});
    } catch (e) { /* 忽略 */ }
  }

  _loadBuffer(url) {
    try {
      if (this._buffers[url]) return Promise.resolve(this._buffers[url]);
      if (this._loadPromises[url]) return this._loadPromises[url];
      const ctx = this._ensureCtx();
      if (!ctx) return Promise.reject(new Error("no AudioContext"));
      const p = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => {
          this._buffers[url] = buf;
          delete this._loadPromises[url];
          return buf;
        })
        .catch((e) => {
          delete this._loadPromises[url];
          throw e;
        });
      this._loadPromises[url] = p;
      return p;
    } catch (e) {
      return Promise.reject(e);
    }
  }

  _unlock() {
    try {
      if (this._unlocked) return;
      this._unlocked = true;
      const ctx = this._ensureCtx();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      if (this._pendingBgm) {
        const id = this._pendingBgm;
        this._pendingBgm = null;
        this.playBgm(id);
      }
    } catch (e) { /* 忽略：解锁失败最多是没声音，不影响游戏运行 */ }
  }

  // 播放一次性音效，可重叠播放（如连续拾取）；用完自动释放，不会累积节点。
  play(id) {
    try {
      if (this.muted) return;
      const file = SFX_FILES[id];
      if (!file) return;
      const ctx = this._ensureCtx();
      if (!ctx) return;
      const url = BASE + file;
      this._loadBuffer(url)
        .then((buf) => {
          try {
            if (this.muted) return;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const gain = ctx.createGain();
            gain.gain.value = SFX_GAIN[id] != null ? SFX_GAIN[id] : 1;
            // 可选柔化滤波：接在 src 与 gain 之间，只影响音色不影响响度
            const filterCfg = SFX_FILTER[id];
            let filterNode = null;
            if (filterCfg) {
              filterNode = ctx.createBiquadFilter();
              filterNode.type = filterCfg.type;
              filterNode.frequency.value = filterCfg.frequency;
              if (filterCfg.q != null) filterNode.Q.value = filterCfg.q;
              src.connect(filterNode);
              filterNode.connect(gain);
            } else {
              src.connect(gain);
            }
            gain.connect(this._sfxBus);
            src.onended = () => {
              try { src.disconnect(); if (filterNode) filterNode.disconnect(); gain.disconnect(); } catch (e2) { /* 忽略 */ }
            };
            src.start(0);
          } catch (e2) { /* 忽略：单次播放失败不影响后续 */ }
        })
        .catch(() => { /* 加载失败时静默跳过，不影响游戏 */ });
    } catch (e) { /* 忽略 */ }
  }

  // 播放/切换循环 BGM；同一首正在播放（或正在加载）时不重复触发。
  playBgm(id) {
    try {
      if (!BGM_FILES[id]) return;
      if (!this._unlocked) {
        this._pendingBgm = id;
        this._wantedBgmId = id;
        return;
      }
      if (this._wantedBgmId === id) return;
      this._wantedBgmId = id;
      const ctx = this._ensureCtx();
      if (!ctx) return;
      const url = BASE + BGM_FILES[id];
      this._loadBuffer(url)
        .then((buf) => {
          try {
            // 加载完成前目标又被切换了（比如快速连续换场景），放弃这次，避免叠放两路 BGM
            if (this._wantedBgmId !== id) return;
            this._stopBgmSource();
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            src.connect(this._bgmBus);
            src.start(0);
            this._bgmSource = src;
            this._curBgmId = id;
          } catch (e2) { /* 忽略 */ }
        })
        .catch(() => { /* 忽略加载失败 */ });
    } catch (e) { /* 忽略：绝不让 BGM 播放失败影响场景切换 */ }
  }

  _stopBgmSource() {
    try {
      if (this._bgmSource) {
        try { this._bgmSource.stop(); this._bgmSource.disconnect(); } catch (e) { /* 忽略 */ }
        this._bgmSource = null;
      }
      this._curBgmId = null;
    } catch (e) { /* 忽略 */ }
  }

  stopBgm() {
    try {
      this._stopBgmSource();
      this._wantedBgmId = null;
      this._pendingBgm = null;
    } catch (e) { /* 忽略 */ }
  }

  setMuted(m) {
    try {
      this.muted = !!m;
      try { localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0"); } catch (e2) { /* 忽略存储失败 */ }
      if (this._bgmBus) this._bgmBus.gain.value = this.muted ? 0 : this.bgmVol;
      if (this._sfxBus) this._sfxBus.gain.value = this.muted ? 0 : this.sfxVol;
    } catch (e) { /* 忽略 */ }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }
}

// 全局单例：各场景直接 import { audio } 使用
export const audio = new AudioManager();
