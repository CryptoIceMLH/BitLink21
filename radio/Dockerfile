# C++ Radio DSP Container
# Builds PlutoSDR/SSP radio module with liquid-dsp, libiio, and ad9361

FROM ubuntu:22.04

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    curl \
    wget \
    pkg-config \
    libfftw3-dev \
    libc6-dev \
    autoconf \
    automake \
    libtool \
    libusb-1.0-0-dev \
    libzstd-dev \
    libavahi-common-dev \
    libavahi-client-dev \
    libxml2-dev \
    flex \
    bison \
    libaio-dev \
    libssl-dev \
    libwebsockets-dev \
    && rm -rf /var/lib/apt/lists/*

# Build and install libfec (Phil Karn's FEC library — required for LIQUID_FEC_RS_M8 + CONV codes)
RUN git clone https://github.com/quiet/libfec.git /tmp/libfec && \
    cd /tmp/libfec && \
    autoreconf -fi && \
    ./configure --prefix=/usr/local && \
    make && make install && \
    ldconfig

# Build and install liquid-dsp (latest v1.7.0 - Feb 2025)
RUN git clone https://github.com/jgaeddert/liquid-dsp.git /tmp/liquid-dsp && \
    cd /tmp/liquid-dsp && \
    ./bootstrap.sh && \
    ./configure --prefix=/usr/local && \
    make && make install && \
    ldconfig && \
    mkdir -p /usr/local/lib/pkgconfig && \
    echo "prefix=/usr/local" > /usr/local/lib/pkgconfig/liquid.pc && \
    echo "exec_prefix=\${prefix}" >> /usr/local/lib/pkgconfig/liquid.pc && \
    echo "libdir=\${exec_prefix}/lib" >> /usr/local/lib/pkgconfig/liquid.pc && \
    echo "includedir=\${prefix}/include" >> /usr/local/lib/pkgconfig/liquid.pc && \
    echo "" >> /usr/local/lib/pkgconfig/liquid.pc && \
    echo "Name: liquid" >> /usr/local/lib/pkgconfig/liquid.pc && \
    echo "Description: liquid DSP library" >> /usr/local/lib/pkgconfig/liquid.pc && \
    echo "Version: 1.7.0" >> /usr/local/lib/pkgconfig/liquid.pc && \
    echo "Libs: -L\${libdir} -lliquid -lm -lfftw3f" >> /usr/local/lib/pkgconfig/liquid.pc && \
    echo "Cflags: -I\${includedir}" >> /usr/local/lib/pkgconfig/liquid.pc

# Build and install libiio (pin to v0.21 — compatible with libad9361-iio-v0)
RUN git clone --branch v0.21 https://github.com/analogdevicesinc/libiio.git /tmp/libiio && \
    cd /tmp/libiio && \
    mkdir -p build && cd build && \
    cmake -DCMAKE_INSTALL_PREFIX=/usr/local .. && \
    make && make install && \
    ldconfig

# Build and install libad9361-iio (pin to v0.3 — compatible with libiio-v0)
# CMAKE_PREFIX_PATH=/usr/local allows find_path(LIBIIO_INCLUDEDIR) to search /usr/local/include
RUN git clone --branch v0.3 https://github.com/analogdevicesinc/libad9361-iio.git /tmp/libad9361-iio && \
    cd /tmp/libad9361-iio && \
    mkdir -p build && cd build && \
    cmake -DCMAKE_INSTALL_PREFIX=/usr/local -DCMAKE_PREFIX_PATH=/usr/local .. && \
    make && make install && \
    ldconfig

# Copy radio source and build
COPY CMakeLists.txt ./
COPY src/ ./src/

RUN mkdir -p build && cd build && \
    PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:$PKG_CONFIG_PATH \
    cmake -DCMAKE_INSTALL_PREFIX=/usr/local -DCMAKE_PREFIX_PATH=/usr/local .. && \
    make

# Create data directory
RUN mkdir -p /app/data

# Set environment variable with fallback
ENV PLUTO_URI=ip:192.168.1.200

# Expose port for WebSocket waterfall FFT
EXPOSE 40134

# Run the compiled radio binary (uses PLUTO_URI from environment)
CMD ./build/bitlink21-radio --log-level 1 --lnb-offset 9750
