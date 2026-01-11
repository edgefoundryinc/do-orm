/**
 * Cloudflare Worker with Durable Object using DO-ORM
 */

import { DOModel, SchemaDefinition, InferSchemaType } from '../src/index';

// Define Event schema
interface EventSchema extends SchemaDefinition {
  id: 'string';
  workspaceId: 'string';
  timestamp: 'date';
  type: 'string';
  userId: 'string';
  data: 'object';
}

class Event extends DOModel<EventSchema> {
  protected schema: EventSchema = {
    id: 'string',
    workspaceId: 'string',
    timestamp: 'date',
    type: 'string',
    userId: 'string',
    data: 'object',
  };
  
  protected indexes = ['workspaceId', 'userId', 'timestamp'] as const;
}

// Durable Object class
export class EventStore {
  private state: DurableObjectState;
  private eventModel: Event;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.eventModel = new Event(state.storage, 'events');
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // POST /events - Create a new event
      if (path === '/events' && method === 'POST') {
        const body = await request.json() as any;
        
        // Generate ID if not provided
        if (!body.id) {
          body.id = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }
        
        // Parse timestamp if string
        if (body.timestamp && typeof body.timestamp === 'string') {
          body.timestamp = new Date(body.timestamp);
        }
        
        const event = await this.eventModel.create(body);
        
        return new Response(JSON.stringify({
          success: true,
          event
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // GET /events/:id - Get event by ID
      if (path.startsWith('/events/') && method === 'GET') {
        const id = path.split('/')[2];
        const event = await this.eventModel.find(id);
        
        if (!event) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Event not found'
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        return new Response(JSON.stringify({
          success: true,
          event
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // GET /events?workspaceId=...&limit=... - Query events
      if (path === '/events' && method === 'GET') {
        const workspaceId = url.searchParams.get('workspaceId');
        const userId = url.searchParams.get('userId');
        const after = url.searchParams.get('after');
        const before = url.searchParams.get('before');
        const limit = url.searchParams.get('limit');
        const orderBy = url.searchParams.get('orderBy') || 'timestamp';
        const order = url.searchParams.get('order') || 'desc';

        // Build where conditions
        const whereConditions: any = {};
        if (workspaceId) {
          whereConditions.workspaceId = workspaceId;
        }
        if (userId) {
          whereConditions.userId = userId;
        }

        // Start query
        let query = Object.keys(whereConditions).length > 0
          ? this.eventModel.where(whereConditions)
          : this.eventModel.where({} as any);
        
        if (after) {
          query = query.after(new Date(after));
        }
        
        if (before) {
          query = query.before(new Date(before));
        }
        
        if (limit) {
          query = query.limit(parseInt(limit, 10));
        }
        
        query = query.orderBy(orderBy as any, order as 'asc' | 'desc');
        
        const events = await query.execute();
        
        return new Response(JSON.stringify({
          success: true,
          count: events.length,
          events
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // PUT /events/:id - Update event
      if (path.startsWith('/events/') && method === 'PUT') {
        const id = path.split('/')[2];
        const body = await request.json() as any;
        
        // Parse timestamp if string
        if (body.timestamp && typeof body.timestamp === 'string') {
          body.timestamp = new Date(body.timestamp);
        }
        
        const event = await this.eventModel.update(id, body);
        
        return new Response(JSON.stringify({
          success: true,
          event
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // DELETE /events/:id - Delete event
      if (path.startsWith('/events/') && method === 'DELETE') {
        const id = path.split('/')[2];
        const deleted = await this.eventModel.delete(id);
        
        return new Response(JSON.stringify({
          success: deleted,
          deleted
        }), {
          status: deleted ? 200 : 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // GET /stats - Get statistics
      if (path === '/stats' && method === 'GET') {
        const count = await this.eventModel.count();
        const all = await this.eventModel.all();
        
        // Calculate some basic stats
        const workspaces = new Set(all.map(e => e.workspaceId)).size;
        const users = new Set(all.map(e => e.userId)).size;
        const types = new Set(all.map(e => e.type)).size;
        
        return new Response(JSON.stringify({
          success: true,
          stats: {
            totalEvents: count,
            uniqueWorkspaces: workspaces,
            uniqueUsers: users,
            eventTypes: types
          }
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // GET /health - Health check
      if (path === '/health' && method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          status: 'healthy',
          orm: 'DO-ORM v1.0.0',
          timestamp: new Date().toISOString()
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        success: false,
        error: 'Not found',
        availableEndpoints: [
          'POST /events - Create event',
          'GET /events/:id - Get event',
          'GET /events?workspaceId=...&limit=... - Query events',
          'PUT /events/:id - Update event',
          'DELETE /events/:id - Delete event',
          'GET /stats - Get statistics',
          'GET /health - Health check'
        ]
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}

// Worker interface
interface Env {
  EVENTS: DurableObjectNamespace;
}

// Main worker handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      
      // Get or create Durable Object stub
      // For simplicity, use a single shared DO instance
      // In production, you might want to shard by workspace/region/etc
      const id = env.EVENTS.idFromName('shared');
      const stub = env.EVENTS.get(id);
      
      // Forward request to Durable Object
      return await stub.fetch(request);

    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
