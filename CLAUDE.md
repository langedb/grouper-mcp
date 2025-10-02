# CLAUDE.md - Grouper MCP Server

## Project Overview

This is a **Model Context Protocol (MCP) server** that enables AI assistants like Claude to interact with Grouper Web Services for identity and access management tasks. The server acts as a bridge between AI assistants and Grouper's REST API.

## Project Type

**MCP Server Implementation** - Node.js application using the `@modelcontextprotocol/sdk`

## Architecture

### Core Components

1. **Server Setup** (`index.js`)
   - MCP Server instance using stdio transport
   - Handles authentication with Grouper via Basic Auth
   - Request/response handling for all tool operations

2. **Authentication**
   - Environment-based configuration (`.env` file)
   - Basic authentication using username/password
   - Credentials stored securely in environment variables

3. **API Integration**
   - Connects to Grouper Web Services REST API v4.0.x
   - Helper function `grouperRequest()` handles all HTTP communication
   - All requests use POST method with JSON payloads

### Available Tools

The server exposes 15 MCP tools for Grouper operations:

#### Group Operations
- `create_group` - Create new groups with optional display name and description
- `delete_group` - Delete existing groups
- `find_groups` - Search for groups by name or stem (approximate matching)
- `get_group_members` - Retrieve all members of a specific group

#### Member Operations
- `add_group_member` - Add subjects to groups (with configurable source ID)
- `delete_group_member` - Remove subjects from groups
- `has_member` - Check if a subject is a member of a group
- `trace_membership` - Trace a subject's membership path to a group
- `get_subject_memberships` - Get all group memberships for a subject with optional filtering by group name substring

#### Privilege Operations
- `assign_privilege` - Grant privileges (read, admin, update, view, optin, optout) to subjects
- `get_group_privileges` - Query privileges for a group

#### Subject Operations
- `get_subjects` - Search for subjects (users) by search string

#### Attribute Operations
- `find_attribute_def_names` - Search for attribute definition names

## Configuration

### Environment Variables Required
- `GROUPER_BASE_URL` - Base URL of Grouper instance (e.g., https://grouper.institution.edu)
- `GROUPER_USERNAME` - Grouper service account username
- `GROUPER_PASSWORD` - Grouper service account password

### Configuration Files
- `.env` - Local environment configuration (not committed to git)
- `.env.example` - Template for environment configuration
- `.gitignore` - Ensures sensitive files stay out of version control

## Development Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Grouper credentials

# Run server standalone
npm start
```

## Usage with Claude Desktop

Add to Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "grouper": {
      "command": "node",
      "args": ["/absolute/path/to/grouper-mcp/index.js"],
      "env": {
        "GROUPER_BASE_URL": "https://grouper.yourinstitution.edu",
        "GROUPER_USERNAME": "your_username",
        "GROUPER_PASSWORD": "your_password"
      }
    }
  }
}
```

## API Documentation
- https://grouperws.uchicago.edu/web/docs/

## API Endpoints Used

All endpoints are under `/web/servicesRest/v4_0_*`:
- `/v4_0_020/groups` - Add members
- `/v4_0_030/groups` - Get members
- `/v4_0_040/groups` - Find groups
- `/v4_0_050/groups` - Create groups
- `/v4_0_060/groups` - Delete groups
- `/v4_0_100/grouperPrivileges` - Assign privileges
- `/v4_0_110/grouperPrivileges` - Get privileges
- `/v4_0_220/groups` - Delete members
- `/v4_0_270/attributeDefNames` - Find attribute definitions
- `/v4_0_280/subjects` - Search subjects
- `/v4_0_290/groups` - Check membership (has_member)
- `/v4_0_120/memberships` - Get memberships for tracing

## Security Considerations

- **Credentials**: Never commit `.env` file; use environment variables in production
- **Authentication**: Uses HTTP Basic Auth - ensure HTTPS in production
- **Permissions**: Service account should follow principle of least privilege
- **File Permissions**: Restrict access to `.env` file on filesystem

## Example Use Cases

Once integrated with Claude Desktop, you can use natural language:

- "Create a group for the new engineering project team"
- "Add john.doe@institution.edu to the admin:superusers group"
- "Who are all the members of the finance:accounting group?"
- "Search for groups related to 'student'"
- "Give jane.smith admin privileges on the project:alpha group"
- "Find all subjects matching the name 'anderson'"
- "Show me all groups that john.doe is a member of with 'authorized' in the name"
- "Get all memberships for jane.smith filtered by 'admin'"

## Technology Stack

- **Runtime**: Node.js (ES modules)
- **MCP SDK**: `@modelcontextprotocol/sdk` v1.0.0
- **HTTP Client**: `node-fetch` v3.3.2
- **Transport**: stdio (standard input/output)

## Error Handling

- Validates required environment variables on startup
- Catches and reports Grouper API errors
- Returns error responses with `isError: true` flag
- Logs errors to stderr for debugging

## Project Structure

```
grouper-mcp/
├── index.js              # Main server implementation
├── package.json          # Node.js dependencies and metadata
├── package-lock.json     # Locked dependency versions
├── .env                  # Local configuration (not in git)
├── .env.example          # Configuration template
├── .gitignore            # Git exclusions
├── README.md             # User documentation
└── CLAUDE.md             # This file - Claude context
```

## Dependencies

- `@modelcontextprotocol/sdk` - Official MCP SDK for building servers
- `node-fetch` - HTTP client for Node.js (ESM compatible)

## Contributing

This is an MIT-licensed project. Contributions are welcome via issues and pull requests.

## Future Enhancement Ideas

- Support for additional Grouper operations (stems, composite groups)
- Batch operations for bulk member additions/removals
- Caching layer for frequently accessed data
- Support for additional authentication methods
- Rate limiting and request throttling
- Comprehensive error messages with recovery suggestions
