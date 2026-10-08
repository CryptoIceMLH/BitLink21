#!/bin/bash
# Startup script for BitLink21 with conditional UHD device support

# Run once here to make sure all new libraries are loaded
ldconfig

# Start system services
echo "Starting D-Bus system daemon..."
mkdir -p /var/run/dbus
rm -f /var/run/dbus/pid
dbus-daemon --system --nofork --nopidfile &
DBUS_PID=$!
sleep 2

# Verify D-Bus is running
if ! ps -p $DBUS_PID > /dev/null; then
    echo "ERROR: D-Bus failed to start"
fi

echo "Starting Avahi mDNS daemon..."
mkdir -p /var/run/avahi-daemon
rm -f /var/run/avahi-daemon/pid
avahi-daemon --no-chroot -D
sleep 3

# Verify Avahi is running
if ! pgrep -x avahi-daemon > /dev/null; then
    echo "ERROR: Avahi daemon failed to start"
    echo "Attempting to start with debug mode..."
    avahi-daemon --no-chroot -D --debug
else
    echo "Avahi daemon started successfully"
fi

# Start SDRplay API service
/opt/sdrplay_api/sdrplay_apiService &
sleep 2

# Configure GNU Radio buffer type (defaults to vmcirc_mmap_tmpfile to prevent shmget exhaustion)
export GR_BUFFER_TYPE=${GR_BUFFER_TYPE:-vmcirc_mmap_tmpfile}
echo "Using GNU Radio buffer type: $GR_BUFFER_TYPE"

# Create GNU Radio config to use mmap-based buffers
mkdir -p /root/.gnuradio
cat > /root/.gnuradio/config.conf << 'EOF'
[vmcircbuf]
default_factory = gr_vmcircbuf_mmap_tmpfile_factory
EOF
echo "Configured GNU Radio to use mmap-based circular buffers"

# Pluto-only build: no UHD/USRP support, so no FPGA image downloads.

# Start the application
echo "Starting BitLink21 application..."
cd /app/backend
exec /app/venv/bin/python app.py --log-level=INFO --host=0.0.0.0 --port=7000
