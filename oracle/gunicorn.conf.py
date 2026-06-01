import multiprocessing

# Workers: 2-4 × CPU cores is standard for I/O-bound webhook services
workers = multiprocessing.cpu_count() * 2 + 1
worker_class = "sync"
timeout = 120          # satellite webhook calls Stellar RPC — allow up to 2 min
keepalive = 5

bind = "0.0.0.0:5001"

# Logging
accesslog = "/var/log/carbonledger/satellite_monitor_access.log"
errorlog  = "/var/log/carbonledger/satellite_monitor_error.log"
loglevel  = "info"

# Process naming
proc_name = "carbonledger-satellite-monitor"

# Graceful restart
graceful_timeout = 30
