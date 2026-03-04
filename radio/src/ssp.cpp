#include "ssp.h"
#include <cstring>
#include <complex>
#include <algorithm>
#include <iostream>
#include <iomanip>
#include <arpa/inet.h>
#include <liquid/liquid.h>

// Encode: struct → 219 bytes (big-endian fields)
std::array<uint8_t, SSPFrame::FRAME_SIZE> SSPCodec::encode(const SSPFrame& frame) {
    std::cerr << "[SSP] DEBUG: encode() called - magic=0x" << std::hex << frame.magic << std::dec
              << ", msg_id=" << frame.msg_id << ", seq=" << static_cast<int>(frame.seq_num)
              << "/" << static_cast<int>(frame.total_frags) << ", payload_len=" << frame.payload_len << "\n";

    std::array<uint8_t, SSPFrame::FRAME_SIZE> data;
    uint8_t* p = data.data();

    // Write header (15 bytes)
    uint32_t magic_be = htonl(frame.magic);
    std::memcpy(p + 0, &magic_be, 4);
    p[4] = frame.version;
    p[5] = frame.flags;

    uint16_t msg_id_be = htons(frame.msg_id);
    std::memcpy(p + 6, &msg_id_be, 2);
    p[8] = frame.seq_num;
    p[9] = frame.total_frags;

    uint16_t payload_len_be = htons(frame.payload_len);
    std::memcpy(p + 10, &payload_len_be, 2);
    p[12] = frame.payload_type;

    uint16_t reserved_be = 0;
    std::memcpy(p + 13, &reserved_be, 2);

    // Copy payload
    std::memcpy(p + SSPFrame::HEADER_SIZE, frame.payload.data(), SSPFrame::PAYLOAD_SIZE);

    std::cerr << "[SSP] DEBUG: encode() SUCCESSFUL - frame_size=" << SSPFrame::FRAME_SIZE << "\n";
    return data;
}

// Decode: 219 bytes → struct (with validation)
bool SSPCodec::decode(const uint8_t* data, size_t len, SSPFrame& frame) {
    std::cerr << "[SSP] DEBUG: decode() called with len=" << len << "\n";

    if (len < SSPFrame::FRAME_SIZE) {
        std::cerr << "[SSP] DEBUG: Insufficient data - len=" << len << " < FRAME_SIZE=" << SSPFrame::FRAME_SIZE << "\n";
        return false;
    }

    const uint8_t* p = data;

    uint32_t magic_be = 0;
    std::memcpy(&magic_be, p + 0, 4);
    frame.magic = ntohl(magic_be);
    std::cerr << "[SSP] DEBUG: Magic=0x" << std::hex << frame.magic << std::dec << "\n";
    if (!validate_magic(frame.magic)) {
        std::cerr << "[SSP] DEBUG: Invalid magic value\n";
        return false;
    }

    frame.version = p[4];
    std::cerr << "[SSP] DEBUG: Version=" << static_cast<int>(frame.version) << "\n";
    if (!validate_version(frame.version)) {
        std::cerr << "[SSP] DEBUG: Invalid version\n";
        return false;
    }

    frame.flags = p[5];

    uint16_t msg_id_be = 0;
    std::memcpy(&msg_id_be, p + 6, 2);
    frame.msg_id = ntohs(msg_id_be);

    frame.seq_num = p[8];
    frame.total_frags = p[9];

    uint16_t payload_len_be = 0;
    std::memcpy(&payload_len_be, p + 10, 2);
    frame.payload_len = ntohs(payload_len_be);
    frame.payload_type = p[12];

    std::cerr << "[SSP] DEBUG: Decoded - msg_id=" << frame.msg_id << ", seq=" << static_cast<int>(frame.seq_num)
              << "/" << static_cast<int>(frame.total_frags) << ", payload_len=" << frame.payload_len << "\n";

    if (frame.payload_len > SSPFrame::PAYLOAD_SIZE) {
        std::cerr << "[SSP] DEBUG: Payload length EXCEEDS max - " << frame.payload_len << " > " << SSPFrame::PAYLOAD_SIZE << "\n";
        return false;
    }

    std::memcpy(frame.payload.data(), p + SSPFrame::HEADER_SIZE, SSPFrame::PAYLOAD_SIZE);

    std::cerr << "[SSP] DEBUG: decode() SUCCESSFUL\n";
    return true;
}

bool SSPCodec::validate_magic(uint32_t magic) {
    return magic == SSPFrame::MAGIC;
}

bool SSPCodec::validate_version(uint8_t version) {
    return version == SSPFrame::VERSION;
}

// FEC using liquid-dsp packetizer: CONV_V27P34 (inner) + RS_M8 (outer) + CRC-32
// API: packetizer (not packetizer_t), packetizer_create/encode/decode/destroy
SSPFEC::SSPFEC() {
    std::cerr << "[SSP] DEBUG: SSPFEC constructor - Creating packetizers\n";
    // Create packetizer for 219-byte SSP frames
    // Sizes are baked in at create time; query enc_msg_len before allocating TX buffers
    std::cerr << "[SSP] DEBUG: Creating TX packetizer (219 bytes, CONV_V27P34 + RS_M8 + CRC-32)\n";
    packetizer_tx = (void*)packetizer_create(219, LIQUID_CRC_32,
                                              LIQUID_FEC_CONV_V27P34,
                                              LIQUID_FEC_RS_M8);
    if (!packetizer_tx) {
        std::cerr << "[SSP] DEBUG: Failed to create TX packetizer\n";
    } else {
        size_t enc_len = packetizer_get_enc_msg_len((packetizer)packetizer_tx);
        std::cerr << "[SSP] DEBUG: TX packetizer created - encoded length=" << enc_len << "\n";
    }

    std::cerr << "[SSP] DEBUG: Creating RX packetizer\n";
    packetizer_rx = (void*)packetizer_create(219, LIQUID_CRC_32,
                                              LIQUID_FEC_CONV_V27P34,
                                              LIQUID_FEC_RS_M8);
    if (!packetizer_rx) {
        std::cerr << "[SSP] DEBUG: Failed to create RX packetizer\n";
    } else {
        size_t enc_len = packetizer_get_enc_msg_len((packetizer)packetizer_rx);
        std::cerr << "[SSP] DEBUG: RX packetizer created - encoded length=" << enc_len << "\n";
    }
    std::cerr << "[SSP] DEBUG: SSPFEC constructor SUCCESSFUL\n";
}

SSPFEC::~SSPFEC() {
    std::cerr << "[SSP] DEBUG: SSPFEC destructor - destroying packetizers\n";
    if (packetizer_tx) packetizer_destroy((packetizer)packetizer_tx);
    if (packetizer_rx) packetizer_destroy((packetizer)packetizer_rx);
    std::cerr << "[SSP] DEBUG: SSPFEC destructor COMPLETE\n";
}

void SSPFEC::encode(const uint8_t* frame, size_t frame_len, uint8_t* output, size_t& output_len) {
    std::cerr << "[SSP] DEBUG: FEC encode() - input_len=" << frame_len << "\n";
    packetizer p = (packetizer)packetizer_tx;
    // packetizer_encode takes no size args — sizes baked in at create time
    packetizer_encode(p, frame, output);
    output_len = packetizer_get_enc_msg_len(p);
    std::cerr << "[SSP] DEBUG: FEC encode() SUCCESSFUL - output_len=" << output_len << "\n";
}

bool SSPFEC::decode(const uint8_t* input, size_t input_len, uint8_t* frame, size_t& frame_len) {
    std::cerr << "[SSP] DEBUG: FEC decode() - input_len=" << input_len << "\n";
    packetizer p = (packetizer)packetizer_rx;
    int ok = packetizer_decode(p, input, frame);
    frame_len = packetizer_get_dec_msg_len(p);
    std::cerr << "[SSP] DEBUG: FEC decode() result=" << (ok == 1 ? "SUCCESS" : "FAILED")
              << ", frame_len=" << frame_len << "\n";
    return ok == 1;
}

size_t SSPFEC::get_enc_msg_len() const {
    return packetizer_get_enc_msg_len((packetizer)packetizer_tx);
}
