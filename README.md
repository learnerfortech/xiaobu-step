# 小步 step（xiaobu-step）

**作业管理系统 / homework tracker（开源）** — 两娃家庭自用：孩子端点作业清单，家长端看完成与检查（待确认／未完成／已完成）；纸笔作业拍照后由家长确认。

Open-source local family homework management for two kids: child checklist + parent review (pending confirm / incomplete / done), with photo proof for paper work.

> 当前主要在家里局域网使用；本仓库开源的是前端与局域网服务代码，**不含**真实作业库、孩子照片与课程材料。

## 不是链接：要在本机装，可交给 AI

发出去后，别人常说「这啥东西／不会用／怎么装」。先看下面三块。

### 这是什么／不是什么

不是现成的 App 链接，也不是打开就能用的网页。

是在你自己电脑上跑的小网站源码。装好之后，家里设备用浏览器打开。

不含真实家庭作业数据、孩子照片、课程材料。那些只留在你自己的电脑上。

### 不会装怎么弄

把本仓库链接丢给 Cursor、ChatGPT 等 AI，可以直接说：

> 按 README 在我 Mac 上装起来，用空数据目录，起 8766。

AI 按下面「快速开始（Mac）」做。你不用先自己啃那些命令。

### 装好后干什么

手机、平板和这台电脑连同一个 Wi‑Fi，用浏览器打开入口（地址见「快速开始」）。

作业不会自动出现。要你自己，或再让 AI，往本机的作业库里挂。

不要把真实照片、作业推回这个公开仓库。

## 目录

- `frontend/` — 静态前端（打开 `index.html`）
- `lan-server/` — 本机 Python 局域网服务（任务库、照片上传等）
- `examples/` — 示例说明（不含真实家庭数据）

## 快速开始（Mac）

1. 准备一个空的本地数据目录，例如 `~/xiaobu-local-data`（不要提交到 Git）。
2. 启动服务（按你机器路径改）：

```bash
python3 lan-server/server.py \
  --root "$(pwd)/frontend" \
  --db "$HOME/xiaobu-local-data/tasks.sqlite3" \
  --lan-ip "$(ipconfig getifaddr en0)" \
  --port 8766
```

3. 同一 Wi‑Fi 下用浏览器打开：

`http://<你的局域网IP>:8766/index.html?transport=lan`

孩子入口常见为 `#/jared`、`#/joey`，家长为 `#/parent`。

## 注意

- 仓库默认忽略 sqlite、照片、作业材料包。请勿把真实家庭数据推到公开仓。
- `frontend/assets/buddies/` 中的伙伴立绘来自第三方作品，若商用或二次分发请自行替换为自有素材。
- 开源协议：MIT（见 `LICENSE`）。

## 反馈

Issue 区留言即可。
