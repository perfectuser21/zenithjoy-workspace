# JNSY-Label (金诺数据标注平台)

AI Trainer + Label Studio 数据标注平台

## 架构

```
美国 VPS (开发)                    香港 VPS (生产)
/home/xx/dev/JNSY-Label/    →      /opt/ai-trainer/
        │                                  │
        │ git push                         │ docker compose
        ▼                                  ▼
GitHub: perfectuser21/JNSY-Label    ai-trainer:8000 + label-studio:8085
```

## 开发流程

1. **本地开发** (美国 VPS)
   ```bash
   cd /home/xx/dev/JNSY-Label
   # 修改代码
   git add . && git commit -m "feat: xxx"
   git push origin main
   ```

2. **部署到香港**
   ```bash
   ./scripts/deploy-hk.sh
   ```

## 服务端口

| 服务 | 端口 | 用途 |
|------|------|------|
| ai-trainer | 8000 | 训练平台 API |
| label-studio | 8085 | 数据标注工具 |

---

## 本地开发

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# 编辑 .env 设置 APP_SECRET_KEY 和 ADMIN_KEY

uvicorn app.main:app --reload --port 8000
```

- Swagger UI: http://127.0.0.1:8000/docs

## Docker 部署

```bash
docker compose up -d
```

---

## 功能 (P0)

✅ Invite-based activation (name+phone+code)
✅ Login (phone+password) with JWT
✅ Admin: create users, generate invite codes, create text-classification question
✅ Student: list questions, get question, submit answer
✅ Every submission is recorded with `attempt_no` (repeatable practice)

## Admin API

Header: `X-ADMIN-KEY: <ADMIN_KEY from .env>`

### 创建用户
`POST /admin/users`
```json
{ "name": "张三", "phone": "13800000000" }
```

### 生成邀请码
`POST /admin/users/invite`
```json
{ "phone": "13800000000" }
```

### 创建文本分类题目
`POST /admin/questions/text`
```json
{
  "stem": "以下文本表达的情绪是？",
  "text": "这次服务真的很糟糕。",
  "labels": ["正向", "中性", "负向"],
  "correct_label": "负向",
  "explanation": "出现强烈否定词。"
}
```

### 批量导入题目
`POST /admin/questions/text/import`
- 支持 `.csv` (UTF-8/GBK) 和 `.xlsx`
- 必需列: `stem`, `text`, `labels`, `correct_label`
- `labels` 分隔符: `|` (也支持 `,` `；`)

## Student API

### 激活账号
`POST /auth/activate`
```json
{
  "name": "张三",
  "phone": "13800000000",
  "code": "ABCDE12345",
  "password": "yourPassword"
}
```

### 登录
`POST /auth/login`
```json
{ "phone": "13800000000", "password": "yourPassword" }
```

### 获取题目列表
`GET /questions?type=text_classification`

### 提交答案
`POST /questions/{id}/submit`
Header: `Authorization: Bearer <token>`
```json
{ "selected_label": "负向" }
```
