#pragma once
#include <cstdint>
#include <cstring>
#include <array>

// SSP Frame structure (Satoshi Signal Protocol)
struct SSPFrame {
    static constexpr uint32_t MAGIC = 0x53535021;  // "SSP!"
    static constexpr uint8_t VERSION = 0x01;
    static constexpr size_t HEADER_SIZE = 15;
    static constexpr size_t PAYLOAD_SIZE = 204;
    static constexpr size_t FRAME_SIZE = 219;

    // Header fields
    uint32_t magic;         // offset 0
    uint8_t version;        // offset 4
    uint8_t flags;          // offset 5
    uint16_t msg_id;        // offset 6
    uint8_t seq_num;        // offset 8
    uint8_t total_frags;    // offset 9
    uint16_t payload_len;   // offset 10
    uint8_t payload_type;   // offset 12
    uint16_t reserved;      // offset 13

    // Payload
    std::array<uint8_t, PAYLOAD_SIZE> payload;  // offset 15

    // Flags bitfield
    bool is_encrypted() const { return (flags & 0x01) != 0; }
    bool is_broadcast() const { return (flags & 0x02) != 0; }
    void set_encrypted(bool v) { flags = (flags & 0xFE) | (v ? 1 : 0); }
    void set_broadcast(bool v) { flags = (flags & 0xFD) | (v ? 2 : 0); }
};

// Encoder/Decoder
class SSPCodec {
public:
    // Encode: struct → raw 219 bytes
    static std::array<uint8_t, SSPFrame::FRAME_SIZE> encode(const SSPFrame& frame);

    // Decode: raw 219 bytes → struct (with validation)
    static bool decode(const uint8_t* data, size_t len, SSPFrame& frame);

    // Validation
    static bool validate_magic(uint32_t magic);
    static bool validate_version(uint8_t version);
};

// FEC Wrapper (liquid-dsp packetizer with CONV_V27P34 + RS_M8)
class SSPFEC {
public:
    SSPFEC();
    ~SSPFEC();

    // Encode: raw frame → FEC-encoded output
    void encode(const uint8_t* frame, size_t frame_len, uint8_t* output, size_t& output_len);

    // Decode: FEC-encoded input → raw frame (with error correction)
    bool decode(const uint8_t* input, size_t input_len, uint8_t* frame, size_t& frame_len);

    // Query encoded output size (for TX buffer allocation)
    size_t get_enc_msg_len() const;

private:
    void* packetizer_tx;  // opaque pointer to packetizer
    void* packetizer_rx;  // opaque pointer to depacketizer
};
