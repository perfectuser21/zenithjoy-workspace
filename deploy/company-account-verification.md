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

采证和独立复核都是正常Brain `research`任务，任务范围包括公司接入写回。先实际完成各自检查并写PASS proof，保持真实in_progress和live claimed_by；API消费并GET确认verified写回后双方才正常completed。现役Brain正常completed会清认领，不能伪complete、回填claimed_by或只信result.actor。首次消费task.claimed_by必须在对应server允许列表，result.actor须相等且双方独立。

任务须queued创建→正常claim→PATCH in_progress，之后执行检查并写proof，不能反顺序认领。双方payload固定source=`company_account_verification`、source_repo=`perfectuser21/zenithjoy-workspace`、source_revision=批准最终main。payload/result的account_verification protocol=`company-account-verification-v1`，kind分别capture/validation，binding均精确包括company_id、tenant_id、account_id、platform、douyin_id、profile、device_serial、device_instance_id、device_host、registration_request_id、ownership_decision_id、registration_fingerprint，来自真实declared记录。仅payload.account_verification另须completion_scope=`company_verification_writeback`；proof本身不要求重复scope字段。

双方result.account_verification须PASS、checked_at、actual_identity（platform/douyin_id/profile/device_serial/device_instance_id/device_host）、相同evidence_refs[{uri,sha256}]，result.evidence包含这些uri。原件由独立核验者实际读取验SHA；本API不根据任意路径字符串读取文件或URL。

同一次采证/独立复核共用一个新的verification_attempt_uuid；重采需新attempt与新任务，不改登记request。capture的source_id=`company-account-verification:capture:<account_id>:<verification_attempt_uuid>`，proof.lock={owner:capture_task_id,acquired:true,released:true}。

validation的source_id同上kind替为validation且相同verification_attempt_uuid；parent_task_id及payload/proof.capture_task_id均指capture；proof.capture_proof_sha256为递归键排序、紧凑UTF-8 JSON的capture.result.account_verification SHA256；assertions的native_id_exact、own_page、device_binding、registration_binding、evidence_sha256、lock_cleanup均须真实核实后为true。

首次消费任务须in_progress且completed_at为空。真实时序为registered_at≤created_at≤claimed_at≤started_at≤proof.checked_at≤updated_at≤当前+30秒；proof.checked_at须15分钟内，validation.checked_at不早于capture.checked_at。禁止使用旧日缓存冒本轮fresh。PG锁等待有5秒上限，取得锁后才从固定Brain读取live witness，网络8秒上限，不拿锁前旧状态冒当前认领。

全局登记锁下核对当前JSON及不可变company_config_changes历史：同采证或验证task不能被另一账号重复消费；成功同两任务响应丢失可精确幂等读回，不生成第二版本。verification_source冻结capture_actor/validation_actor及各自claim_witness(task_id/actor/claimed_at/started_at/observed_at)，capture_task_sha256/validation_task_sha256摘要对象为{id,task_type,source_id,parent_task_id(缺省null),payload,actor:result.actor,facts:result.facts,evidence:result.evidence,proof:result.account_verification}。正常completed/nullclaim及新增handoff不改变此稳定内容，因此已有可信witness可幂等；不能从新自报actor补witness。首次completed/nullclaim拒绝，任务收尾不得改facts/evidence/proof/payload/actor。保存版本快照和旧/新/actor审计。

## 验收口径

本地HTTP测试用mock PG；真实PG并发、实际Brain凭据/角色、正式两任务及生产GET读回另存原件后才能称接入完成。不要把注册disabled/unverified、普通录音成功或发布包就绪当作正式核验完成。
