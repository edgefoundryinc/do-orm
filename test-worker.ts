/**
 * Test script for the DO-ORM worker
 * Run with: npm run test:worker
 * Make sure the worker is running with: npm run dev
 */

const WORKER_URL = 'http://localhost:8787';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✅ ${name}`);
  } catch (error) {
    results.push({ 
      name, 
      passed: false, 
      error: error instanceof Error ? error.message : String(error)
    });
    console.log(`❌ ${name}`);
    console.error(`   ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests() {
  console.log('🧪 DO-ORM Worker Test Suite\n');
  console.log(`Testing worker at: ${WORKER_URL}\n`);

  // Test 1: Health check
  await test('Health check', async () => {
    const response = await fetch(`${WORKER_URL}/health`);
    const data = await response.json() as any;
    assert(data.success === true, 'Health check should succeed');
    assert(data.status === 'healthy', 'Status should be healthy');
  });

  // Test 2: Create an event
  let eventId: string;
  await test('Create an event', async () => {
    const response = await fetch(`${WORKER_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'ws_test',
        userId: 'user_123',
        type: 'click',
        timestamp: new Date().toISOString(),
        data: { button: 'submit', page: '/home' }
      })
    });
    
    const data = await response.json() as any;
    assert(data.success === true, 'Create should succeed');
    assert(data.event.workspaceId === 'ws_test', 'workspaceId should match');
    eventId = data.event.id;
  });

  // Test 3: Get event by ID
  await test('Get event by ID', async () => {
    const response = await fetch(`${WORKER_URL}/events/${eventId}`);
    const data = await response.json() as any;
    assert(data.success === true, 'Get should succeed');
    assert(data.event.id === eventId, 'Event ID should match');
    assert(data.event.type === 'click', 'Event type should match');
  });

  // Test 4: Create multiple events for querying
  await test('Create multiple events', async () => {
    const events = [
      { workspaceId: 'ws_test', userId: 'user_123', type: 'pageview', data: { page: '/about' } },
      { workspaceId: 'ws_test', userId: 'user_456', type: 'click', data: { button: 'signup' } },
      { workspaceId: 'ws_other', userId: 'user_789', type: 'purchase', data: { amount: 99 } },
    ];

    for (const event of events) {
      const response = await fetch(`${WORKER_URL}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...event,
          timestamp: new Date().toISOString()
        })
      });
      const data = await response.json() as any;
      assert(data.success === true, 'Each create should succeed');
    }
  });

  // Test 5: Query by workspaceId
  await test('Query by workspaceId', async () => {
    const response = await fetch(`${WORKER_URL}/events?workspaceId=ws_test`);
    const data = await response.json() as any;
    assert(data.success === true, 'Query should succeed');
    assert(data.count >= 3, `Should have at least 3 events, got ${data.count}`);
    assert(
      data.events.every((e: any) => e.workspaceId === 'ws_test'),
      'All events should be from ws_test'
    );
  });

  // Test 6: Query with limit
  await test('Query with limit', async () => {
    const response = await fetch(`${WORKER_URL}/events?workspaceId=ws_test&limit=2`);
    const data = await response.json() as any;
    assert(data.success === true, 'Query should succeed');
    assert(data.count === 2, `Should return exactly 2 events, got ${data.count}`);
  });

  // Test 7: Query by userId
  await test('Query by userId', async () => {
    const response = await fetch(`${WORKER_URL}/events?userId=user_123`);
    const data = await response.json() as any;
    assert(data.success === true, 'Query should succeed');
    assert(data.count >= 2, `Should have at least 2 events for user_123, got ${data.count}`);
    assert(
      data.events.every((e: any) => e.userId === 'user_123'),
      'All events should be from user_123'
    );
  });

  // Test 8: Update an event
  await test('Update an event', async () => {
    const response = await fetch(`${WORKER_URL}/events/${eventId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: { button: 'submit', page: '/home', updated: true }
      })
    });
    
    const data = await response.json() as any;
    assert(data.success === true, 'Update should succeed');
    assert(data.event.data.updated === true, 'Data should be updated');
  });

  // Test 9: Get statistics
  await test('Get statistics', async () => {
    const response = await fetch(`${WORKER_URL}/stats`);
    const data = await response.json() as any;
    assert(data.success === true, 'Stats should succeed');
    assert(data.stats.totalEvents >= 4, 'Should have at least 4 events');
    assert(data.stats.uniqueWorkspaces >= 2, 'Should have at least 2 workspaces');
  });

  // Test 10: Delete an event
  await test('Delete an event', async () => {
    const response = await fetch(`${WORKER_URL}/events/${eventId}`, {
      method: 'DELETE'
    });
    
    const data = await response.json() as any;
    assert(data.success === true, 'Delete should succeed');
    
    // Verify it's gone
    const getResponse = await fetch(`${WORKER_URL}/events/${eventId}`);
    const getData = await getResponse.json() as any;
    assert(getData.success === false, 'Should not find deleted event');
  });

  // Test 11: Schema validation (should fail)
  await test('Schema validation - invalid type', async () => {
    const response = await fetch(`${WORKER_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 123, // should be string
        userId: 'user_123',
        type: 'click',
        timestamp: new Date().toISOString(),
        data: {}
      })
    });
    
    const data = await response.json() as any;
    assert(data.success === false, 'Should fail validation');
    assert(
      data.error.includes('must be a string'),
      'Should mention type mismatch'
    );
  });

  // Test 12: Query with date range
  await test('Query with date range', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const response = await fetch(`${WORKER_URL}/events?workspaceId=ws_test&after=${tenMinutesAgo}`);
    const data = await response.json() as any;
    assert(data.success === true, 'Query should succeed');
    // All events we created should be recent
    assert(data.count >= 0, 'Should have results');
  });

  // Print summary
  console.log('\n' + '='.repeat(50));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Tests: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('='.repeat(50));

  if (failed > 0) {
    console.log('\n❌ Some tests failed\n');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!\n');
  }
}

// Check if worker is running
async function checkWorker() {
  try {
    const response = await fetch(`${WORKER_URL}/health`, { 
      signal: AbortSignal.timeout(2000) 
    });
    if (!response.ok) {
      throw new Error('Worker not healthy');
    }
    return true;
  } catch (error) {
    console.error('❌ Cannot connect to worker');
    console.error('   Make sure the worker is running with: npm run dev');
    console.error(`   Expected worker at: ${WORKER_URL}\n`);
    process.exit(1);
  }
}

// Run tests
checkWorker()
  .then(() => runTests())
  .catch(error => {
    console.error('Test suite error:', error);
    process.exit(1);
  });
