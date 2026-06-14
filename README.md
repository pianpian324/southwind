# 盐湖记 · 运城盐湖生态观测平台

🌿 一个面向山西运城盐池周边居民的生物多样性观测社区 WebApp。

## 功能

- **观测记录** — 拍照与文字记录，GPS/时间/天气自动捕获，支持离线
- **物种库** — 11 种盐湖特色物种，支持搜索/分类/对比
- **生态地图** — 7 个生境热力点，季节时间轴切换
- **节气任务** — 跟着节气观测，完成挑战解锁徽章
- **声音地图** — 录制盐池环境音，共建声景档案
- **社区数据墙** — 达人榜，空白区域探索号召
- **个人中心** — 自然档案、数据导出 CSV、年度报告
- **PWA 离线支持** — Service Worker + IndexedDB 本地持久化

## 技术栈

- 纯前端 SPA（无后端依赖）
- IndexedDB 本地存储
- Service Worker 离线缓存
- 响应式设计（移动端优先）

## 部署

本项目可直接部署至 GitHub Pages 或任意静态托管服务。

### GitHub Pages

1. 进入仓库 Settings → Pages
2. 选择 `master` 分支，根目录
3. 访问 `https://pianpian324.github.io/southwind/`

### 自定义域名

在仓库 Settings → Pages 中配置自定义域名（已购买 `southwind` 域名）。

## 开发

```bash
git clone https://github.com/pianpian324/southwind.git
cd southwind
# 直接在浏览器打开 index.html 即可
```

## 数据

所有数据存储在浏览器本地 IndexedDB 中，无需服务器。物种数据基于运城盐湖公开生态研究报告。

## 致谢

- 运城盐湖生态研究团队
- 山西大学郭东罡团队
- 社区观测志愿者

---

*守护盐湖，从每一次观测开始。*
