# BitLink21 v4.0.0 — Bitcoin Decentralized Communication System
# Forked from Ground Station (sgoudelis/ground-station)
# Adds: PlutoSDR TX+RX (pyadi-iio), HSModem-compatible satellite modem with
#        QO-100 beacon lock, Bitcoin TX relay, Lightning invoice relay

# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package.json frontend/package-lock.json* ./

# Install frontend dependencies
RUN npm ci

# Copy frontend source code
COPY frontend/ ./

# copy the .env template
RUN cp .env.production .env

# Build the frontend for production
RUN npm run build

# Stage 2: Set up the Python backend
FROM ubuntu:noble-20250925

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    git \
    build-essential \
    sudo \
    python3 \
    python3-dev \
    python3.12 \
    python3.12-venv \
    python3.12-dev \
    python3-pip \
    dh-autoreconf \
    python3-full \
    software-properties-common \
    librtlsdr-dev \
    libairspy-dev \
    libhackrf-dev \
    libboost-all-dev \
    swig \
    avahi-daemon \
    libavahi-client-dev \
    cmake g++ libpython3-dev python3-numpy \
    avahi-daemon \
    avahi-utils \
    libnss-mdns \
    dbus \
    gpg-agent \
    libsamplerate0-dev \
    python3-mako \
    python3-requests \
    libfftw3-dev \
    libsqlite3-dev \
    pkg-config \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Create required directories for Avahi and D-Bus
RUN mkdir -p /var/run/avahi-daemon /var/run/dbus

RUN ln -sf /usr/bin/python3 /usr/bin/python

# Copy backend requirements
COPY backend/requirements.txt .

# Install numpy 2.3.1 system-wide (the GNU Radio build uses it)
RUN pip install --break-system-packages --ignore-installed numpy==2.3.1

# Pluto-only build: UHD/USRP support removed.

RUN python3 -m venv /app/venv
ENV VIRTUAL_ENV=/app/venv
ENV PATH="/app/venv/bin:$PATH"

WORKDIR /app

# Now pip will use the virtual environment
RUN /app/venv/bin/python -m pip install --upgrade pip setuptools
RUN /app/venv/bin/python -m pip install --no-cache-dir -r requirements.txt
RUN /app/venv/bin/python -m pip install --no-cache-dir --force-reinstall --no-deps "setuptools>=80.9.0,<81"
RUN /app/venv/bin/python - <<'PY'
import pkg_resources
print(pkg_resources.__file__)
PY

# Pluto-only build: SoapySDR + RTL-SDR/Airspy/UHD/HackRF/HydraSDR/SDRplay modules and LimeSuite are not built.

# compile Hamlib
# WORKDIR /src
# RUN git clone https://github.com/Hamlib/Hamlib.git && \
#     cd Hamlib && \
#     ./bootstrap && \
#     ./configure --with-python-binding && \
#     make -j$(nproc) && \
#     sudo make install -j$(nproc)

# compile csdr
# WORKDIR /src
# RUN git clone https://github.com/jketterl/csdr.git && \
#     cd csdr && \
#     mkdir build && \
#     cd build && \
#     cmake .. && \
#     make -j$(nproc) && \
#     make install -j$(nproc) && \
#     ldconfig

# compile pycsdr
# WORKDIR /src
# RUN git clone https://github.com/jketterl/csdr.git && \
#     cd pycsdr && \
#     ./setup.py install install_headers

# Install additional dependencies for GNU Radio and SatDump
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgmp-dev \
    libmpfr-dev \
    libqt5widgets5 \
    libqt5opengl5 \
    libqwt-qt5-dev \
    liblog4cpp5-dev \
    libspdlog-dev \
    libfmt-dev \
    python3-packaging \
    pybind11-dev \
    python3-pybind11 \
    libzmq3-dev \
    python3-zmq \
    libpng-dev \
    libjpeg-dev \
    zlib1g-dev \
    libcurl4-openssl-dev \
    libzstd-dev \
    libtiff-dev \
    libjemalloc-dev \
    libairspyhf-dev \
    libad9361-dev \
    libiio-dev \
    libbladerf-dev \
    libomp-dev \
    libvolk-dev \
    libnng-dev \
    libhdf5-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages needed for GNU Radio in the venv
RUN pip install packaging pybind11 pyzmq

# Reinstall numpy in the venv (was installed with --break-system-packages earlier)
RUN pip install --force-reinstall numpy==2.3.1

# IMPORTANT: We maintain TWO versions of VOLK in this container:
# 1. System libvolk-dev (3.1.0) installed via apt -> used by SatDump
# 2. VOLK 3.2 compiled from source -> used by GNU Radio
#
# Reason: VOLK 3.2 introduced c1/c2 variables in volk_common.h that conflict with
# SatDump's calibration.h macros (Planck constants). Installing VOLK 3.2 to /opt/volk
# keeps it isolated for GNU Radio while SatDump uses the older system version without conflicts.

# Compile VOLK (Vector-Optimized Library of Kernels) - required by GNU Radio
# Install to /opt/volk to avoid conflicts with system libvolk-dev used by SatDump
WORKDIR /src
RUN git clone --depth=1 --recursive https://github.com/gnuradio/volk.git && \
    cd volk && \
    mkdir build && \
    cd build && \
    cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/volk .. && \
    make -j$(nproc) && \
    sudo make install -j$(nproc) && \
    echo "/opt/volk/lib" > /etc/ld.so.conf.d/volk.conf && \
    sudo ldconfig

# Compile cppzmq (C++ bindings for ZeroMQ) - required by GNU Radio gr-zeromq
WORKDIR /src
RUN git clone --depth=1 https://github.com/zeromq/cppzmq.git && \
    cd cppzmq && \
    mkdir build && \
    cd build && \
    cmake .. && \
    sudo make install -j$(nproc)

# Compile GNU Radio 3.10 (using VOLK from /opt/volk)
WORKDIR /src
RUN git clone --depth=1 --branch=maint-3.10 --recursive https://github.com/gnuradio/gnuradio.git && \
    cd gnuradio && \
    mkdir build && \
    cd build && \
    cmake -DCMAKE_BUILD_TYPE=Release \
          -DENABLE_PYTHON=ON \
          -DENABLE_GR_QTGUI=OFF \
          -DENABLE_TESTING=OFF \
          -DENABLE_GR_ZEROMQ=ON \
          -DPython3_EXECUTABLE=/app/venv/bin/python3 \
          -DPYTHON_EXECUTABLE=/app/venv/bin/python3 \
          -DCMAKE_PREFIX_PATH=/opt/volk \
          .. && \
    make -j$(nproc) && \
    sudo make install -j$(nproc) && \
    sudo ldconfig

# Copy GNU Radio Python bindings to virtual environment
RUN cp -r /usr/local/lib/python3.12/site-packages/gnuradio* /app/venv/lib/python3.12/site-packages/ || true
RUN cp -r /usr/local/lib/python3.12/site-packages/pmt* /app/venv/lib/python3.12/site-packages/ || true

# Compile gr-lora_sdr
WORKDIR /src
RUN git clone --depth=1 https://github.com/tapparelj/gr-lora_sdr.git && \
    cd gr-lora_sdr && \
    mkdir build && \
    cd build && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then LIB_ARCH="x86_64-linux-gnu"; \
    elif [ "$ARCH" = "aarch64" ]; then LIB_ARCH="aarch64-linux-gnu"; \
    else LIB_ARCH="$ARCH-linux-gnu"; fi && \
    cmake -DCMAKE_INSTALL_PREFIX=/usr/local \
          -DPYTHON_EXECUTABLE=/app/venv/bin/python3 \
          -DPYTHON_INCLUDE_DIR=/usr/include/python3.12 \
          -DPYTHON_LIBRARY=/usr/lib/$LIB_ARCH/libpython3.12.so .. && \
    make -j$(nproc) && \
    sudo make install -j$(nproc) && \
    sudo ldconfig

# Copy gr-lora_sdr Python bindings to virtual environment (it installs as a subdirectory of gnuradio)
RUN cp -r /usr/local/lib/python3.12/site-packages/gnuradio/lora_sdr /app/venv/lib/python3.12/site-packages/gnuradio/ 2>/dev/null || \
    cp -r /usr/local/lib/python3/dist-packages/gnuradio/lora_sdr /app/venv/lib/python3.12/site-packages/gnuradio/ 2>/dev/null || \
    echo "Warning: Could not find lora_sdr Python bindings"

# Compile gr-satellites
WORKDIR /src
RUN git clone --depth=1 https://github.com/daniestevez/gr-satellites.git && \
    cd gr-satellites && \
    mkdir build && \
    cd build && \
    cmake -DCMAKE_INSTALL_PREFIX=/usr/local \
          -DPYTHON_EXECUTABLE=/app/venv/bin/python3 \
          -DGR_PYTHON_DIR=/app/venv/lib/python3.12/site-packages \
          -DPYTHON_INCLUDE_DIR=/usr/include/python3.12 \
          -DPYTHON_LIBRARY=/usr/lib/x86_64-linux-gnu/libpython3.12.so .. && \
    make -j$(nproc) && \
    sudo make install -j$(nproc) && \
    sudo ldconfig

# Verify gr-satellites Python module installation (including satyaml)
RUN /app/venv/bin/python3 -c "from satellites.satyaml.satyaml import SatYAML; print('✓ gr-satellites satyaml module available')" || \
    (echo "ERROR: satyaml not properly installed!" && exit 1)

# Compile gr-dvbs2rx (DVB-S2 receiver for BitLink21's experimental wideband
# link; its dvbs2-rx app takes IQ on stdin and outputs MPEG-TS on stdout)
WORKDIR /src
ARG DVBS2RX_REF=master
RUN apt-get update && apt-get install -y --no-install-recommends libgmp-dev && rm -rf /var/lib/apt/lists/* && \
    git clone --depth=1 --branch=${DVBS2RX_REF} --recursive --shallow-submodules https://github.com/igorauad/gr-dvbs2rx.git && \
    cd gr-dvbs2rx && \
    mkdir build && \
    cd build && \
    cmake -DCMAKE_BUILD_TYPE=Release \
          -DENABLE_DOXYGEN=OFF \
          -DCMAKE_INSTALL_PREFIX=/usr/local \
          -DPYTHON_EXECUTABLE=/app/venv/bin/python3 \
          -DGR_PYTHON_DIR=/app/venv/lib/python3.12/site-packages \
          -DPYTHON_INCLUDE_DIR=/usr/include/python3.12 \
          -DPYTHON_LIBRARY=/usr/lib/x86_64-linux-gnu/libpython3.12.so .. && \
    make -j$(nproc) && \
    sudo make install && \
    sudo ldconfig
# dvbs2-rx imports PyQt5 (GUI) and gr-uhd (USRP) at the top, but uses them
# only with --gui / --source usrp. This image has neither (GNU Radio is built
# without Qt GUI, no UHD), so make both imports optional for headless use.
RUN sed -i \
      -e 's/^from PyQt5 import Qt, QtCore$/try:\n    from PyQt5 import Qt, QtCore\nexcept ImportError:  # headless\n    class Qt:\n        QWidget = object\n    QtCore = None/' \
      -e 's/^    import sip$/    sip = None/' \
      -e 's/^from gnuradio import analog, blocks, digital, dvbs2rx, eng_notation, gr, uhd$/from gnuradio import analog, blocks, digital, dvbs2rx, eng_notation, gr\ntry:\n    from gnuradio import uhd\nexcept ImportError:  # no UHD in this image\n    uhd = None/' \
      /usr/local/bin/dvbs2-rx && \
    grep -q "except ImportError:  # headless" /usr/local/bin/dvbs2-rx && \
    grep -q "uhd = None" /usr/local/bin/dvbs2-rx
RUN /app/venv/bin/python3 -c "import gnuradio.dvbs2rx, gnuradio.dtv; print('gr-dvbs2rx + gr-dtv available')" && \
    /app/venv/bin/python3 /usr/local/bin/dvbs2-rx --help > /dev/null && echo "dvbs2-rx runs"

# Compile SatDump (without GUI, using system libvolk-dev and libnng-dev)
# Pin to a specific commit to avoid upstream CLI/behavior changes breaking decoding.
WORKDIR /src
ARG SATDUMP_COMMIT=7aef0fe8441bc3eb440b1b6ba053556da5e40991
RUN git clone --depth=1 https://github.com/SatDump/SatDump.git && \
    cd SatDump && \
    git fetch --depth=1 origin ${SATDUMP_COMMIT} && \
    git checkout ${SATDUMP_COMMIT} && \
    mkdir build && \
    cd build && \
    cmake -DCMAKE_BUILD_TYPE=Release \
          -DBUILD_GUI=OFF \
          -DCMAKE_INSTALL_PREFIX=/usr \
          -DPLUGIN_AARONIA_SDR_SUPPORT=OFF \
          -DPLUGIN_OFFICIAL_PRODUCTS=ON \
          .. && \
    make -j$(nproc) && \
    sudo make install && \
    sudo ldconfig

# Configure library paths and copy Python bindings
RUN echo "/usr/local/lib" > /etc/ld.so.conf.d/local.conf && \
    ldconfig
    # mkdir -p "/app/venv/lib/python3.12/site-packages/Hamlib/" && \
    # cp /usr/local/lib/python3.12/site-packages/*Hamlib* /app/venv/lib/python3.12/site-packages/Hamlib && \

# Install pyadi-iio for PlutoSDR TX+RX support (uses libiio already installed above)
# Pin: pylibiio 1.x (pulled by pyadi-iio>=0.0.21) requires libiio 1.x, but
# Ubuntu ships libiio 0.25 -> import adi fails. Keep bindings matched to 0.25.
RUN pip install "pyadi-iio==0.0.19" "pylibiio==0.25"

# Install BitLink21 extras (QR codes for Lightning invoices)
RUN pip install qrcode>=7.4.2

# Remove all that source code
RUN rm -rf /src

# Remove build tools to save space
RUN apt-get remove -y --purge \
    build-essential \
    cmake \
    gcc \
    g++ \
    git \
    wget \
    dh-autoreconf \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend code
COPY backend/ ./backend/

# Copy and set permissions for startup script
COPY backend/startup.sh /app/startup.sh
RUN chmod +x /app/startup.sh

# Copy the built frontend from the previous stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy package.json for library version info
COPY --from=frontend-builder /app/frontend/package.json ./frontend/package.json

# Add build arguments for version information (moved here to maximize cache reuse)
ARG GIT_COMMIT
ARG BUILD_DATE
ARG BUILD_VERSION
ARG GS_ENVIRONMENT=production

# Set as environment variables for the container
ENV GIT_COMMIT=${GIT_COMMIT}
ENV BUILD_DATE=${BUILD_DATE}
ENV BUILD_VERSION=${BUILD_VERSION}
ENV GS_ENVIRONMENT=${GS_ENVIRONMENT}

# Run the version info file creation utility with an override, the git commit hash
RUN cd /app/backend && python -c "import os; from server.version import write_version_info_during_build; write_version_info_during_build({'gitCommit': os.environ.get('GIT_COMMIT', 'unknown')})"

# Configure backend to serve static files
# Create a volume for persistent data (database, recordings, snapshots, received files)
VOLUME /app/backend/data

# Set environment variables
ENV PYTHONPATH=/app
ENV STATIC_FILES_DIR=/app/frontend/dist
# Configure GNU Radio to use mmap-based buffers to prevent shared memory exhaustion
ENV GR_BUFFER_TYPE=vmcirc_mmap_tmpfile

# Expose the port the app runs on
EXPOSE 7000

# Configure Avahi for Docker mDNS (done late to preserve build cache)
RUN sed -i 's/#enable-reflector=no/enable-reflector=yes/' /etc/avahi/avahi-daemon.conf && \
    sed -i 's/#reflect-ipv=no/reflect-ipv=yes/' /etc/avahi/avahi-daemon.conf && \
    sed -i 's/use-ipv6=yes/use-ipv6=no/' /etc/avahi/avahi-daemon.conf

WORKDIR backend/

# Start the application
CMD ["/app/startup.sh"]
