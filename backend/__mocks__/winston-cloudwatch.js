/**
 * Manual mock for winston-cloudwatch.
 * Prevents tests from loading the real CloudWatch transport (which imports
 * @aws-sdk/client-cloudwatch-logs and requires real AWS credentials).
 * The mock provides a no-op Transport class that is structurally compatible
 * with what LoggerService expects.
 */
const winston = require('winston');
const Transport = winston.Transport;

class MockCloudWatchTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.name = 'MockCloudWatch';
  }
  log(info, callback) {
    if (callback) callback();
  }
}

module.exports = MockCloudWatchTransport;
module.exports.default = MockCloudWatchTransport;
