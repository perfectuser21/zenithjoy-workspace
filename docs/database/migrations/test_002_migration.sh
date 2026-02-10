#!/bin/bash
# ============================================
# Test Script for Migration 002
# ============================================

set -e  # 遇到错误立即退出

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 Testing Migration 002: Create Works Tables"
echo "============================================"
echo ""

# 配置
DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-cecelia}"
MIGRATION_FILE="docs/database/migrations/002_create_works_tables.sql"

# 检查文件存在
if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}❌ Migration file not found: $MIGRATION_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Migration file exists"

# 测试 1: SQL 执行
echo ""
echo "📝 Test 1: Execute Migration"
echo "-----------------------------"

if psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
    --echo-errors \
    --set ON_ERROR_STOP=on \
    -f "$MIGRATION_FILE" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Migration executed successfully"
else
    echo -e "${RED}❌ Migration execution failed${NC}"
    exit 1
fi

# 测试 2: 验证表创建
echo ""
echo "📊 Test 2: Verify Tables Created"
echo "---------------------------------"

for table in "works" "publish_logs" "field_definitions"; do
    if psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
        -t -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'zenithjoy' AND table_name = '$table');" \
        | grep -q 't'; then
        echo -e "${GREEN}✓${NC} zenithjoy.$table table exists"
    else
        echo -e "${RED}❌ zenithjoy.$table table NOT found${NC}"
        exit 1
    fi
done

# 测试 3: 验证关键字段
echo ""
echo "🔍 Test 3: Verify Key Columns"
echo "------------------------------"

for col in "id" "title" "custom_fields"; do
    if psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
        -t -c "SELECT column_name FROM information_schema.columns WHERE table_schema = 'zenithjoy' AND table_name = 'works' AND column_name = '$col';" \
        | grep -q "$col"; then
        echo -e "${GREEN}✓${NC} works.$col exists"
    else
        echo -e "${RED}❌ works.$col NOT found${NC}"
        exit 1
    fi
done

# 测试 4: 验证 JSONB 类型
echo ""
echo "📦 Test 4: Verify JSONB Type"
echo "-----------------------------"

if psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT data_type FROM information_schema.columns WHERE table_schema = 'zenithjoy' AND table_name = 'works' AND column_name = 'custom_fields';" \
    | grep -q 'jsonb'; then
    echo -e "${GREEN}✓${NC} custom_fields is JSONB"
else
    echo -e "${RED}❌ custom_fields is NOT JSONB${NC}"
    exit 1
fi

# 测试 5: 验证外键
echo ""
echo "🔗 Test 5: Verify Foreign Key"
echo "-------------------------------"

FK_COUNT=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = 'zenithjoy' AND table_name = 'publish_logs' AND constraint_type = 'FOREIGN KEY';" \
    | tr -d ' ')

if [ "$FK_COUNT" -ge 1 ]; then
    echo -e "${GREEN}✓${NC} Foreign key exists"
else
    echo -e "${RED}❌ No foreign key found${NC}"
    exit 1
fi

# 测试 6: 验证预设数据
echo ""
echo "📋 Test 6: Verify Default Data"
echo "-------------------------------"

FIELD_COUNT=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "SELECT COUNT(*) FROM zenithjoy.field_definitions;" \
    | tr -d ' ')

if [ "$FIELD_COUNT" -ge 4 ]; then
    echo -e "${GREEN}✓${NC} Default fields inserted ($FIELD_COUNT fields)"
else
    echo -e "${RED}❌ Expected 4+ fields, found $FIELD_COUNT${NC}"
    exit 1
fi

# 测试 7: 插入测试数据
echo ""
echo "✏️  Test 7: Test Data Insertion"
echo "--------------------------------"

TEST_ID=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
    -t -c "INSERT INTO zenithjoy.works (title, content_type) VALUES ('Test', 'text') RETURNING id;" \
    | tr -d ' ')

if [ -n "$TEST_ID" ]; then
    echo -e "${GREEN}✓${NC} Test work inserted"
    psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
        -c "DELETE FROM zenithjoy.works WHERE id = '$TEST_ID';" > /dev/null 2>&1
    echo -e "${GREEN}✓${NC} Test data cleaned"
else
    echo -e "${RED}❌ Failed to insert test work${NC}"
    exit 1
fi

# 总结
echo ""
echo "============================================"
echo -e "${GREEN}✅ All tests passed!${NC}"
echo "============================================"

exit 0
