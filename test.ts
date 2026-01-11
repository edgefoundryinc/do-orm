/**
 * Test suite for DO-ORM
 * Simulates Cloudflare Durable Objects storage for testing
 */

import { DOModel, InferSchemaType, SchemaDefinition } from './src/index';

// Mock Durable Object Storage implementation for testing
class MockDurableObjectStorage implements DurableObjectStorage {
  private data: Map<string, any> = new Map();

  async get<T = unknown>(key: string): Promise<T | undefined>;
  async get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  async get<T = unknown>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
    if (Array.isArray(keyOrKeys)) {
      const result = new Map<string, T>();
      for (const key of keyOrKeys) {
        const value = this.data.get(key);
        if (value !== undefined) {
          result.set(key, value);
        }
      }
      return result;
    }
    return this.data.get(keyOrKeys) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void>;
  async put<T>(entries: Record<string, T>): Promise<void>;
  async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
    if (typeof keyOrEntries === 'string') {
      this.data.set(keyOrEntries, value);
    } else {
      for (const [key, val] of Object.entries(keyOrEntries)) {
        this.data.set(key, val);
      }
    }
  }

  async delete(key: string): Promise<boolean>;
  async delete(keys: string[]): Promise<number>;
  async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
    if (Array.isArray(keyOrKeys)) {
      let count = 0;
      for (const key of keyOrKeys) {
        if (this.data.delete(key)) count++;
      }
      return count;
    }
    return this.data.delete(keyOrKeys);
  }

  async list(options?: { prefix?: string; start?: string; end?: string; limit?: number }): Promise<Map<string, any>> {
    const result = new Map<string, any>();
    const prefix = options?.prefix || '';
    
    for (const [key, value] of this.data.entries()) {
      if (key.startsWith(prefix)) {
        result.set(key, value);
      }
    }
    
    return result;
  }

  async deleteAll(): Promise<void> {
    this.data.clear();
  }

  transaction<T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T> {
    throw new Error('Transactions not implemented in mock');
  }

  getAlarm(): Promise<number | null> {
    throw new Error('Alarms not implemented in mock');
  }

  setAlarm(scheduledTime: number | Date): Promise<void> {
    throw new Error('Alarms not implemented in mock');
  }

  deleteAlarm(): Promise<void> {
    throw new Error('Alarms not implemented in mock');
  }

  sync(): Promise<void> {
    return Promise.resolve();
  }
}

// Define test Event model
interface EventSchema extends SchemaDefinition {
  id: 'string';
  workspaceId: 'string';
  timestamp: 'date';
  type: 'string';
  data: 'object';
}

class Event extends DOModel<EventSchema> {
  protected schema: EventSchema = {
    id: 'string',
    workspaceId: 'string',
    timestamp: 'date',
    type: 'string',
    data: 'object',
  };
  
  protected indexes = ['workspaceId', 'timestamp'] as const;
}

// Test runner
class TestRunner {
  private passed = 0;
  private failed = 0;

  async test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      this.passed++;
    } catch (error) {
      console.error(`❌ FAIL: ${name}`);
      console.error(`   ${error instanceof Error ? error.message : String(error)}`);
      this.failed++;
    }
  }

  assert(condition: boolean, message: string) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  assertEquals(actual: any, expected: any, message?: string) {
    if (actual !== expected) {
      throw new Error(
        message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      );
    }
  }

  summary() {
    console.log('\n' + '='.repeat(50));
    console.log(`Tests: ${this.passed + this.failed}`);
    console.log(`Passed: ${this.passed}`);
    console.log(`Failed: ${this.failed}`);
    console.log('='.repeat(50));
    return this.failed === 0;
  }
}

// Run tests
async function runTests() {
  const runner = new TestRunner();
  
  console.log('🧪 DO-ORM Test Suite\n');

  // Test 1: Create a record
  await runner.test('Create a record', async () => {
    const storage = new MockDurableObjectStorage();
    const eventModel = new Event(storage);

    const event = await eventModel.create({
      id: 'evt_1',
      workspaceId: 'ws_abc',
      timestamp: new Date('2024-01-01T10:00:00Z'),
      type: 'click',
      data: { button: 'submit' },
    });

    runner.assertEquals(event.id, 'evt_1');
    runner.assertEquals(event.workspaceId, 'ws_abc');
    runner.assertEquals(event.type, 'click');
  });

  // Test 2: Find a record by ID
  await runner.test('Find a record by ID', async () => {
    const storage = new MockDurableObjectStorage();
    const eventModel = new Event(storage);

    await eventModel.create({
      id: 'evt_2',
      workspaceId: 'ws_xyz',
      timestamp: new Date('2024-01-02T10:00:00Z'),
      type: 'pageview',
      data: { page: '/home' },
    });

    const found = await eventModel.find('evt_2');
    runner.assert(found !== null, 'Record should be found');
    runner.assertEquals(found!.id, 'evt_2');
    runner.assertEquals(found!.workspaceId, 'ws_xyz');
  });

  // Test 3: Schema validation - missing field
  await runner.test('Schema validation - missing field', async () => {
    const storage = new MockDurableObjectStorage();
    const eventModel = new Event(storage);

    try {
      await eventModel.create({
        id: 'evt_bad',
        workspaceId: 'ws_test',
        // missing timestamp
      } as any);
      throw new Error('Should have thrown validation error');
    } catch (error) {
      runner.assert(
        error instanceof Error && error.message.includes('Missing required field'),
        'Should throw missing field error'
      );
    }
  });

  // Test 4: Schema validation - wrong type
  await runner.test('Schema validation - wrong type', async () => {
    const storage = new MockDurableObjectStorage();
    const eventModel = new Event(storage);

    try {
      await eventModel.create({
        id: 'evt_bad',
        workspaceId: 123, // should be string
        timestamp: new Date(),
        type: 'click',
        data: {},
      } as any);
      throw new Error('Should have thrown validation error');
    } catch (error) {
      runner.assert(
        error instanceof Error && error.message.includes('must be a string'),
        'Should throw type mismatch error'
      );
    }
  });

  // Test 5: Query with where clause (using index)
  await runner.test('Query with where clause (indexed)', async () => {
    const storage = new MockDurableObjectStorage();
    const eventModel = new Event(storage);

    await eventModel.create({
      id: 'evt_3',
      workspaceId: 'ws_abc',
      timestamp: new Date('2024-01-03T10:00:00Z'),
      type: 'click',
      data: {},
    });

    await eventModel.create({
      id: 'evt_4',
      workspaceId: 'ws_abc',
      timestamp: new Date('2024-01-04T10:00:00Z'),
      type: 'pageview',
      data: {},
    });

    await eventModel.create({
      id: 'evt_5',
      workspaceId: 'ws_xyz',
      timestamp: new Date('2024-01-05T10:00:00Z'),
      type: 'click',
      data: {},
    });

    const results = await eventModel.where({ workspaceId: 'ws_abc' }).execute();
    runner.assertEquals(results.length, 2, 'Should find 2 events for ws_abc');
    runner.assert(
      results.every(r => r.workspaceId === 'ws_abc'),
      'All results should be from ws_abc'
    );
  });

  // Test 6: Query with limit
  await runner.test('Query with limit', async () => {
    const storage = new MockDurableObjectStorage();
    const eventModel = new Event(storage);

    for (let i = 0; i < 5; i++) {
      await eventModel.create({
        id: `evt_${i}`,
        workspaceId: 'ws_test',
        timestamp: new Date(`2024-01-0${i + 1}T10:00:00Z`),
        type: 'click',
        data: {},
      });
    }

    const results = await eventModel.where({ workspaceId: 'ws_test' }).limit(3).execute();
    runner.assertEquals(results.length, 3, 'Should return only 3 results');
  });

  // Test 7: Query with date range
  await runner.test('Query with date range (after)', async () => {
    const storage = new MockDurableObjectStorage();
    const eventModel = new Event(storage);

    await eventModel.create({
      id: 'evt_6',
      workspaceId: 'ws_test',
      timestamp: new Date('2024-01-01T10:00:00Z'),
      type: 'click',
      data: {},
    });

    await eventModel.create({
      id: 'evt_7',
      workspaceId: 'ws_test',
      timestamp: new Date('2024-01-05T10:00:00Z'),
      type: 'click',
      data: {},
    });

    await eventModel.create({
      id: 'evt_8',
      workspaceId: 'ws_test',
      timestamp: new Date('2024-01-10T10:00:00Z'),
      type: 'click',
      data: {},
    });

    const results = await eventModel
      .where({ workspaceId: 'ws_test' })
      .after(new Date('2024-01-03T00:00:00Z'))
      .execute();

    runner.assertEquals(results.length, 2, 'Should find 2 events after Jan 3');
    runner.assert(
      results.every(r => r.timestamp > new Date('2024-01-03T00:00:00Z')),
      'All events should be after Jan 3'
    );
  });

  // Test 8: Update a record
  await runner.test('Update a record', async () => {
    const storage = new MockDurableObjectStorage();
    const eventModel = new Event(storage);

    await eventModel.create({
      id: 'evt_9',
      workspaceId: 'ws_abc',
      timestamp: new Date('2024-01-01T10:00:00Z'),
      type: 'click',
      data: { count: 1 },
    });

    const updated = await eventModel.update('evt_9', {
      data: { count: 2 },
    });

    runner.assertEquals((updated.data as any).count, 2, 'Data should be updated');
    runner.assertEquals(updated.workspaceId, 'ws_abc', 'Other fields should remain');
  });

  // Test 9: Delete a record
  await runner.test('Delete a record', async () => {
    const storage = new MockDurableObjectStorage();
    const eventModel = new Event(storage);

    await eventModel.create({
      id: 'evt_10',
      workspaceId: 'ws_delete',
      timestamp: new Date('2024-01-01T10:00:00Z'),
      type: 'click',
      data: {},
    });

    const deleted = await eventModel.delete('evt_10');
    runner.assert(deleted, 'Delete should return true');

    const found = await eventModel.find('evt_10');
    runner.assert(found === null, 'Record should not exist after delete');
  });

  // Test 10: OrderBy
  await runner.test('Query with orderBy', async () => {
    const storage = new MockDurableObjectStorage();
    const eventModel = new Event(storage);

    await eventModel.create({
      id: 'evt_11',
      workspaceId: 'ws_sort',
      timestamp: new Date('2024-01-03T10:00:00Z'),
      type: 'c_event',
      data: {},
    });

    await eventModel.create({
      id: 'evt_12',
      workspaceId: 'ws_sort',
      timestamp: new Date('2024-01-01T10:00:00Z'),
      type: 'a_event',
      data: {},
    });

    await eventModel.create({
      id: 'evt_13',
      workspaceId: 'ws_sort',
      timestamp: new Date('2024-01-02T10:00:00Z'),
      type: 'b_event',
      data: {},
    });

    const ascending = await eventModel
      .where({ workspaceId: 'ws_sort' })
      .orderBy('timestamp', 'asc')
      .execute();

    runner.assertEquals(ascending[0].id, 'evt_12', 'First should be oldest');
    runner.assertEquals(ascending[2].id, 'evt_11', 'Last should be newest');

    const descending = await eventModel
      .where({ workspaceId: 'ws_sort' })
      .orderBy('timestamp', 'desc')
      .execute();

    runner.assertEquals(descending[0].id, 'evt_11', 'First should be newest');
    runner.assertEquals(descending[2].id, 'evt_12', 'Last should be oldest');
  });

  // Test 11: Count records
  await runner.test('Count records', async () => {
    const storage = new MockDurableObjectStorage();
    const eventModel = new Event(storage);

    await eventModel.create({
      id: 'evt_14',
      workspaceId: 'ws_count',
      timestamp: new Date(),
      type: 'click',
      data: {},
    });

    await eventModel.create({
      id: 'evt_15',
      workspaceId: 'ws_count',
      timestamp: new Date(),
      type: 'click',
      data: {},
    });

    const count = await eventModel.count();
    runner.assertEquals(count, 2, 'Should count 2 records');
  });

  // Test 12: Get all records
  await runner.test('Get all records', async () => {
    const storage = new MockDurableObjectStorage();
    const eventModel = new Event(storage);

    await eventModel.create({
      id: 'evt_16',
      workspaceId: 'ws_all',
      timestamp: new Date(),
      type: 'click',
      data: {},
    });

    await eventModel.create({
      id: 'evt_17',
      workspaceId: 'ws_all',
      timestamp: new Date(),
      type: 'click',
      data: {},
    });

    const all = await eventModel.all();
    runner.assertEquals(all.length, 2, 'Should get all 2 records');
  });

  // Test 13: Prevent duplicate IDs
  await runner.test('Prevent duplicate IDs', async () => {
    const storage = new MockDurableObjectStorage();
    const eventModel = new Event(storage);

    await eventModel.create({
      id: 'evt_dup',
      workspaceId: 'ws_test',
      timestamp: new Date(),
      type: 'click',
      data: {},
    });

    try {
      await eventModel.create({
        id: 'evt_dup',
        workspaceId: 'ws_test',
        timestamp: new Date(),
        type: 'click',
        data: {},
      });
      throw new Error('Should have thrown duplicate ID error');
    } catch (error) {
      runner.assert(
        error instanceof Error && error.message.includes('already exists'),
        'Should throw duplicate ID error'
      );
    }
  });

  return runner.summary();
}

// Execute tests
runTests()
  .then(success => {
    if (!success) {
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Test suite error:', error);
    process.exit(1);
  });
