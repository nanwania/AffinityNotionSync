# VC Sync Tool v2.0

> **Enterprise-grade bidirectional sync between Affinity CRM and Notion Database for venture capital organizations**

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/yourorg/vc-sync-tool/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)

## 🚀 What's New in v2.0

- **⚡ Real-time Syncing** with webhook integration
- **🔄 Bulk Operations** for efficient conflict resolution
- **📊 Performance Monitoring** and health scoring
- **🛡️ Data Quality Validation** with automatic sanitization
- **🎯 Smart Conflict Resolution** with auto-resolution capabilities
- **📈 3-5x Performance Improvement** through optimized processing

## 🎯 Overview

The VC Sync Tool eliminates manual data entry between your Affinity CRM and Notion databases, ensuring your investment pipeline stays perfectly synchronized across platforms. Built specifically for venture capital workflows, it handles complex deal data, organization relationships, and team collaboration requirements.

### Key Benefits

- **Save 10+ hours/week** on manual data entry
- **Eliminate data inconsistencies** between systems
- **Real-time updates** when deals progress in either platform
- **Advanced conflict resolution** for team collaboration
- **Enterprise-grade monitoring** and reliability

## ✨ Features

### 🔄 Bidirectional Sync
- **Real-time synchronization** via webhooks
- **Scheduled syncing** with configurable intervals
- **Selective field mapping** - sync only what you need
- **Status filtering** - sync specific deal stages
- **Organization data** - full company information sync

### 🎛️ Advanced Conflict Resolution
- **Smart auto-resolution** based on timestamps and sync direction
- **Bulk conflict management** - resolve 100+ conflicts at once
- **Priority scoring** - critical fields get attention first
- **Side-by-side comparison** for informed decisions
- **Confidence scoring** for automatic resolutions

### 📊 Monitoring & Analytics
- **Real-time health dashboard** with 0-100 health scores
- **Performance metrics** - track sync speed and reliability
- **Data quality reports** with improvement recommendations
- **Automated alerts** for failures and anomalies
- **Comprehensive audit trail** of all sync operations

### 🛡️ Data Quality & Validation
- **Field validation** - emails, URLs, phone numbers, dates
- **Data sanitization** - automatic format correction
- **Type compatibility checking** between Affinity and Notion
- **Quality scoring** with actionable recommendations
- **Format suggestions** for optimal field mapping

### ⚡ Performance & Reliability
- **Rate limiting** prevents API quota violations
- **Exponential backoff** retry logic for failed operations
- **Batch processing** - 5x faster than sequential operations
- **Connection pooling** for optimal database performance
- **Automatic cleanup** of old data and logs

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Affinity CRM  │    │   VC Sync Tool  │    │ Notion Database │
│                 │◄──►│                 │◄──►│                 │
│ • Deals/Opps    │    │ • Field Mapping │    │ • Pipeline DB   │
│ • Organizations │    │ • Conflict Res. │    │ • Deal Tracking │
│ • People        │    │ • Monitoring    │    │ • Team Views    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                               │
                    ┌─────────────────┐
                    │   PostgreSQL    │
                    │                 │
                    │ • Sync History  │
                    │ • Conflict Log  │
                    │ • Performance   │
                    │ • Health Scores │
                    └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm/yarn
- PostgreSQL 13+
- Affinity CRM API access
- Notion integration token

### 1. Installation

```bash
git clone https://github.com/yourorg/vc-sync-tool.git
cd vc-sync-tool
npm install
```

### 2. Database Setup

```bash
# Create database
createdb vc_sync_tool

# Run migrations
psql vc_sync_tool < database/migrations/001_initial_schema.sql
psql vc_sync_tool < database/migrations/002_enhanced_features.sql
```

### 3. Environment Configuration

```bash
cp .env.example .env
```

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/vc_sync_tool

# Affinity API
AFFINITY_API_KEY=your_affinity_api_key

# Notion API
NOTION_INTEGRATION_SECRET=your_notion_integration_token
NOTION_PAGE_URL=https://notion.so/your-page

# Webhooks (Optional - for real-time sync)
AFFINITY_WEBHOOK_SECRET=your_webhook_secret
NOTION_WEBHOOK_URL=your_notion_webhook_url

# Performance (Optional)
RATE_LIMIT_CALLS_PER_SECOND=3
MAX_SYNC_DURATION=300000
```

### 4. Start the Application

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

Visit `http://localhost:5000` to access the dashboard.

## 📖 Usage Guide

### Setting Up Your First Sync Pair

1. **Navigate to Dashboard** - Access the web interface
2. **Create Sync Pair** - Connect an Affinity list to a Notion database
3. **Configure Field Mapping** - Map fields between systems
4. **Set Sync Direction** - Choose bidirectional, or one-way sync
5. **Enable & Monitor** - Activate sync and monitor via health dashboard

### Field Mapping Best Practices

```typescript
// Example field mappings for deal pipeline
{
  "Deal Name": "title",           // Notion title field
  "Stage": "select",              // Dropdown → Select
  "Amount": "number",             // Currency → Number
  "Close Date": "date",           // Date → Date
  "Organization": "relation",     // Company → Relation
  "Description": "rich_text"      // Text → Rich Text
}
```

### Webhook Setup (Real-time Sync)

#### Affinity Webhook
```bash
curl -X POST "https://api.affinity.co/webhooks" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/webhooks/affinity",
    "events": ["list_entry.updated", "list_entry.created"]
  }'
```

#### Notion Webhook
Set up in your Notion integration settings:
- **URL**: `https://your-domain.com/webhooks/notion`
- **Events**: `page.updated`, `database.updated`

## 🔧 API Reference

### Health & Monitoring

```bash
# System health check
GET /api/health

# Performance metrics
GET /api/metrics

# Sync pair health summary
GET /api/sync-pairs/{id}/health
```

### Sync Operations

```bash
# Trigger manual sync
POST /api/sync-pairs/{id}/sync

# Preview changes (dry run)
POST /api/sync-pairs/{id}/preview

# Bulk sync operations
POST /api/sync-pairs/bulk-action
{
  "action": "sync|activate|deactivate",
  "syncPairIds": [1, 2, 3]
}
```

### Conflict Resolution

```bash
# Get pending conflicts
GET /api/conflicts/pending

# Resolve single conflict
POST /api/conflicts/{id}/resolve
{
  "resolution": "affinity|notion"
}

# Bulk conflict resolution
POST /api/conflicts/bulk-resolve
{
  "conflictIds": [1, 2, 3],
  "resolution": "affinity|notion"
}
```

### Data Quality

```bash
# Get data quality report
GET /api/sync-pairs/{id}/quality-report

# Field validation
POST /api/validation/field-mapping
{
  "affinityField": {...},
  "notionPropertyType": "select"
}
```

## 🎛️ Configuration

### Sync Pair Settings

```typescript
interface SyncPairConfig {
  name: string;
  syncDirection: 'bidirectional' | 'affinity-to-notion' | 'notion-to-affinity';
  syncFrequency: number;           // minutes
  statusFilters: string[];         // Affinity statuses to sync
  autoResolveConflicts: boolean;   // Auto-resolve based on timestamps
  dataQualityThreshold: number;    // 0-1, minimum quality score
  webhookEnabled: boolean;         // Enable real-time sync
  priority: number;                // 1-5, higher = more frequent sync
}
```

### Field Mapping Schema

```typescript
interface FieldMapping {
  affinityField: string;           // Affinity field name
  affinityFieldId: number;         // Affinity field ID
  affinityFieldType: string;       // 'text', 'dropdown', 'number', etc.
  notionProperty: string;          // Notion property name
  notionPropertyType: string;      // 'rich_text', 'select', 'number', etc.
  transformationRules?: object;    // Optional field transformations
}
```

## 📊 Monitoring & Alerts

### Health Scoring

Each sync pair gets a health score (0-100) based on:
- **Success Rate** (40 points) - Recent sync success percentage
- **Performance** (30 points) - Average sync duration
- **Data Quality** (20 points) - Field validation scores
- **Conflicts** (10 points penalty) - Unresolved conflicts

### Alert Types

- 🔴 **Critical**: Sync failures, API errors, high-priority conflicts
- 🟡 **Warning**: Performance issues, data quality concerns
- 🔵 **Info**: Unusual activity, large data changes

### Custom Notifications

```typescript
// Example Slack integration
const alertConfig = {
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL,
    channel: '#sync-alerts',
    errorThreshold: 'critical',
    warningThreshold: 'warning'
  }
};
```

## 🔍 Troubleshooting

### Common Issues

**Sync Failures**
```bash
# Check recent sync history
GET /api/sync-history?syncPairId=1&limit=10

# View detailed error logs
GET /api/sync-pairs/1/logs
```

**Performance Issues**
```bash
# Check performance metrics
GET /api/metrics

# View slow operations
GET /api/performance/slow-operations
```

**Data Quality Issues**
```bash
# Run quality analysis
POST /api/sync-pairs/1/analyze-quality

# Get validation report
GET /api/sync-pairs/1/validation-report
```

### Performance Optimization

1. **Reduce Sync Frequency** for less critical data
2. **Use Status Filters** to sync only active deals
3. **Enable Auto-Resolution** to reduce manual conflicts
4. **Regular Cleanup** of old conflicts and logs
5. **Monitor Health Scores** and address issues promptly

## 🚀 Deployment

### Production Checklist

- [ ] Database migration completed
- [ ] Environment variables configured
- [ ] SSL certificates installed
- [ ] Webhook endpoints tested
- [ ] Monitoring alerts configured
- [ ] Backup strategy implemented
- [ ] Health dashboard accessible

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 5000
CMD ["npm", "start"]
```

### Environment-Specific Configs

```bash
# Production
NODE_ENV=production
LOG_LEVEL=warn
RATE_LIMIT_CALLS_PER_SECOND=5

# Development
NODE_ENV=development
LOG_LEVEL=debug
RATE_LIMIT_CALLS_PER_SECOND=10
```

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
git clone https://github.com/yourorg/vc-sync-tool.git
cd vc-sync-tool
npm install
npm run dev
```

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suites
npm run test:sync
npm run test:api
npm run test:validation
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- 📧 **Email**: support@yourorg.com
- 💬 **Slack**: #vc-sync-tool
- 🐛 **Issues**: [GitHub Issues](https://github.com/yourorg/vc-sync-tool/issues)
- 📖 **Documentation**: [Wiki](https://github.com/yourorg/vc-sync-tool/wiki)

---

**Made with ❤️ for VC teams who want to focus on investing, not data entry.**