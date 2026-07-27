# Oracle Production Deployment Guide

The oracle layer consists of three services:

| Service | Type | File |
|---|---|---|
| `carbonledger-satellite-monitor` | Gunicorn (Flask webhook, port 5001) | `satellite_monitor.py` |
| `carbonledger-verification-listener` | Python scheduler (every 6 h) | `verification_listener.py` |
| `carbonledger-price-oracle` | Python scheduler (every 12 h) | `price_oracle.py` |

---

## Prerequisites

```bash
# Create system user
sudo useradd --system --no-create-home carbonledger

# Create log directory
sudo mkdir -p /var/log/carbonledger
sudo chown carbonledger:carbonledger /var/log/carbonledger

# Deploy code
sudo mkdir -p /opt/carbonledger/oracle
sudo cp -r oracle/* /opt/carbonledger/oracle/
sudo chown -R carbonledger:carbonledger /opt/carbonledger

# Create virtualenv and install dependencies
sudo -u carbonledger python3 -m venv /opt/carbonledger/venv
sudo -u carbonledger /opt/carbonledger/venv/bin/pip install -r /opt/carbonledger/oracle/requirements.txt

# Copy and populate environment file
sudo cp .env.example /opt/carbonledger/.env
sudo chmod 600 /opt/carbonledger/.env
# Edit /opt/carbonledger/.env and fill in all required values
```

## Install systemd Services

```bash
sudo cp oracle/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
```

## Enable and Start

```bash
sudo systemctl enable carbonledger-satellite-monitor
sudo systemctl enable carbonledger-verification-listener
sudo systemctl enable carbonledger-price-oracle

sudo systemctl start carbonledger-satellite-monitor
sudo systemctl start carbonledger-verification-listener
sudo systemctl start carbonledger-price-oracle
```

---

## Service Management

```bash
# Status
sudo systemctl status carbonledger-satellite-monitor
sudo systemctl status carbonledger-verification-listener
sudo systemctl status carbonledger-price-oracle

# Restart
sudo systemctl restart carbonledger-satellite-monitor

# Stop
sudo systemctl stop carbonledger-price-oracle

# Disable autostart
sudo systemctl disable carbonledger-verification-listener
```

## Logs

```bash
# Live log tail
sudo journalctl -u carbonledger-satellite-monitor -f
sudo journalctl -u carbonledger-verification-listener -f
sudo journalctl -u carbonledger-price-oracle -f

# File-based logs (satellite monitor access/error via gunicorn)
tail -f /var/log/carbonledger/satellite_monitor_access.log
tail -f /var/log/carbonledger/satellite_monitor_error.log
tail -f /var/log/carbonledger/verification_listener.log
tail -f /var/log/carbonledger/price_oracle.log
```

## Health Check

```bash
curl http://localhost:5001/health
# Expected: {"status": "ok"}
```

---

## Updating the Oracle

```bash
# Deploy new code
sudo cp -r oracle/* /opt/carbonledger/oracle/
sudo -u carbonledger /opt/carbonledger/venv/bin/pip install -r /opt/carbonledger/oracle/requirements.txt

# Restart all services
sudo systemctl restart carbonledger-satellite-monitor carbonledger-verification-listener carbonledger-price-oracle
```
