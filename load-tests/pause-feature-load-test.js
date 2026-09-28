// Load test scenario: 1000 simultaneous pause/unpause queries (#1314)
module.exports = {
  config: {
    target: 'http://localhost:3000',
    phases: [
      { duration: 30, arrivalRate: 35, name: 'Sustained load' }
    ]
  },
  scenarios: [
    {
      name: 'Query Pause Status Under Stress',
      flow: [
        { get: { url: '/health/pause' } },
        { get: { url: '/admin/pause-analytics' } }
      ]
    }
  ]
};
