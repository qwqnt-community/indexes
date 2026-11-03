# qwqnt-community-indexes

一个基于 **Node.js + GitHub Actions** 的自动化工具，用于**定时获取 GitHub 组织及第三方仓库的最新信息**，并将更新内容**转发到
Telegram 群**，同时利用仓库的 `data` 分支进行**持久化状态存储**。

## 项目目标

- 每天 **0 点** 自动检查指定 GitHub 仓库的最新 Release
- 仅追踪 **带有 `qwqnt-framework-plugin` topic 的仓库**
- 当最新 Release 的版本 tag 变化：
    - 删除 Telegram 群中上一条对应仓库的消息
    - 发送包含 Release 说明与附件文件块的同一条 Telegram 富文本消息（需要支持文件块的 Bot API）
    - Release 说明默认折叠，附件显示在折叠块之后；无说明时仍显示附件
    - 富文本发送失败时，回退为 MarkdownV2 正文与独立附件消息；更新时同时清理历史独立附件
    - 更新并持久化仓库状态数据
- 相同版本 tag 的 Release 正文修改不会触发重新发送
- 尚未发布 Release 的仓库会保持追踪，但不会发送消息
- 支持通过 **GitHub Actions workflow\_dispatch**：
    - 手动添加第三方仓库进行追踪
    - 手动删除不再需要追踪的仓库

## 验证富文本附件

安装锁定依赖后，运行离线行为测试（不会连接 Telegram 或 GitHub）：

```bash
npm ci --ignore-scripts
node --test test/telegram-rich-message.test.js
```

实际发送验证需提前设置 `TG_BOT_TOKEN` 和 `TG_GROUP_ID`，有话题时另设
`TG_GROUP_TOPIC_ID`，然后运行：

测试入口使用 Node 原生 `fetch`；需要代理时，可在支持环境代理的 Node 版本
（如 Node 24）中设置 `NODE_USE_ENV_PROXY=1` 和 `HTTPS_PROXY`。正式发送仍使用
项目原有的 grammY 网络配置。

```bash
node scripts/test-telegram-rich-message.js
```

该脚本会向配置的会话**真实发送**一条含 TXT、JSON 测试附件的富文本消息，
核对文件块回执，再下载附件比对内容。附件由内存生成，不访问 GitHub，
不修改仓库追踪状态；测试消息保留供查看。不要将机器人令牌写入脚本。
