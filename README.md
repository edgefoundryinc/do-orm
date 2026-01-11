# DO-ORM

**Type-safe ORM for Cloudflare Durable Objects with zero runtime overhead**

DO-ORM makes Durable Objects queryable like a real database while maintaining the performance and simplicity of Cloudflare's storage API. Built with pure TypeScript, zero dependencies, and automatic schema validation.

## Features

**Type-safe schema definitions** - Full TypeScript inference for all CRUD operations  
**Automatic validation** - Schema validation on every write operation  
**Efficient indexing** - Single-field indexes for O(log n) queries instead of O(n) scans  
**Fluent query builder** - Chain `.where()`, `.after()`, `.before()`, `.limit()`, `.orderBy()`  
**Full CRUD support** - `create()`, `find()`, `update()`, `delete()`, and bulk operations  
**Zero dependencies** - Pure TypeScript using DO storage primitives  
**Zero runtime overhead** - Direct wrapper around Durable Objects storage API  

## Installation

```bash
npm install @hammr/do-orm
```

## Quick Start

### 1. Define your model

```typescript
import { DOModel, SchemaDefinition, InferSchemaType } from '@hammr/do-orm';

// Define schema with type annotations
interface EventSchema extends SchemaDefinition {
  id: 'string';
  workspaceId: 'string';
  timestamp: 'date';
  type: 'string';
  data: 'object';
}

// Create model class
class Event extends DOModel<EventSchema> {
  protected schema: EventSchema = {
    id: 'string',
    workspaceId: 'string',
    timestamp: 'date',
    type: 'string',
    data: 'object',
  };
  
  // Define indexes for efficient queries
  protected indexes = ['workspaceId', 'timestamp'] as const;
}
```

### 2. Use in your Durable Object

```typescript
export class MyDurableObject {
  private eventModel: Event;

  constructor(state: DurableObjectState) {
    this.eventModel = new Event(state.storage);
  }

  async fetch(request: Request): Promise<Response> {
    // Create an event
    const event = await this.eventModel.create({
      id: 'evt_123',
      workspaceId: 'ws_abc',
      timestamp: new Date(),
      type: 'click',
      data: { button: 'submit' }
    });

    // Query events
    const recentEvents = await this.eventModel
      .where({ workspaceId: 'ws_abc' })
      .after(new Date('2024-01-01'))
      .limit(100)
      .orderBy('timestamp', 'desc')
      .execute();

    return new Response(JSON.stringify(recentEvents));
  }
}
```

## API Reference

### Schema Types

DO-ORM supports the following field types:

- `'string'` - String values
- `'number'` - Numeric values (integers and floats)
- `'boolean'` - Boolean values (true/false)
- `'date'` - Date objects (automatically serialized/deserialized)
- `'object'` - Plain JavaScript objects
- `'array'` - Arrays of any type

### CRUD Operations

#### `create(data: T): Promise<T>`

Create a new record. Throws if validation fails or ID already exists.

```typescript
const event = await eventModel.create({
  id: 'evt_1',
  workspaceId: 'ws_abc',
  timestamp: new Date(),
  type: 'pageview',
  data: { page: '/home' }
});
```

#### `find(id: string): Promise<T | null>`

Find a record by ID. Returns `null` if not found.

```typescript
const event = await eventModel.find('evt_1');
if (event) {
  console.log(event.type); // Type-safe access
}
```

#### `update(id: string, updates: Partial<T>): Promise<T>`

Update a record with partial data. Validates the complete merged record.

```typescript
const updated = await eventModel.update('evt_1', {
  data: { page: '/about' }
});
```

#### `delete(id: string): Promise<boolean>`

Delete a record by ID. Returns `true` if deleted, `false` if not found.

```typescript
const deleted = await eventModel.delete('evt_1');
```

#### `all(): Promise<T[]>`

Get all records (unfiltered).

```typescript
const allEvents = await eventModel.all();
```

#### `count(): Promise<number>`

Count all records.

```typescript
const totalEvents = await eventModel.count();
```

### Query Builder

Chain query methods for powerful filtering and sorting:

#### `where(conditions: Partial<T>): QueryBuilder<T>`

Filter by field values. Uses indexes when available.

```typescript
const events = await eventModel
  .where({ workspaceId: 'ws_abc' })
  .execute();
```

#### `after(date: Date): QueryBuilder<T>`

Filter records with date fields after the specified date.

```typescript
const recentEvents = await eventModel
  .after(new Date('2024-01-01'))
  .execute();
```

#### `before(date: Date): QueryBuilder<T>`

Filter records with date fields before the specified date.

```typescript
const oldEvents = await eventModel
  .before(new Date('2023-12-31'))
  .execute();
```

#### `limit(count: number): QueryBuilder<T>`

Limit the number of results returned.

```typescript
const topEvents = await eventModel
  .where({ workspaceId: 'ws_abc' })
  .limit(10)
  .execute();
```

#### `orderBy(field: keyof T, direction: 'asc' | 'desc'): QueryBuilder<T>`

Sort results by a field.

```typescript
const sortedEvents = await eventModel
  .where({ workspaceId: 'ws_abc' })
  .orderBy('timestamp', 'desc')
  .execute();
```

#### `execute(): Promise<T[]>`

Execute the query and return results.

```typescript
const events = await eventModel
  .where({ workspaceId: 'ws_abc' })
  .limit(100)
  .execute();
```

### Query Chaining Example

```typescript
const events = await eventModel
  .where({ workspaceId: 'ws_abc' })
  .after(new Date('2024-01-01'))
  .before(new Date('2024-12-31'))
  .orderBy('timestamp', 'desc')
  .limit(50)
  .execute();
```

## Indexing

Indexes dramatically improve query performance by avoiding full table scans:

- **Without index**: O(n) - scans every record
- **With index**: O(log n) - uses sorted index lookup

### How to define indexes

```typescript
class Event extends DOModel<EventSchema> {
  protected schema: EventSchema = {
    id: 'string',
    workspaceId: 'string',
    timestamp: 'date',
    type: 'string',
  };
  
  // Index these fields for efficient queries
  protected indexes = ['workspaceId', 'timestamp'] as const;
}
```

### When queries use indexes

- `.where({ indexedField: value })` - Uses index if first field is indexed
- Without indexed where clause - Falls back to full scan

### Index maintenance

Indexes are automatically maintained:
- Created during `create()`
- Updated during `update()` (if indexed fields change)
- Removed during `delete()`

## Schema Validation

DO-ORM validates all data against your schema:

```typescript
// ✅ Valid - passes validation
await eventModel.create({
  id: 'evt_1',
  workspaceId: 'ws_abc',
  timestamp: new Date(),
  type: 'click',
  data: {}
});

// ❌ Invalid - throws error
await eventModel.create({
  id: 'evt_1',
  workspaceId: 123, // Error: must be string
  timestamp: new Date(),
  type: 'click',
  data: {}
});

// ❌ Invalid - throws error
await eventModel.create({
  id: 'evt_1',
  // Missing required fields
});
```

### Validation errors

```typescript
try {
  await eventModel.create(invalidData);
} catch (error) {
  // "Field 'workspaceId' must be a string, got number"
  // "Missing required field: timestamp"
}
```

## TypeScript Inference

DO-ORM provides full type inference:

```typescript
// Define schema
interface EventSchema extends SchemaDefinition {
  id: 'string';
  workspaceId: 'string';
  timestamp: 'date';
}

class Event extends DOModel<EventSchema> {
  protected schema: EventSchema = {
    id: 'string',
    workspaceId: 'string',
    timestamp: 'date',
  };
  protected indexes = ['workspaceId'] as const;
}

// TypeScript knows the exact type!
const event = await eventModel.find('evt_1');
//    ^? Event | null

if (event) {
  event.id;           // string
  event.workspaceId;  // string
  event.timestamp;    // Date
  event.unknown;      // ❌ TypeScript error
}
```

## Advanced Usage

### Custom table names

```typescript
class Event extends DOModel<EventSchema> {
  constructor(storage: DurableObjectStorage) {
    super(storage, 'custom_events_table');
  }
  
  protected schema: EventSchema = { /* ... */ };
  protected indexes = [] as const;
}
```

### Multiple models in one DO

```typescript
export class MyDurableObject {
  private events: Event;
  private users: User;

  constructor(state: DurableObjectState) {
    this.events = new Event(state.storage);
    this.users = new User(state.storage, 'users_table');
  }

  async fetch(request: Request): Promise<Response> {
    const event = await this.events.find('evt_1');
    const user = await this.users.find('user_1');
    // ...
  }
}
```

## Performance Considerations

### Index usage

- **Indexed queries**: Fast O(log n) lookups
- **Non-indexed queries**: Slower O(n) full scans
- **Best practice**: Index frequently queried fields

### Storage efficiency

- Records stored as: `{tableName}:{id}`
- Indexes stored as: `index:{tableName}:{field}:{value}`
- Dates serialized as ISO strings for efficient sorting

### Query optimization tips

1. **Use indexes** - Define indexes for frequently queried fields
2. **Limit results** - Always use `.limit()` for large datasets
3. **Specific where clauses** - Filter by indexed fields first
4. **Batch operations** - Consider batching writes for bulk inserts

## Limitations

- **No compound indexes** - Only single-field indexes (for now)
- **No transactions** - Each operation is atomic but not grouped
- **No joins** - Each model is independent
- **No migrations** - Schema changes require manual data migration

## Examples

### Analytics events tracker

```typescript
interface AnalyticsSchema extends SchemaDefinition {
  id: 'string';
  sessionId: 'string';
  userId: 'string';
  event: 'string';
  timestamp: 'date';
  properties: 'object';
}

class Analytics extends DOModel<AnalyticsSchema> {
  protected schema: AnalyticsSchema = {
    id: 'string',
    sessionId: 'string',
    userId: 'string',
    event: 'string',
    timestamp: 'date',
    properties: 'object',
  };
  
  protected indexes = ['userId', 'sessionId', 'timestamp'] as const;
}

// Track an event
await analytics.create({
  id: generateId(),
  sessionId: 'session_abc',
  userId: 'user_123',
  event: 'purchase',
  timestamp: new Date(),
  properties: { amount: 99.99, currency: 'USD' }
});

// Get user's recent events
const userEvents = await analytics
  .where({ userId: 'user_123' })
  .after(thirtyDaysAgo)
  .orderBy('timestamp', 'desc')
  .limit(100)
  .execute();
```

### Task queue

```typescript
interface TaskSchema extends SchemaDefinition {
  id: 'string';
  status: 'string';
  priority: 'number';
  createdAt: 'date';
  payload: 'object';
}

class Task extends DOModel<TaskSchema> {
  protected schema: TaskSchema = {
    id: 'string',
    status: 'string',
    priority: 'number',
    createdAt: 'date',
    payload: 'object',
  };
  
  protected indexes = ['status', 'priority'] as const;
}

// Add task
await task.create({
  id: 'task_1',
  status: 'pending',
  priority: 1,
  createdAt: new Date(),
  payload: { action: 'send_email' }
});

// Get pending tasks
const pending = await task
  .where({ status: 'pending' })
  .orderBy('priority', 'asc')
  .limit(10)
  .execute();

// Process and mark complete
for (const t of pending) {
  await processTask(t);
  await task.update(t.id, { status: 'completed' });
}
```

## Testing

### Unit Tests

Run the unit test suite:

```bash
npm test
```

Tests include:
- Schema validation (type checking, required fields)
- CRUD operations (create, read, update, delete)
- Query builder (where, limit, orderBy, date ranges)
- Index usage and maintenance
- Edge cases (duplicates, missing records)

### Integration Tests (with Cloudflare Workers)

Test the ORM in a real Cloudflare Workers environment:

```bash
# Terminal 1: Start the worker
npm run dev

# Terminal 2: Run integration tests
npm run test:worker
```

The integration tests verify the complete stack:
- Worker HTTP endpoints
- Durable Object instantiation
- DO-ORM with real DO storage
- Schema validation in production
- Query performance with indexes

See [TESTING.md](./TESTING.md) for more details on testing with Cloudflare Workers.

## Contributing

This is v1 - there's lots of room for improvement!

**Potential enhancements:**
- Compound indexes (multiple fields)
- Transactions support
- Query result streaming
- Migration helpers
- Soft deletes
- Hooks (beforeCreate, afterUpdate, etc.)

## License

Apache-2.0

---

Built for the Cloudflare Workers ecosystem. Works seamlessly with Durable Objects and provides a better developer experience than raw storage API calls.
