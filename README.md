# OpenClaw WSL 运维（精简版）

本目录已切换为 **仅 WSL 方案**，不再维护 Windows 原生 `OpenClawGateway` 脚本链路。

## 当前目标

- 运行面：`WSL(Ubuntu) + systemd + openclaw-gateway`
- 保活面：`Windows NSSM -> OpenClawWSLHost`
- 访问面：浏览器访问 `http://localhost:18789/`（或你实际改过的端口）

## 日常命令

### 1) Windows 侧检查 WSL 宿主服务

```powershell
Get-Service OpenClawWSLHost | Format-List Name,Status,StartType
```

### 2) 进入 WSL 检查 gateway

```powershell
wsl -d Ubuntu -- systemctl --user status openclaw-gateway --no-pager
```

### 3) 检查监听端口（Windows）

```powershell
netstat -ano | findstr :18789
```

## 变更说明

- 已停止 Windows 原生 OpenClaw 运维脚本的后续维护。
- 后续文档和脚本默认只围绕 WSL 方案迭代。
