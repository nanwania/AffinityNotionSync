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