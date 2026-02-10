# ZenithJoy Works Management API

RESTful API for the Works Management System, providing CRUD operations for works, field definitions, and publish logs.

## Features

- **Works API**: Create, read, update, and delete content works
- **Fields API**: Manage custom field definitions (Notion-like)
- **Publish Logs API**: Track publishing history across platforms
- **TypeScript**: Full type safety
- **Validation**: Zod schema validation
- **Error Handling**: Unified error response format
- **PostgreSQL**: Connection pooling with `pg`

## Installation

```bash
cd apps/api
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | 5200 |
| `NODE_ENV` | Environment (development/production) | development |
| `DATABASE_HOST` | PostgreSQL host | localhost |
| `DATABASE_PORT` | PostgreSQL port | 5432 |
| `DATABASE_NAME` | Database name | cecelia |
| `DATABASE_USER` | Database user | postgres |
| `DATABASE_PASSWORD` | Database password | (required) |

## Usage

### Development

```bash
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

### Testing

```bash
npm test
npm run test:watch
```

## API Endpoints

### Works API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/works` | GET | List works (with filtering/pagination) |
| `/api/works/:id` | GET | Get single work |
| `/api/works` | POST | Create work |
| `/api/works/:id` | PUT | Update work |
| `/api/works/:id` | DELETE | Delete work |

#### Query Parameters (GET /api/works)

- `type`: Filter by content type (text/image/video/article/audio)
- `status`: Filter by status (draft/ready/published/archived)
- `account`: Filter by account (XXIP/XXAI)
- `limit`: Page size (default: 20)
- `offset`: Page offset (default: 0)
- `sort`: Sort field (default: created_at)
- `order`: Sort order (asc/desc, default: desc)

#### Example: Create Work

```bash
curl -X POST http://localhost:5200/api/works \
  -H "Content-Type: application/json" \
  -d '{
    "title": "AI时代的判断力",
    "content_type": "article",
    "body": "# 内容...",
    "custom_fields": {
      "tags": ["创作系统", "AI"],
      "priority": "high"
    }
  }'
```

### Field Definitions API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/fields` | GET | List all field definitions |
| `/api/fields` | POST | Create field definition |
| `/api/fields/:id` | PUT | Update field definition |
| `/api/fields/:id` | DELETE | Delete field definition |

#### Example: Create Field

```bash
curl -X POST http://localhost:5200/api/fields \
  -H "Content-Type: application/json" \
  -d '{
    "field_name": "心情",
    "field_type": "select",
    "options": ["开心", "平静", "焦虑"],
    "display_order": 5
  }'
```

### Publish Logs API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/works/:workId/publish-logs` | GET | Get publish logs for a work |
| `/api/works/:workId/publish-logs` | POST | Create publish log |
| `/api/publish-logs/:id` | PUT | Update publish log |

#### Example: Create Publish Log

```bash
curl -X POST http://localhost:5200/api/works/{workId}/publish-logs \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "douyin",
    "status": "pending",
    "scheduled_at": "2026-02-11T10:00:00Z"
  }'
```

## Error Handling

All errors return a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { ... }
  }
}
```

### Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Unique constraint violation |
| `INTERNAL_ERROR` | 500 | Server error |

## Database Schema

The API uses the following tables in the `zenithjoy` schema:

- `zenithjoy.works` - Content works
- `zenithjoy.field_definitions` - Custom field definitions
- `zenithjoy.publish_logs` - Publishing history

See `docs/database/migrations/002_create_works_tables.sql` for the complete schema.

## Project Structure

```
apps/api/
├── src/
│   ├── routes/          # Express routes
│   ├── controllers/     # Request handlers
│   ├── services/        # Business logic
│   ├── models/          # Types and schemas
│   ├── db/              # Database connection
│   ├── middleware/      # Error handling, validation
│   ├── app.ts           # Express app setup
│   └── index.ts         # Server entry point
├── tests/               # Integration tests
├── package.json
├── tsconfig.json
└── README.md
```

## Development

### Adding a New Endpoint

1. Define types in `src/models/types.ts`
2. Create Zod schema in `src/models/schemas.ts`
3. Implement service in `src/services/`
4. Create controller in `src/controllers/`
5. Add route in `src/routes/`
6. Write tests in `tests/`

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Watch mode
npm run test:watch
```

## Deployment

See `.prd-works-management.md` Phase 7 for deployment instructions.

## License

Proprietary - ZenithJoy
