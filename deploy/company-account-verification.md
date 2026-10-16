# 正式账号核验桥部署合同

入口 `POST /api/company-profile/platform-account-verifications` 只收已登记account_id、expected_version、capture_task_id、validation_task_id。使用真实owner登录会话。账号核验只unverified→verified，账号disabled、公司draft/政策不随之启用。

## 环境配置与正常发布

`docker-compose.staging-api.yml` 和 `docker-compose.prod-api.yml` 已分别用 `env_file` 全量传入 `/opt/zenithjoy/staging-api/.env`、`/opt/zenithjoy/prod-api/.env`。沿用该真实部署入口，勿在compose或Git中放secret；环境文件权限600。更改后须由正常部署重建相应容器加载，不能只改文件宣称已生效。

必须配置：

| 变量 | 来源 |
|---|---|
| CECELIA_BRAIN_URL | 部署管理员批准的固定Brain origin；现役宿主代理为host.docker.internal:5221 |
| CECELIA_INTERNAL_TOKEN | 1Password「Cecelia Internal Token」，不复用ZenithJoy token |
| COMPANY_ACCOUNT_VERIFICATION_SOURCE_REVISION | 已真实合并、发布并批准的完整40位main SHA |
| COMPANY_ACCOUNT_VERIFICATION_COLLECTORS | 真正采证任务claimed_by精确允许列表 |
| COMPANY_ACCOUNT_VERIFICATION_VALIDATORS | 独立核验任务claimed_by精确允许列表 |

缺配置503，Brain失败/重定向/超时/过大响应也拒绝；未配置不影响其他业务端点。服务端发送凭据只到固定Brain origin，不读取请求指定URL。

按 main→`deploy-staging-hk.yml`→staging验收→`promote-prod-hk.yml`人工闸（指定精确已验SHA）发布。先检查`GET /api/health`的build.sha与最终main一致，再用正式登录读回公司身份/版本。代码merge不代表生产API、环境配置或真实核验已完成。

## 双任务证据合同

采证和独立复核都是正常Brain `research`任务，必须真实completed，result包含事实、原件和actor；不能以测试fixture或未运行任务补PASS。task.claimed_by必须在对应server允许列表，result.actor须相等且双方独立。

双方payload固定source=`company_account_verification`、source_repo=`perfectuser21/zenithjoy-workspace`、source_revision=批准最终main。payload/result的account_verification protocol=`company-account-verification-v1`，kind分别capture/validation，binding均精确包括company_id、tenant_id、account_id、platform、douyin_id、profile、device_serial、device_instance_id、device_host、registration_request_id、ownership_decision_id、registration_fingerprint，来自真实declared记录。

双方result.account_verification须PASS、checked_at、actual_identity（platform/douyin_id/profile/device_serial/device_instance_id/device_host）、相同evidence_refs[{uri,sha256}]，result.evidence包含这些uri。原件由独立核验者实际读取验SHA；本API不根据任意路径字符串读取文件或URL。

同一次采证/独立复核共用一个新的verification_attempt_uuid；重采需新attempt与新任务，不改登记request。capture的source_id=`company-account-verification:capture:<account_id>:<verification_attempt_uuid>`，proof.lock={owner:capture_task_id,acquired:true,released:true}。

validation的source_id同上kind替为validation且相同verification_attempt_uuid；parent_task_id及payload/proof.capture_task_id均指capture；proof.capture_proof_sha256为递归键排序、紧凑UTF-8 JSON的capture.result.account_verification SHA256；assertions的native_id_exact、own_page、device_binding、registration_binding、evidence_sha256、lock_cleanup均须真实核实后为true。

任务创建不早于真实登记，created_at≤checked_at≤completed_at，checked/completed须15分钟内，validation.checked_at不早于capture.completed_at。禁止使用旧日缓存冒本轮fresh。

全局登记锁下核对当前JSON及不可变company_config_changes历史：同采证或验证task不能被另一账号重复消费；成功同两任务响应丢失可精确幂等读回，不生成第二版本。保存版本快照和旧/新/actor审计。

## 验收口径

本地HTTP测试用mock PG；真实PG并发、实际Brain凭据/角色、正式两任务及生产GET读回另存原件后才能称接入完成。不要把注册disabled/unverified、普通录音成功或发布包就绪当作正式核验完成。
