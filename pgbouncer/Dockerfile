FROM edoburu/pgbouncer:latest

# Copy configuration files
COPY pgbouncer.ini  /etc/pgbouncer/pgbouncer.ini
COPY userlist.txt   /etc/pgbouncer/userlist.txt

# Ensure correct file permissions (pgbouncer user needs read access)
RUN chmod 640 /etc/pgbouncer/userlist.txt
