# 魔女试炼 · 迭代实验室 / Witch Trial (Lab Branch)

<p align="center">
  <a href="https://muyuxuanzhi.github.io/teat/"><img src="https://img.shields.io/badge/🧪_预览这里的最新改动-立即打开-2d98da?style=for-the-badge" alt="预览"></a>
  <img src="https://img.shields.io/badge/身份-开发迭代分支-f39c12?style=for-the-badge" alt="branch">
  <img src="https://img.shields.io/badge/引擎-HTML5%20Canvas%20自研-6c5ce7?style=for-the-badge" alt="engine">
  <a href="https://github.com/muyuxuanzhi/witch-trial"><img src="https://img.shields.io/badge/正式版-witch--trial-ff69b4?style=for-the-badge" alt="正式版"></a>
</p>

<p align="center">
  <img src="assets/cover.png" alt="魔女试炼 主角 —— 森林魔女 叶林" width="60%">
</p>

《teat》是《魔女试炼》的**开发迭代分支**。正式版 [witch-trial](https://github.com/muyuxuanzhi/witch-trial) 追求的是"打磨完成、随时能丢给别人试玩"的稳定体验；而这里更像是一间常年开着灯的深夜工作室——新的 Boss 招式、还没调完的数值、刚写完、连热乎气都没散的机制，都会先在这儿跑一遍，觉得靠谱了再正式搬进 witch-trial。没有"版本发布通知"，没有对外承诺的稳定度，只有一次又一次改了又改的打磨痕迹。

> 如果你只是想完整体验一遍游戏，建议直接玩 [正式版 witch-trial](https://muyuxuanzhi.github.io/witch-trial/)；如果你对"东西是怎么一点点变出来"感兴趣，欢迎在这里蹲一下。

## 🧪 这里最近在实验什么

- **开场"热身"小技能**：Boss 血量首次掉到 85% 时，会提前甩出一波有辨识度的专属弹幕，给开局节奏加一个小高潮，也算是提前"打个招呼"
- **背景音乐重新编排**：钢琴主旋律与海浪环境音混合播放，并调整了两者的音量配比，让"室内乐器声"和"户外白噪音"叠在一起时更自然；收集星星的反馈音效也换成了更清脆的一版
- **地狱难度符卡系统**：自机判定改为高亮圆点、Boss 血量减半与残血节点各触发一次多彩大招符卡
- **细节打磨**：缓冲区商城新增次数补充券、图鉴分页与标题重叠修复、障碍物荧光召唤特效与收集连击反馈等

这些改动大多先在这条分支验证手感，稳定后再合并进正式版。

## 主角一览

<img src="assets/witch-character.png" alt="森林魔女 叶林 角色设定" width="260" align="right">

主角是森林魔女学院见习生 **叶林**，靠收集散落的魔法星星积累试炼值、逐级进化形态，最终对决盘踞祭坛的月蚀魔女。完整的角色设定、可解锁角色（黄金魔女·金橙 / 碧海魔女·海於）与剧情彩蛋，见正式版 [witch-trial 的完整说明](https://github.com/muyuxuanzhi/witch-trial#主角介绍)。

## 核心玩法

- **↑ / W**：切上轨　**↓ / S**：切下轨（手机：上滑 / 下滑全屏任意位置切轨）
- 跑酷阶段：躲红色障碍、吃金色光点，收集试炼值；每攒够一定量触发三选一 Buff 并进化魔女形态
- 达到本关目标后进入武器选择，再进入弹幕 Boss 战
- Boss 战：纵向移动走位、射击输出，收集六芒星触发狂暴；击败 Boss 通关解锁下一关

## 本地运行

```bash
python -m http.server 5500   # 或 npx serve .
# 浏览器打开 http://localhost:5500
```

## 技术看点

- 自研游戏循环（dt 上限、场景栈）与整数放大像素渲染管线
- 程序化内容生成：障碍/光点随机布轨 + 难度随时间爬升
- 肉鸽成长系统：试炼值 → 形态进化 + 三选一 Buff
- 弹幕 Boss 战：多形态弹幕、六芒星狂暴机制、符卡大招、走位射击
- 参数集中在 `src/data/config.js`，可快速调优
- 电脑端键鼠 + 手机端触屏双适配

---

## 关于作者

我是 **muyuxuanzhi**，本项目从策划设计到全部代码独立完成：关卡/Boss 弹幕设计、肉鸽成长与经济数值、商城/图鉴/成就/存档系统均为自研。目前在找 **游戏策划（数值 / 系统设计）** 或 **游戏客户端 / 玩法程序员（Unity · Unreal · 自研引擎方向）** 相关机会，欢迎交流 🙌

更多项目与技术栈 → 我的 [GitHub 主页](https://github.com/muyuxuanzhi)
