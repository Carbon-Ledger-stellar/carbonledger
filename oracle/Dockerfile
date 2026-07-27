# renovate: datasource=docker depName=python versioning=docker
FROM python:3.11-slim@sha256:6d85378d88a19cd4d76079817532d62232be95757cb45945a99fec8e8084b9c2
WORKDIR /app
RUN groupadd -r oracle && useradd -r -g oracle oracle
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN chown -R oracle:oracle /app
USER oracle
EXPOSE 5001
CMD ["python3", "verification_listener.py"]
