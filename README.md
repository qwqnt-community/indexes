# qwqnt-community-indexes

一个基于 **Node.js + GitHub Actions** 的自动化工具，用于**定时获取 GitHub 组织及第三方仓库的最新信息**，并将更新内容**转发到
Telegram 群**，同时利用仓库的 `data` 分支进行**持久化状态存储**。

## 项目目标

- 每天 **0 点** 自动检查指定 GitHub 仓库是否有更新
- 仅追踪 **带有 `qwqnt-framework-plugin` topic 的仓库**
- 当仓库主分支有新 commit：
    - 删除 Telegram 群中上一条对应仓库的消息
    - 发送新的更新消息
    - 更新并持久化仓库状态数据
- 支持通过 **GitHub Actions workflow\_dispatch**：
    - 手动添加第三方仓库进行追踪
    - 手动删除不再需要追踪的仓库
