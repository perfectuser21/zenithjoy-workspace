# Wan 3.0 局部视频复刻工作流

GP-Anchor: line07/viral_video_remake keep-green

用户要求：将 Wan 3.0 镶进现有工作流直接使用，而非每次一次性脚本。以原视频为编辑对象；可分别或组合更换同品类产品、仅颜色、仅 Logo、背景和模特脸，未选部分保留。原片未露脸时跳过换脸；没有有效操作时拒绝提交。

1. 员工进入现有“视频创作画布”，打开视频复刻模板。
2. 在节点上传原视频及所需产品、Logo、背景或模特图片，看到上传结果。
3. 选择产品操作、背景及换脸，填写颜色、场景及露脸状态；确认后运行。
4. 后台只读取当前员工的素材，按角色为图片编号、提交 wan3.0-video，保持原片比例与时长。重复提交不重复计费；修改配置使用新版本标识。
5. 员工在画布预览视频、保存结果；任务可在 Wan 历史恢复。上传/配置/供应商失败必须可见，不以原片替代成功结果。

判定：露脸状态由用户明确选择，未实现人脸检测。模型生成后的颜色、Logo、面部及未选部分稳定性需要人工验收；工作流不把“API成功”冒充“视觉保真通过”。默认输出720P无音轨。单段原片1–15秒；官方建议编辑duration=-1、ratio=adaptive；关闭提示词扩写，避免编辑意图被改写。

测试策略：先HTTP全流程与画布页面失败测试，再实现；API测试只模拟外部鉴权/模型/存储边界，真实文件持久化、配置编译、幂等和所有权判断；浏览器上传扩展执行真实widget行为；完整Comfy运行时与付费Wan另验，不由CI产生费用。

范围：已有creative-canvas、video-tools与阿里Wan适配器。未新增平行服务，未改旧九节点翻拍页。Brain项目归位及有头建单均返回 routing_evidence_unavailable；代码留在独立cp分支，未创建虚假task或修改投影。

依据：https://help.aliyun.com/zh/model-studio/wan3-video-generation-guide 视频编辑章节；https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-prompt-guide 的reference material citation与video editing章节。
