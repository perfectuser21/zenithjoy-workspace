# 筛选分列阈值必须随截图宽度缩放

720宽云机筛选按钮之间只有12px空白，原max_gap=12会把四列合成一列，latest索引1失败。locate_filter_option与verify_filter_visual必须使用同一缩放规则，且保留最终选中态检查。先用真实失败截图证明旧码失败，再回放新码坐标和错选拒绝；合成4/5/6行覆盖旧实体布局。

测试环境Python必须有原依赖Pillow。系统python缺PIL的失败要保留，使用现有已装依赖解释器重跑，不能静默skip。

原27b2d8ce coding verify的I1-I3通过；I4因publish前要求未来PR失败。发布接续保留原报告，另登记a2020a65执行真实审查/PR/CI，不伪造原verify成功。

源码通过仅说明几何回归，通过正式Source部署和云机重跑后才能证明云101恢复。

发布前必须亲读中央已注册版本。main 6b 已声明的五共享下一版尚未注册，本次沿用该声明，避免重复升版；保持后续严格 nextVersion 检查。
