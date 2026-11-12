# 小步 step（xiaobu-step）

**作业管理系统 / homework tracker（开源）** — 两娃家庭自用：孩子端点作业清单，家长端看完成与检查（待确认／未完成／已完成）；需要检查的纸笔作业由家长确认，照片按任务要求提交。

Open-source local family homework management for two kids: child checklist + parent review (pending confirm / incomplete / done), with per-task photo requirements for paper work.

> 当前主要在家里局域网使用；本仓库开源的是前端与局域网服务代码，**不含**真实作业库、孩子照片与课程材料。

## 这是什么／不是什么

- **不是**现成的 App，也没有一个点开就能用的网址。
- **是**小网站的源码，要在你自己的电脑（目前文档以 macOS 为准）上跑起来。
- **不含**真实作业数据：没有孩子照片，也没有课程和作业内容。
- 当前是**可信家庭局域网内的单家庭版本**，不是已经具备账号认证的多家庭云服务。请先阅读 [安全边界](SECURITY.md)。

## ⭐ 具体怎么用

> [!IMPORTANT]
> **把本仓库链接丢给 Cursor、ChatGPT 或其他 AI，对它说：**
>
> **「按 README 在我 Mac 上装起来，用空数据目录，起 8766。」**
>
> 链接：<https://github.com/learnerfortech/xiaobu-step>

AI 会按下面的「快速开始（Mac）」在你的 Mac 上装。装好之后：

1. 手机、平板和这台 Mac 连**同一个可信家庭 Wi-Fi**，用浏览器打开入口（地址写在下方「快速开始（Mac）」里）。
2. 作业要你自己加，也可以再让 AI 帮你挂到**本机**的库里。
3. **别把真实照片、真实作业推回这个公开仓库。**
4. 不要在公共 Wi-Fi、学校／单位共享网络上运行，也不要把 8766 端口暴露到互联网。

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

3. 同一可信家庭 Wi-Fi 下用浏览器打开：

`http://<你的局域网IP>:8766/index.html?transport=lan`

孩子入口常见为 `#/jared`、`#/joey`，家长为 `#/parent`。

## 任务安排与完成

- 家长新建学校作业，或把周作业的明确总量拆成固定小份。每份可单独安排日期；暂未安排的份数仍保留在周概览里。
- 录入日、计划日期、老师真实截止日分别记录。没有老师截止日就留空；调整计划不会改变截止日。日期由家长修改，孩子可以记录部分进度或求助。
- 周作业跨天仍保留原份数和进度，不标为顺延。完成或提交检查后，当前清单保留勾选和划线，并区分“待家长确认”和“已完成”。整组完成后只在相关日期显示，原记录仍可查。
- 每份只获得一次经验。需要检查的纸笔作业在家长确认后发放；误点撤销会撤回该份经验，再完成时恢复原额。一旦发过经验，该份金额不再调整。
- 老师要求置顶，题目、讲解、范文、答案和音频按对应任务查看。外部网站的进度由孩子回来记录，当前没有自动同步。

旧任务读取时保留原 ID、照片和已有进度，不自动重新拆分或补造日期。以上说明源码中的规则；家中设备是否已使用这些改动，需核对设备正在运行的代码。

## 安全、隐私与授权

- 仓库默认忽略 sqlite、照片、作业材料包。请勿把真实家庭数据推到公开仓。
- 当前服务的局域网 Host／Origin 检查**不等于用户身份认证**。同一可信局域网内的设备应视为可信；不要暴露到公网或多家庭使用。
- MIT 许可证适用于本仓库中由项目维护者有权按该许可证发布的代码；第三方图像、音频、字体、可执行文件等不自动受 MIT 覆盖。
- 已知素材来源与待核实事项见 [ASSET_NOTICES.md](ASSET_NOTICES.md)。特别是伙伴形象和第三方拼音音频，在授权核实或替换前，不要假定可独立商用或再分发。

## 反馈与参与

- Bug：使用 [Bug report](.github/ISSUE_TEMPLATE/bug_report.yml)。
- 功能建议：使用 [Feature request](.github/ISSUE_TEMPLATE/feature_request.yml)。
- 贡献代码：先读 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 安全问题：先读 [SECURITY.md](SECURITY.md)，不要在公开 Issue 上传敏感资料。

## 项目状态

- [路线图](ROADMAP.md) — 方向与候选事项，不是交付承诺。
- [变更记录](CHANGELOG.md) — 区分仓库维护、应用功能与正式发布。
- 当前尚未发布带版本标签的正式应用 Release；语法检查通过也不代表真机完整验收。

## 许可证

代码采用 MIT License，见 [LICENSE](LICENSE)。第三方素材请以 [素材授权记录](ASSET_NOTICES.md) 中的逐项状态为准。
