#pragma once

#include <string>
#include <fstream>
#include <sstream>
#include <chrono>
#include <iostream>
#include <mutex>
#include <iomanip>

enum LogLevel {
    ERROR = 0,
    INFO = 1,
    DEBUG = 2,
    TRACE = 3
};

class Logger {
private:
    std::ofstream file;
    LogLevel level;
    std::mutex file_mutex;

    static const char* level_to_string(LogLevel lvl);

public:
    Logger(const std::string& log_file, LogLevel initial_level = INFO);
    ~Logger();

    void log(LogLevel lvl, const std::string& component, const std::string& msg, const std::string& json_data = "{}");
    void set_level(LogLevel new_level);
    LogLevel get_level() const { return level; }
};

extern Logger* g_logger;

// Macros for convenient logging with automatic level checks
#define LOG_ERROR(comp, msg, data) \
    do { if(g_logger) g_logger->log(ERROR, comp, msg, data); } while(0)

#define LOG_INFO(comp, msg, data) \
    do { if(g_logger && g_logger->get_level() >= INFO) g_logger->log(INFO, comp, msg, data); } while(0)

#define LOG_DEBUG(comp, msg, data) \
    do { if(g_logger && g_logger->get_level() >= DEBUG) g_logger->log(DEBUG, comp, msg, data); } while(0)

#define LOG_TRACE(comp, msg, data) \
    do { if(g_logger && g_logger->get_level() >= TRACE) g_logger->log(TRACE, comp, msg, data); } while(0)
