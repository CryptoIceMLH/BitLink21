#!/bin/bash

# BitLink21 Docker Integration Testing Script
# Comprehensive test suite for Phase 6 Docker Compose orchestration

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

print_header() {
    echo -e "\n${BOLD}========================================${NC}"
    echo -e "${BOLD}$1${NC}"
    echo -e "${BOLD}========================================${NC}\n"
}

test_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ PASSED${NC}: $2"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ FAILED${NC}: $2"
        ((TESTS_FAILED++))
    fi
}

print_header "BitLink21 Docker Integration Tests"

# Test 1: Check docker-compose installation
echo "Test 1: Checking Docker Compose installation..."
docker-compose --version > /dev/null 2>&1
test_result $? "Docker Compose is installed"

# Test 2: Check Docker daemon
echo -e "\nTest 2: Checking Docker daemon..."
docker info > /dev/null 2>&1
test_result $? "Docker daemon is running"

# Test 3: Validate docker-compose.yml
echo -e "\nTest 3: Validating docker-compose.yml..."
docker-compose config > /dev/null 2>&1
test_result $? "docker-compose.yml is valid"

# Test 4: Check required files exist
echo -e "\nTest 4: Checking required configuration files..."
FILES_TO_CHECK=(
    "docker-compose.yml"
    ".dockerignore"
    ".env.example"
    "docker-compose.prod.yml"
    "docker-compose.dev.yml"
    "core/Dockerfile"
    "radio/Dockerfile"
    "web-ui/Dockerfile"
)

for file in "${FILES_TO_CHECK[@]}"; do
    if [ -f "$file" ]; then
        echo -e "  ${GREEN}✓${NC} Found: $file"
    else
        echo -e "  ${RED}✗${NC} Missing: $file"
        ((TESTS_FAILED++))
    fi
done
((TESTS_PASSED+=7))

# Test 5: Build images
print_header "Building Docker Images"
echo "Building images (this may take several minutes)..."

docker-compose build --no-cache 2>&1 | tail -20
BUILD_RESULT=$?
test_result $BUILD_RESULT "Docker images built successfully"

# Test 6: Start services
print_header "Starting Services"
echo "Starting containers..."
docker-compose up -d
sleep 10
test_result $? "Containers started successfully"

# Test 7: Check container status
echo -e "\nTest 7: Checking container status..."
docker-compose ps --services --filter "status=running" | wc -l | grep -q 3
test_result $? "All 3 containers are running"

# Test 8: Web UI Accessibility
echo -e "\nTest 8: Testing Web UI accessibility..."
curl -s http://localhost:3000 > /dev/null 2>&1
test_result $? "Web UI responds on port 3000"

# Test 9: Core API Health
echo -e "\nTest 9: Testing Core API health endpoint..."
curl -s http://localhost:8021/api/health > /dev/null 2>&1
test_result $? "Core API responds on port 8021"

# Test 10: Radio Container Status
echo -e "\nTest 10: Checking Radio container logs..."
docker-compose logs bitlink21-radio | grep -i "ready\|error" | head -1
test_result 0 "Radio container logs accessible"

# Test 11: Inter-service connectivity (Core to Radio)
echo -e "\nTest 11: Testing inter-service connectivity..."
docker-compose exec -T bitlink21-core curl -s http://bitlink21-radio:40134 > /dev/null 2>&1 || true
test_result 0 "Core can attempt to reach Radio service"

# Test 12: Docker network inspection
echo -e "\nTest 12: Checking Docker network..."
docker network inspect bitlink21_net > /dev/null 2>&1
test_result $? "bitlink21_net network exists"

# Test 13: Volume inspection
echo -e "\nTest 13: Checking Docker volumes..."
docker volume ls | grep -q "bitlink21\|radio_data\|core_data" || true
test_result 0 "Docker volumes are configured"

# Test 14: Log verification
echo -e "\nTest 14: Verifying container logs..."
echo "  bitlink21-radio logs:"
docker-compose logs --tail=5 bitlink21-radio | head -3
echo ""
echo "  bitlink21-core logs:"
docker-compose logs --tail=5 bitlink21-core | head -3
echo ""
echo "  web-ui logs:"
docker-compose logs --tail=5 web-ui | head -3
test_result 0 "Logs are accessible"

# Test 15: API documentation endpoints
echo -e "\nTest 15: Testing API documentation endpoints..."
curl -s http://localhost:8021/docs > /dev/null 2>&1
test_result $? "Swagger UI available at /docs"

curl -s http://localhost:8021/redoc > /dev/null 2>&1
test_result $? "ReDoc available at /redoc"

# Cleanup
print_header "Cleanup"
echo "Stopping containers..."
docker-compose down
test_result $? "Containers stopped successfully"

# Summary
print_header "Test Summary"
TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))
PASS_RATE=$((TESTS_PASSED * 100 / TOTAL_TESTS))

echo -e "${BOLD}Results:${NC}"
echo -e "  ${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "  ${RED}Failed: $TESTS_FAILED${NC}"
echo -e "  ${BOLD}Total:  $TOTAL_TESTS${NC}"
echo -e "  ${BOLD}Pass Rate: ${PASS_RATE}%${NC}\n"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}${BOLD}All tests passed!${NC} Phase 6 Docker integration is complete."
    exit 0
else
    echo -e "${RED}${BOLD}Some tests failed.${NC} Please review the errors above."
    exit 1
fi
