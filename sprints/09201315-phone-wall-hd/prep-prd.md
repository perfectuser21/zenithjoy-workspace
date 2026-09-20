# 小改动 PrepPRD：实时画面高清化 + iPhone Pro 外观 + 遮掉安卓状态栏

Brain task `c48d926c-d685-4aef-8b61-228fe1f54f01` · 路径 B · GP-Anchor: `line02/keyword_acquisition keep-green`

## 改什么

1. `services/phone-adb-controller/wall-lib.sh`：`wall_convert` 的 `sips -Z`（最长边）改为 `--resampleWidth`（按宽），`WALL_WIDTH` 默认 360→720，质量阶梯 55/35 → 50/42/36（实测 1200×2664 抓屏：720 宽 q50 约 88KB、q36 约 64KB，都在 120KB 上限内）。
2. `apps/dashboard/src/components/PhoneFrame.tsx`：iPhone Pro 观感——钛色渐变金属边 + 内黑边、更薄边框、屏幕圆角按 393pt 机型比例（约 0.14×宽）、灵动岛 32% 宽、侧键钛色；屏幕区顶部叠 iOS 风格状态栏（时间 + 信号/WiFi/电量，`data-testid=phone-statusbar`），盖住安卓状态栏（那行带 USB 调试图标的）。
3. smoke 加两条守卫（`--resampleWidth`、默认 720）。

## 为什么改

主理人 0920：画面模糊（根因：`sips -Z 360` 是最长边，实际帧 162×360，被 2 倍屏放大 4 倍多）、机型不好看、不想看到安卓状态栏。

## 影响范围

推帧器每帧从约 18KB 增到约 80KB，四台约 320KB/s（2.5 Mbps）上行，可接受；服务端 120KB 限制不动；不改 API。

## 验收标准

- [ ] wall-lib 单测：质量阶梯 50/42/36、宽度 720（先红后绿）
- [ ] PhoneFrame 单测：状态栏在屏幕区内、含时间与图标（先红后绿）
- [ ] smoke 两条守卫先红后绿
- [ ] 合并部署后 M4/M1 帧尺寸 720×1598、体积 <120KB；staging 截图外观与清晰度确认
