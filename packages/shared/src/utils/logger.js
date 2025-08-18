'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.createLogger = createLogger;
const winston_1 = __importDefault(require('winston'));
/**
 * Create a Winston logger instance with standardized configuration
 */
function createLogger(service, logLevel = 'INFO') {
  const environment = process.env['NODE_ENV'] || 'development';
  const logger = winston_1.default.createLogger({
    level: logLevel.toLowerCase(),
    format: winston_1.default.format.combine(
      winston_1.default.format.timestamp(),
      winston_1.default.format.errors({ stack: true }),
      winston_1.default.format.json(),
      winston_1.default.format.printf(({ timestamp, level, message, service: svc, ...meta }) => {
        return JSON.stringify({
          timestamp,
          level,
          service: svc || service,
          message,
          ...meta,
        });
      })
    ),
    defaultMeta: { service },
    transports: [
      new winston_1.default.transports.Console({
        format:
          environment === 'development'
            ? winston_1.default.format.combine(
                winston_1.default.format.colorize(),
                winston_1.default.format.simple()
              )
            : winston_1.default.format.json(),
      }),
    ],
  });
  return logger;
}
//# sourceMappingURL=logger.js.map
