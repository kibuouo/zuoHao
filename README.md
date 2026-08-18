# 好坐 ZuoHao

用电脑摄像头做本地坐姿监测的 Electron 桌面应用。界面按 WinPlate 的胶囊条 + 侧栏工作区来组织：日常看右上角悬浮胶囊，双击打开主窗口做校准和设置。主要盯脖子前倾、含胸驼背，并在连续落座过久时提醒起身。

画面只在本机用 MediaPipe Pose 推理，不会上传。

## 运行

需要 Node.js 18+，以及系统允许此应用使用摄像头。

```bash
cd zuoHao
npm install
npm start
```

首次启动会下载姿态模型（约几 MB）。之后可离线监测，但仍建议保留网络以便字体加载。

## 用法

1. **侧拍测前倾**：把摄像头放在身体一侧，高度约与肩膀平齐，画面里要有耳朵、脖子和近侧肩膀。
2. 侧对屏幕坐好，先坐正，再点 **校准标准坐姿**。侧看时耳朵应大致在肩膀正上方。
3. 偏离校准姿势并持续约 2.5 秒后会提醒。设置里可改灵敏度和拍摄方向。
4. 连续落座到达设定时长（默认 45 分钟）会弹出起身卡片。离开画面超过 2 分钟会把落座计时清零。
5. 关闭窗口默认收到托盘，监测继续。托盘图标右键可退出。

快捷键：`空格` 开启/暂停，`C` 校准，`Esc` 关闭设置。

## 检测说明

| 项目 | 依据 |
| --- | --- |
| 脖子前倾（侧拍） | 33 点骨架 + 派生颈点（C7 / 中颈 / 下颌）。颅椎角、耳–肩前移、下颌前伸、3D 位移任一超线即提醒 |
| 含胸驼背（侧拍） | 肩相对骨盆的躯干前倾角 |
| 头侧倾 / 高低肩 / 侧倾 | 正面用左右点；侧拍改用深度和 3D 点看额状面。远侧点看不见时标「信号弱」，不直接关掉 |

这是行为提醒，不是医疗诊断。

## MCP 接口

好坐在本机 `127.0.0.1:18765` 开一个回环 HTTP API（无画面、需 token）。MCP 服务器用 stdio 把它暴露给 Grok，方便对照快照、改阈值、写调试笔记。

```bash
npm start          # 启动应用（同时打开 API）
# 另开终端或由 Grok 自动拉起：
node mcp/server.js
```

Grok 配置（仓库 `.grok/config.toml` 或 `~/.grok/config.toml`）：

```toml
[mcp_servers.zuohao]
command = "node"
args = ["C:/Users/kiko/Documents/Grok/zuoHao/mcp/server.js"]
enabled = true
```

常用工具：`zuohao_get_snapshot`、`zuohao_get_frame`、`zuohao_get_samples`、`zuohao_get_algorithm`、`zuohao_update_algorithm`、`zuohao_add_note`。Token 在 `%APPDATA%/zuohao/mcp-token.txt`。画面会写到项目 `.debug/frame.jpg`。
