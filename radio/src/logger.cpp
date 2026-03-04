#include "logger.h"

// Global logger instance
Logger* g_logger = nullptr;

const char* Logger::level_to_string(LogLevel lvl) {
    switch (lvl) {
        case ERROR:
            return "ERROR";
        case INFO:
            return "INFO";
        case DEBUG:
            return "DEBUG";
        case TRACE:
            return "TRACE";
        default:
            return "UNKNOWN";
    }
}

Logger::Logger(const std::string& log_file, LogLevel initial_level)
    : level(initial_level) {
    file.open(log_file, std::ios::app);
    if (!file.is_open()) {
        std::cerr << "[LOGGER] Warning: Failed to open log file: " << log_file << std::endl;
    }
}

Logger::~Logger() {
    if (file.is_open()) {
        file.close();
    }
}

void Logger::log(LogLevel lvl, const std::string& component, const std::string& msg, const std::string& json_data) {
    std::lock_guard<std::mutex> lock(file_mutex);

    // Get current timestamp in ISO 8601 format
    auto now = std::chrono::system_clock::now();
    auto timestamp = std::chrono::system_clock::to_time_t(now);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()) % 1000;

    // Format timestamp as ISO 8601 with milliseconds
    std::ostringstream oss;
    oss << std::put_time(std::gmtime(&timestamp), "%Y-%m-%dT%H:%M:%S");
    oss << "." << std::setfill('0') << std::setw(3) << ms.count() << "Z";
    std::string ts = oss.str();

    // Build JSON log entry
    std::ostringstream json_entry;
    json_entry << "{"
               << "\"ts\":\"" << ts << "\","
               << "\"level\":\"" << level_to_string(lvl) << "\","
               << "\"component\":\"" << component << "\","
               << "\"msg\":\"" << msg << "\","
               << "\"data\":" << json_data
               << "}\n";

    std::string log_line = json_entry.str();

    // Write to file if open
    if (file.is_open()) {
        file << log_line;
        file.flush();
    }

    // Always write to stderr for container/docker logs
    std::cerr << log_line;
    std::cerr.flush();
}

void Logger::set_level(LogLevel new_level) {
    level = new_level;
    std::ostringstream data;
    data << "{\"new_level\":" << static_cast<int>(new_level) << "}";
    log(INFO, "logger", "Log level changed", data.str());
}
