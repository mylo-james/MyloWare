import Joi from 'joi';
/**
 * Common validation schemas
 */
export declare const commonSchemas: {
  id: Joi.StringSchema<string>;
  email: Joi.StringSchema<string>;
  password: Joi.StringSchema<string>;
  timestamp: Joi.DateSchema<Date>;
  pagination: Joi.ObjectSchema<any>;
};
/**
 * Environment variable validation schema
 */
export declare const envSchema: Joi.ObjectSchema<any>;
//# sourceMappingURL=common-schemas.d.ts.map
