/**
 * Type definitions for DO-ORM
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';

export interface SchemaDefinition {
  [key: string]: FieldType;
}

export interface QueryOptions<T> {
  where?: Partial<T>;
  after?: Date;
  before?: Date;
  limit?: number;
  orderBy?: {
    field: keyof T;
    direction: 'asc' | 'desc';
  };
}

export interface ModelConfig {
  tableName?: string;
}

export type InferSchemaType<S extends SchemaDefinition> = {
  [K in keyof S]: S[K] extends 'string' ? string
    : S[K] extends 'number' ? number
    : S[K] extends 'boolean' ? boolean
    : S[K] extends 'date' ? Date
    : S[K] extends 'object' ? Record<string, any>
    : S[K] extends 'array' ? any[]
    : never;
};
