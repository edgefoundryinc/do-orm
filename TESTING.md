# Testing DO-ORM with Cloudflare Workers

This guide shows how to test the DO-ORM in a real Cloudflare Workers environment.

## Setup

1. **Install dependencies** (including wrangler):
```bash
npm install
```

2. **Start the development server**:
```bash
npm run dev
```

This will start the worker at `http://localhost:8787`

3. **In a separate terminal, run the tests**:
```bash
npm run test:worker
```

## Manual Testing with curl

### Health Check
```bash
curl http://localhost:8787/health
```

### Create an Event
```bash
curl -X POST http://localhost:8787/events \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws_abc",
    "userId": "user_123",
    "type": "click",
    "timestamp": "2024-01-15T10:00:00Z",
    "data": {"button": "submit", "page": "/home"}
  }'
```

### Query Events by Workspace
```bash
curl "http://localhost:8787/events?workspaceId=ws_abc&limit=10"
```

### Query Events by User
```bash
curl "http://localhost:8787/events?userId=user_123"
```

### Query with Date Range
```bash
curl "http://localhost:8787/events?workspaceId=ws_abc&after=2024-01-01T00:00:00Z&limit=100"
```

### Get Event by ID
```bash
curl http://localhost:8787/events/evt_123
```

### Update an Event
```bash
curl -X PUT http://localhost:8787/events/evt_123 \
  -H "Content-Type: application/json" \
  -d '{
    "data": {"button": "cancel", "page": "/home"}
  }'
```

### Delete an Event
```bash
curl -X DELETE http://localhost:8787/events/evt_123
```

### Get Statistics
```bash
curl http://localhost:8787/stats
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/events` | Create a new event |
| GET | `/events/:id` | Get event by ID |
| GET | `/events?workspaceId=...` | Query events (supports filters) |
| PUT | `/events/:id` | Update an event |
| DELETE | `/events/:id` | Delete an event |
| GET | `/stats` | Get statistics |

## Query Parameters

When querying events (`GET /events`):
- `workspaceId` - Filter by workspace (indexed, fast)
- `userId` - Filter by user (indexed, fast)
- `after` - Events after this date (ISO string)
- `before` - Events before this date (ISO string)
- `limit` - Max results to return
- `orderBy` - Field to sort by (default: timestamp)
- `order` - Sort direction: asc or desc (default: desc)

## Features Demonstrated

✅ **Schema validation** - Try sending invalid data types
✅ **Indexed queries** - Fast lookups by workspaceId and userId
✅ **Date range filtering** - Query events within date ranges
✅ **Sorting and limiting** - Control result ordering and size
✅ **CRUD operations** - Full create, read, update, delete support
✅ **Statistics** - Aggregate data across all events

## Deployment

Deploy to Cloudflare:
```bash
npm run deploy
```

After deployment, your worker will be available at:
```
https://do-orm.YOUR_SUBDOMAIN.workers.dev
```

## Architecture

```
Worker Request
    ↓
Main Handler (worker/index.ts)
    ↓
Durable Object (EventStore)
    ↓
DO-ORM Model (Event class)
    ↓
DO Storage (with indexes)
```

Each workspace gets its own Durable Object instance, providing:
- **Isolation** - Data is partitioned by workspace
- **Performance** - Objects are close to the data they manage
- **Scalability** - Objects scale automatically with traffic

## Troubleshooting

### Worker not starting?
Check the wrangler output for errors. Common issues:
- Port 8787 already in use
- TypeScript compilation errors

### Tests failing?
1. Make sure the worker is running (`npm run dev`)
2. Check the worker logs for errors
3. Verify the worker is accessible at `http://localhost:8787/health`

### Schema validation errors?
The ORM enforces strict type checking:
- All fields must be present
- Types must match the schema
- Dates must be valid Date objects or ISO strings
