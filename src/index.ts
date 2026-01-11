/**
 * DO-ORM v1 - Type-safe ORM for Cloudflare Durable Objects
 * Zero dependencies, pure TypeScript implementation
 */

import type { SchemaDefinition, FieldType, QueryOptions, InferSchemaType } from './types';

export * from './types';

/**
 * Base class for all DO models
 * Provides CRUD operations, schema validation, and indexing
 */
export abstract class DOModel<S extends SchemaDefinition> {
  protected abstract schema: S;
  protected abstract indexes: (keyof InferSchemaType<S>)[];
  protected storage: DurableObjectStorage;
  protected tableName: string;

  constructor(storage: DurableObjectStorage, tableName?: string) {
    this.storage = storage;
    this.tableName = tableName || this.constructor.name.toLowerCase();
  }

  /**
   * Validate a value against a schema field type
   */
  private validateField(value: any, fieldType: FieldType, fieldName: string): void {
    switch (fieldType) {
      case 'string':
        if (typeof value !== 'string') {
          throw new Error(`Field '${fieldName}' must be a string, got ${typeof value}`);
        }
        break;
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          throw new Error(`Field '${fieldName}' must be a number, got ${typeof value}`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new Error(`Field '${fieldName}' must be a boolean, got ${typeof value}`);
        }
        break;
      case 'date':
        if (!(value instanceof Date) || isNaN(value.getTime())) {
          throw new Error(`Field '${fieldName}' must be a valid Date, got ${typeof value}`);
        }
        break;
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new Error(`Field '${fieldName}' must be an object, got ${typeof value}`);
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          throw new Error(`Field '${fieldName}' must be an array, got ${typeof value}`);
        }
        break;
      default:
        throw new Error(`Unknown field type: ${fieldType}`);
    }
  }

  /**
   * Validate an entire record against the schema
   */
  private validateSchema(data: any): void {
    // Check for missing required fields
    for (const [fieldName, fieldType] of Object.entries(this.schema)) {
      if (!(fieldName in data)) {
        throw new Error(`Missing required field: ${fieldName}`);
      }
      this.validateField(data[fieldName], fieldType, fieldName);
    }
  }

  /**
   * Generate storage key for a record
   */
  private getRecordKey(id: string): string {
    return `${this.tableName}:${id}`;
  }

  /**
   * Generate storage key for an index
   */
  private getIndexKey(field: string, value: any): string {
    const normalizedValue = value instanceof Date ? value.toISOString() : String(value);
    return `index:${this.tableName}:${field}:${normalizedValue}`;
  }

  /**
   * Get all index entry keys for a given field
   */
  private getIndexPrefix(field: string): string {
    return `index:${this.tableName}:${field}:`;
  }

  /**
   * Serialize a value for storage (convert Dates to ISO strings)
   */
  private serialize(data: any): any {
    const serialized: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (value instanceof Date) {
        serialized[key] = value.toISOString();
      } else {
        serialized[key] = value;
      }
    }
    return serialized;
  }

  /**
   * Deserialize a value from storage (convert ISO strings back to Dates)
   */
  private deserialize(data: any): InferSchemaType<S> {
    const deserialized: any = {};
    for (const [key, value] of Object.entries(data)) {
      const fieldType = this.schema[key];
      if (fieldType === 'date' && typeof value === 'string') {
        deserialized[key] = new Date(value);
      } else {
        deserialized[key] = value;
      }
    }
    return deserialized as InferSchemaType<S>;
  }

  /**
   * Update indexes for a record
   */
  private async updateIndexes(id: string, data: InferSchemaType<S>): Promise<void> {
    for (const indexField of this.indexes) {
      const fieldValue = data[indexField];
      const indexKey = this.getIndexKey(String(indexField), fieldValue);
      
      // Get existing IDs in this index
      const existingIds = await this.storage.get<string[]>(indexKey) || [];
      
      // Add ID if not already present
      if (!existingIds.includes(id)) {
        existingIds.push(id);
        await this.storage.put(indexKey, existingIds);
      }
    }
  }

  /**
   * Remove record ID from indexes
   */
  private async removeFromIndexes(id: string, data: InferSchemaType<S>): Promise<void> {
    for (const indexField of this.indexes) {
      const fieldValue = data[indexField];
      const indexKey = this.getIndexKey(String(indexField), fieldValue);
      
      // Get existing IDs and remove this one
      const existingIds = await this.storage.get<string[]>(indexKey) || [];
      const filteredIds = existingIds.filter(existingId => existingId !== id);
      
      if (filteredIds.length > 0) {
        await this.storage.put(indexKey, filteredIds);
      } else {
        await this.storage.delete(indexKey);
      }
    }
  }

  /**
   * Create a new record
   */
  async create(data: InferSchemaType<S>): Promise<InferSchemaType<S>> {
    // Validate schema
    this.validateSchema(data);

    // Check if record already exists
    const id = (data as any).id;
    if (!id) {
      throw new Error('Record must have an id field');
    }

    const key = this.getRecordKey(id);
    const existing = await this.storage.get(key);
    if (existing) {
      throw new Error(`Record with id '${id}' already exists`);
    }

    // Serialize and store
    const serialized = this.serialize(data);
    await this.storage.put(key, serialized);

    // Update indexes
    await this.updateIndexes(id, data);

    return data;
  }

  /**
   * Find a record by ID
   */
  async find(id: string): Promise<InferSchemaType<S> | null> {
    const key = this.getRecordKey(id);
    const data = await this.storage.get(key);
    
    if (!data) {
      return null;
    }

    return this.deserialize(data);
  }

  /**
   * Update a record
   */
  async update(id: string, updates: Partial<InferSchemaType<S>>): Promise<InferSchemaType<S>> {
    const existing = await this.find(id);
    if (!existing) {
      throw new Error(`Record with id '${id}' not found`);
    }

    // Merge updates
    const updated = { ...existing, ...updates };

    // Validate the complete record
    this.validateSchema(updated);

    // Remove old indexes if indexed fields changed
    const indexedFieldsChanged = this.indexes.some(field => 
      field in updates && updates[field] !== existing[field]
    );

    if (indexedFieldsChanged) {
      await this.removeFromIndexes(id, existing);
    }

    // Store updated record
    const serialized = this.serialize(updated);
    await this.storage.put(this.getRecordKey(id), serialized);

    // Update indexes with new values
    if (indexedFieldsChanged) {
      await this.updateIndexes(id, updated);
    }

    return updated;
  }

  /**
   * Delete a record
   */
  async delete(id: string): Promise<boolean> {
    const existing = await this.find(id);
    if (!existing) {
      return false;
    }

    // Remove from indexes
    await this.removeFromIndexes(id, existing);

    // Delete record
    await this.storage.delete(this.getRecordKey(id));

    return true;
  }

  /**
   * Query builder - returns all matching records
   */
  async query(options: QueryOptions<InferSchemaType<S>> = {}): Promise<InferSchemaType<S>[]> {
    let candidateIds: string[] = [];

    // Use indexes if where clause matches an indexed field
    if (options.where) {
      const whereEntries = Object.entries(options.where);
      if (whereEntries.length > 0) {
        const [field, value] = whereEntries[0];
        
        // Check if this field is indexed
        if (this.indexes.includes(field as any)) {
          const indexKey = this.getIndexKey(field, value);
          candidateIds = await this.storage.get<string[]>(indexKey) || [];
        }
      }
    }

    // If no index was used, scan all records (slower)
    if (candidateIds.length === 0 && !options.where) {
      const prefix = `${this.tableName}:`;
      const allKeys = await this.storage.list({ prefix });
      candidateIds = Array.from(allKeys.keys()).map(key => 
        key.toString().replace(prefix, '')
      );
    }

    // Load all candidate records
    const records: InferSchemaType<S>[] = [];
    for (const id of candidateIds) {
      const record = await this.find(id);
      if (record) {
        records.push(record);
      }
    }

    // Apply filters
    let filtered = records;

    // Filter by where clause (additional fields not covered by index)
    if (options.where) {
      filtered = filtered.filter(record => {
        for (const [key, value] of Object.entries(options.where!)) {
          if ((record as any)[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    // Filter by date range (after/before)
    if (options.after || options.before) {
      filtered = filtered.filter(record => {
        // Find date field in schema
        for (const [field, type] of Object.entries(this.schema)) {
          if (type === 'date') {
            const dateValue = (record as any)[field];
            if (dateValue instanceof Date) {
              if (options.after && dateValue <= options.after) return false;
              if (options.before && dateValue >= options.before) return false;
            }
          }
        }
        return true;
      });
    }

    // Sort
    if (options.orderBy) {
      const { field, direction } = options.orderBy;
      filtered.sort((a, b) => {
        const aVal = (a as any)[field];
        const bVal = (b as any)[field];
        
        let comparison = 0;
        if (aVal < bVal) comparison = -1;
        if (aVal > bVal) comparison = 1;
        
        return direction === 'desc' ? -comparison : comparison;
      });
    }

    // Apply limit
    if (options.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Query builder with fluent API
   */
  where(conditions: Partial<InferSchemaType<S>>): QueryBuilder<S> {
    return new QueryBuilder(this, { where: conditions });
  }

  /**
   * Get all records
   */
  async all(): Promise<InferSchemaType<S>[]> {
    return this.query();
  }

  /**
   * Count all records
   */
  async count(): Promise<number> {
    const prefix = `${this.tableName}:`;
    const allKeys = await this.storage.list({ prefix });
    return allKeys.size;
  }
}

/**
 * Fluent query builder
 */
export class QueryBuilder<S extends SchemaDefinition> {
  private model: DOModel<S>;
  private options: QueryOptions<InferSchemaType<S>>;

  constructor(model: DOModel<S>, options: QueryOptions<InferSchemaType<S>> = {}) {
    this.model = model;
    this.options = options;
  }

  where(conditions: Partial<InferSchemaType<S>>): QueryBuilder<S> {
    this.options.where = { ...this.options.where, ...conditions };
    return this;
  }

  after(date: Date): QueryBuilder<S> {
    this.options.after = date;
    return this;
  }

  before(date: Date): QueryBuilder<S> {
    this.options.before = date;
    return this;
  }

  limit(count: number): QueryBuilder<S> {
    this.options.limit = count;
    return this;
  }

  orderBy(field: keyof InferSchemaType<S>, direction: 'asc' | 'desc' = 'asc'): QueryBuilder<S> {
    this.options.orderBy = { field, direction };
    return this;
  }

  async execute(): Promise<InferSchemaType<S>[]> {
    return this.model.query(this.options);
  }
}
