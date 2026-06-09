## line04 preflight 自动修复（2026-06-09）

### 根本原因

1. preflight 只检查微信是否"安装"，不检查是否"运行"，导致日志里说"未找到微信"但实际微信已登录
2. getModulePython() 没有回退到 ZENITHJOY_CORE_DIR，导致空机子的 line04 模块找不到 python-embedded
3. preflight 发现依赖缺失只报错，不尝试自动修复，空白机器无法自助完成安装

### 下次预防

- [ ] 新增进程级检测时，同步加"是否运行"检测，不只检查"是否安装"
- [ ] python 路径函数改动时，检查所有引用该逻辑的函数是否都同步（preflight.ts 和 wechat-rpa.ts 存在重复逻辑）
- [ ] 凡是"依赖检测"类 preflight，都要思考：检测失败后能否自动修复？是否加 autoRepair 阶段？
- [ ] 版本 bump 三联动（manifest + service + 测试）由 module-version-sync 回归测试保护，不要手动记
