# Learning: fix-deploy-hk-alias

## 问题
deploy-hk.sh 中 `HK_DEST="hk:..."` 硬编码了错误的 SSH 别名，导致 rsync 报 hostname 解析失败。

### 根本原因
`~/.ssh/config` 中定义的别名是 `hk-vps`，脚本里写的是 `hk`，两者不一致。在创建脚本时未核对 SSH config，直觉写了一个更短的别名。

### 下次预防
- [ ] 部署脚本涉及 SSH 别名时，先运行 `ssh <alias> echo ok` 验证连通性再写入脚本
- [ ] 统一约定：所有部署脚本使用完整别名（`hk-vps`），不使用缩写

## 修复
单行改动：`HK_DEST="hk:..."` → `HK_DEST="hk-vps:..."`
