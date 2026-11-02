# 小步 step（xiaobu-step）

**作业管理系统 / homework tracker（开源）** — 两娃家庭自用：孩子端点作业清单，家长端看完成与检查（待确认／未完成／已完成）；纸笔作业拍照后由家长确认。

Open-source local family homework management for two kids: child checklist + parent review (pending confirm / incomplete / done), with photo proof for paper work.

> 当前主要在家里局域网使用；本仓库开源的是前端与局域网服务代码，**不含**真实作业库、孩子照片与课程材料。

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
