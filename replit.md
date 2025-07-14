# replit.md

## Overview

This is a data synchronization application that enables bidirectional sync between Affinity CRM and Notion databases. The application is built with a modern full-stack architecture using TypeScript, React, and Express.js, with PostgreSQL for data persistence.

## User Preferences

```
Preferred communication style: Simple, everyday language.
```

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for client-side routing
- **State Management**: TanStack Query (React Query) for server state management
- **UI Components**: Radix UI primitives with custom shadcn/ui components
- **Styling**: Tailwind CSS with CSS variables for theming
- **Build Tool**: Vite for development and build processes

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ESM modules
- **Database**: PostgreSQL with Drizzle ORM
- **Database Provider**: Neon Database (@neondatabase/serverless)
- **API Design**: RESTful API with JSON responses
- **Session Management**: Express sessions with PostgreSQL storage (connect-pg-simple)

### Development Setup
- **Hot Reload**: Vite HMR for frontend, tsx for backend development
- **Development Server**: Express serves both API and static files
- **Build Process**: Vite builds frontend, esbuild bundles backend
- **TypeScript**: Shared types between frontend and backend via `shared/` directory

## Key Components

### Database Schema
The application uses four main tables:
- **users**: User authentication and management
- **sync_pairs**: Configuration for sync relationships between Affinity lists and Notion databases
- **sync_history**: Audit log of synchronization attempts and results
- **conflicts**: Records of data conflicts requiring manual resolution

### External Service Integration
- **Affinity Service**: Handles communication with Affinity CRM API for lists, entries, and field values
- **Notion Service**: Manages Notion API integration for databases and pages
- **Sync Service**: Orchestrates bidirectional synchronization with conflict detection and scheduled syncing

### Frontend Components
- **Dashboard**: Main interface showing sync pairs, conflicts, and system status
- **Sync Configuration Modal**: Interface for creating and editing sync pairs
- **Conflict Resolution Modal**: UI for resolving data conflicts between systems
- **API Settings**: Configuration and monitoring of external API connections

## Data Flow

1. **Sync Pair Creation**: Users configure sync relationships between Affinity lists and Notion databases
2. **Scheduled Synchronization**: Background cron jobs execute syncs based on configured frequency
3. **Conflict Detection**: System identifies data conflicts when both systems have changed the same field
4. **Manual Resolution**: Users review and resolve conflicts through the web interface
5. **Audit Trail**: All sync operations are logged with detailed history and metrics

## External Dependencies

### Third-Party APIs
- **Affinity CRM API**: For accessing lists, entries, and field data
- **Notion API**: For reading and writing database pages and properties

### Key Libraries
- **@neondatabase/serverless**: PostgreSQL database connectivity
- **@notionhq/client**: Official Notion API client
- **drizzle-orm**: Type-safe database operations
- **@tanstack/react-query**: Server state management
- **@radix-ui/react-***: Accessible UI primitives
- **node-cron**: Scheduled task execution
- **axios**: HTTP client for API requests

## Deployment Strategy

### Production Build
- Frontend: Vite builds static assets to `dist/public`
- Backend: esbuild bundles server to `dist/index.js`
- Database: Drizzle migrations manage schema changes

### Environment Configuration
- **DATABASE_URL**: PostgreSQL connection string (required)
- **NOTION_INTEGRATION_SECRET**: Notion API authentication token
- **NOTION_PAGE_URL**: Base Notion page for database discovery

### Replit-Specific Features
- **Development Banner**: Replit development mode indicators
- **Error Overlay**: Runtime error modal for development
- **Cartographer**: Replit-specific development tooling

The application is designed to be deployed on Replit with automatic database provisioning and environment variable management. The development workflow supports hot reloading and integrated debugging tools.

## Recent Changes

### July 14, 2025: Affinity Deletion Protection System  
- Implemented comprehensive safety measures to prevent ANY deletion of Affinity entries
- Added multiple layers of protection in both sync service and Affinity service
- System now only performs field updates on existing Affinity entries, never creates or deletes
- Bidirectional sync functionality enabled with strict Affinity protection
- Added safety logging and validation to detect any attempted deletions
- Safety constants and validation ensure Affinity entries remain untouchable
- Notion-to-Affinity sync direction safe for field updates while preserving all Affinity data

### July 14, 2025: Intelligent Sync Tracking System
- Implemented database-backed sync tracking to eliminate unnecessary updates
- Added `synced_records` table to store hashes of normalized field values
- System now only updates records when field values actually change
- Fixed sync history showing incorrect "records updated" count for unchanged data
- Sync performance improved by skipping identical records on subsequent syncs
- Added proper cleanup of synced records when Notion pages are deleted
- Hash-based comparison ensures accurate change detection regardless of data format differences

### July 14, 2025: Field Mapping Data Conversion Fix
- Fixed critical issue with Affinity field values not syncing to Notion properly
- Updated `convertAffinityToNotionProperty` function in Notion service to handle Affinity dropdown format
- Affinity multi-select dropdowns now properly extract text values from `{dropdownOptionId: X, text: "Value"}` format
- Single-select dropdowns also handle the same object format correctly
- Field mappings like "Upcoming Round" now sync actual values ("Series A", "Carve Out") instead of "[object Object]"
- Multi-select properties in Notion now show correct option names and values

### July 14, 2025: Performance Optimization & Intelligent Conflict Resolution
- Successfully converted all API calls to Affinity API v2 with Bearer token authentication
- Fixed major pagination issue: Now correctly fetches all 701 entries across 8 pages instead of just 100
- Updated pagination logic to use `response.data.pagination.nextUrl` instead of `response.data.nextUrl`
- Implemented proper cursor-based pagination for accessing all 700+ entries in Affinity lists
- Updated field data extraction to use embedded v2 API structure from `entry.entity.fields[]`
- Field values now accessed directly from embedded response instead of separate API calls
- Status filtering updated to work with v2 field format: `field.value.data.text`
- Eliminated all deprecated v1 API calls throughout the codebase

#### Major Performance Improvements
- Implemented pre-filtering during API fetch to reduce memory usage and processing time
- Added parallel batch processing (5 entries simultaneously) instead of sequential processing  
- Optimized API calls by removing verbose debug logging and redundant field lookups
- Sync speed improved by approximately 3-5x for large datasets

#### Intelligent Conflict Resolution System
- Enhanced conflict detection with timestamp-based automatic resolution
- **Unidirectional syncs**: Source system always wins (no conflicts generated)
- **Bidirectional syncs**: Most recently modified data wins automatically
- Uses last sync time and entity modification timestamps to determine precedence
- Only creates manual conflicts when both systems modified data simultaneously
- Provides detailed logging of conflict resolution decisions for transparency

### Previous: Status Filtering Implementation
- Added status filtering capability to sync pairs
- Users can now select specific statuses from Affinity lists to sync (e.g., "Deep Diligence", "Early Diligence")
- Updated database schema to include `statusFilters` field in sync pairs table
- Implemented filtering logic in sync service to only process entries with selected statuses
- Added UI components in sync configuration modal for status selection
- Status filtering works for both unidirectional and bidirectional sync operations

### Previous: Organization Data Access
- Fixed organization data access from Affinity API
- Added Entity Name, Entity Domain, and Entity Type virtual fields for mapping
- Organization information now properly accessible for sync configuration