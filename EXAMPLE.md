# Complete DO-ORM Example

This is a complete example showing how to use DO-ORM in a Cloudflare Worker with Durable Objects.

## Project Structure

```
your-project/
├── src/
│   ├── models/
│   │   └── event.ts          # Your ORM models
│   └── index.ts               # Worker entry point
├── wrangler.toml              # Cloudflare configuration
├── package.json
└── tsconfig.json
```

## Step 1: Install DO-ORM

```bash
npm install @hammr/do-orm
npm install -D @cloudflare/workers-types wrangler typescript
```

## Step 2: Define Your Model

`src/models/event.ts`:

```typescript
import { DOModel, SchemaDefinition } from '@hammr/do-orm';

interface EventSchema extends SchemaDefinition {
  id: 'string';
  workspaceId: 'string';
  userId: 'string';
  timestamp: 'date';
  type: 'string';
  metadata: 'object';
}

export class Event extends DOModel<EventSchema> {
  protected schema: EventSchema = {
    id: 'string',
    workspaceId: 'string',
    userId: 'string',
    timestamp: 'date',
    type: 'string',
    metadata: 'object',
  };
  
  // Index frequently queried fields
  protected indexes = ['workspaceId', 'userId', 'timestamp'] as const;
}
```

## Step 3: Create Your Durable Object

`src/index.ts`:

```typescript
import { Event } from './models/event';

export class Analytics {
  private state: DurableObjectState;
  private events: Event;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.events = new Event(state.storage);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Track an event
    if (path === '/track' && request.method === 'POST') {
      const data = await request.json() as any;
      
      const event = await this.events.create({
        id: crypto.randomUUID(),
        workspaceId: data.workspaceId,
        userId: data.userId,
        timestamp: new Date(),
        type: data.type,
        metadata: data.metadata || {}
      });

      return Response.json({ success: true, event });
    }

    // Get user events
    if (path === '/events' && request.method === 'GET') {
      const userId = url.searchParams.get('userId');
      const limit = parseInt(url.searchParams.get('limit') || '100');
      
      const events = await this.events
        .where({ userId: userId! })
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .execute();

      return Response.json({ events });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}

// Worker interface
interface Env {
  ANALYTICS: DurableObjectNamespace;
}

// Main worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Route to appropriate Durable Object
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspaceId') || 'default';
    
    const id = env.ANALYTICS.idFromName(workspaceId);
    const stub = env.ANALYTICS.get(id);
    
    return stub.fetch(request);
  }
};
```

## Step 4: Configure Wrangler

`wrangler.toml`:

```toml
name = "my-analytics"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "ANALYTICS"
class_name = "Analytics"
script_name = "my-analytics"

[[migrations]]
tag = "v1"
new_classes = ["Analytics"]
```

## Step 5: Deploy

```bash
# Local development
wrangler dev

# Deploy to production
wrangler deploy
```

## Usage Examples

### Track an event

```bash
curl -X POST https://my-analytics.workers.dev/track \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws_123",
    "userId": "user_456",
    "type": "page_view",
    "metadata": {
      "page": "/pricing",
      "referrer": "google"
    }
  }'
```

### Query user events

```bash
curl "https://my-analytics.workers.dev/events?userId=user_456&limit=50"
```

## Advanced Patterns

### Multiple Models in One DO

```typescript
import { Event } from './models/event';
import { User } from './models/user';
import { Session } from './models/session';

export class Workspace {
  private events: Event;
  private users: User;
  private sessions: Session;

  constructor(state: DurableObjectState, env: Env) {
    this.events = new Event(state.storage, 'events');
    this.users = new User(state.storage, 'users');
    this.sessions = new Session(state.storage, 'sessions');
  }

  async fetch(request: Request): Promise<Response> {
    // Handle different endpoints for each model
    // ...
  }
}
```

### Pagination

```typescript
async function getEventsPaginated(
  workspaceId: string,
  page: number,
  pageSize: number
) {
  const events = await this.events
    .where({ workspaceId })
    .orderBy('timestamp', 'desc')
    .limit(pageSize)
    .execute();

  // For proper pagination, you'd want to use cursor-based pagination
  // Store the last timestamp and use .before() for the next page
  return events;
}
```

### Time-based Queries

```typescript
async function getRecentEvents(workspaceId: string, minutes: number) {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  
  return await this.events
    .where({ workspaceId })
    .after(since)
    .orderBy('timestamp', 'desc')
    .execute();
}
```

### Aggregations

```typescript
async function getUserStats(workspaceId: string) {
  const events = await this.events
    .where({ workspaceId })
    .execute();

  // Count by user
  const userCounts = events.reduce((acc, event) => {
    acc[event.userId] = (acc[event.userId] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    totalEvents: events.length,
    uniqueUsers: Object.keys(userCounts).length,
    topUsers: Object.entries(userCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
  };
}
```

## Best Practices

### 1. Index Your Query Fields

Always index fields you frequently query by:

```typescript
protected indexes = ['workspaceId', 'userId', 'timestamp'] as const;
```

### 2. Use Appropriate Data Types

Choose the right type for your data:

```typescript
interface Schema extends SchemaDefinition {
  id: 'string';           // Unique identifiers
  count: 'number';        // Numeric values
  active: 'boolean';      // Flags
  createdAt: 'date';      // Timestamps
  metadata: 'object';     // Flexible JSON data
  tags: 'array';          // Lists
}
```

### 3. Limit Query Results

Always use `.limit()` to prevent memory issues:

```typescript
const events = await this.events
  .where({ workspaceId })
  .limit(1000)  // Don't load everything!
  .execute();
```

### 4. Shard Appropriately

Choose your DO sharding strategy based on your access patterns:

```typescript
// By workspace (good for multi-tenant)
const id = env.ANALYTICS.idFromName(workspaceId);

// By user (good for user-specific data)
const id = env.ANALYTICS.idFromName(userId);

// By time period (good for time-series data)
const period = `${year}-${month}`;
const id = env.ANALYTICS.idFromName(period);
```

### 5. Handle Errors

Always wrap ORM operations in try-catch:

```typescript
try {
  const event = await this.events.create(data);
  return Response.json({ success: true, event });
} catch (error) {
  if (error.message.includes('already exists')) {
    return Response.json({ error: 'Duplicate event' }, { status: 409 });
  }
  if (error.message.includes('must be a string')) {
    return Response.json({ error: 'Invalid data' }, { status: 400 });
  }
  throw error; // Re-throw unexpected errors
}
```

## Performance Tips

1. **Use indexes** - Queries on indexed fields are O(log n) vs O(n)
2. **Batch reads** - If you need multiple records, query once instead of multiple `find()` calls
3. **Limit results** - Always paginate large result sets
4. **Cache in memory** - Store frequently accessed data in the DO instance
5. **Monitor size** - Keep DOs under 128MB for best performance

## Limitations to Be Aware Of

- No compound indexes (yet)
- No transactions across multiple operations
- No joins between models
- Each DO limited to 128MB storage
- Queries load all matching records into memory

## Production Checklist

- [ ] Indexes defined for all query fields
- [ ] Query limits applied everywhere
- [ ] Error handling implemented
- [ ] DO sharding strategy chosen
- [ ] Monitoring and logging set up
- [ ] Backup strategy for critical data
- [ ] Rate limiting implemented
- [ ] Schema migrations planned
