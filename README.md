# Grouper MCP Server

A Model Context Protocol (MCP) server for [Grouper Web Services](https://grouperws.uchicago.edu/web/docs/). This server enables AI assistants to interact with Grouper for identity and access management tasks.

## Features

This MCP server provides tools for:

- **Group Management**: Create, delete, and search for groups
- **Member Management**: Add and remove members from groups
- **Privilege Management**: Assign and query group privileges
- **Attribute Management**: Find and manage attribute definitions
- **Subject Search**: Search for users and subjects in Grouper

## Installation

1. Clone this repository or download the files

2. Install dependencies:
```bash
npm install
```

3. Configure your Grouper credentials:
```bash
cp .env.example .env
```

4. Edit `.env` with your actual Grouper instance details:
```env
GROUPER_BASE_URL=https://grouper.yourinstitution.edu
GROUPER_USERNAME=your_username
GROUPER_PASSWORD=your_password
```

## Usage

### Running Standalone

Test the server directly:
```bash
npm start
```

### Using with Claude Desktop

Add this server to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

**Linux**: `~/.config/Claude/claude_desktop_config.json`

Add the following configuration:

```json
{
  "mcpServers": {
    "grouper": {
      "command": "node",
      "args": ["/path/to/grouper-mcp/index.js"],
      "env": {
        "GROUPER_BASE_URL": "https://grouper.yourinstitution.edu",
        "GROUPER_USERNAME": "your_username",
        "GROUPER_PASSWORD": "your_password"
      }
    }
  }
}
```

Replace `/path/to/grouper-mcp` with the actual path to this directory.

## Available Tools

### Group Operations

- **`create_group`**: Create a new group
  - Parameters: `groupName`, `displayExtension` (optional), `description` (optional)

- **`delete_group`**: Delete a group
  - Parameters: `groupName`

- **`find_groups`**: Search for groups
  - Parameters: `queryFilter`, `pageNumber` (optional), `pageSize` (optional)

- **`get_group_members`**: Get all members of a group
  - Parameters: `groupName`, `pageNumber` (optional), `pageSize` (optional)

- **`get_group_member_count`**: Get the total number of members in a group
  - Parameters: `groupName`

### Member Operations

- **`add_group_member`**: Add a member to a group
  - Parameters: `groupName`, `subjectId`, `subjectSourceId` (optional)

- **`delete_group_member`**: Remove a member from a group
  - Parameters: `groupName`, `subjectId`, `subjectSourceId` (optional)

- **`get_subject_memberships`**: Get all group memberships for a subject with optional filtering
  - Parameters: `subjectId`, `subjectSourceId` (optional), `groupNameFilter` (optional), `pageNumber` (optional), `pageSize` (optional)
  - The `groupNameFilter` parameter allows filtering by substring in group name (case-insensitive)

- **`has_member`**: Check if a subject is a member of a group
  - Parameters: `groupName`, `subjectId`, `subjectSourceId` (optional)

- **`trace_membership`**: Trace a subject's membership path to a group
  - Parameters: `groupName`, `subjectId`, `subjectSourceId` (optional)

### Privilege Operations

- **`assign_privilege`**: Assign a privilege to a subject on a group
  - Parameters: `groupName`, `subjectId`, `privilegeName` (e.g., "read", "admin", "update", "view", "optin", "optout"), `subjectSourceId` (optional)

- **`get_group_privileges`**: Get privileges for a group
  - Parameters: `groupName`, `pageNumber` (optional), `pageSize` (optional)

### Subject Operations

- **`get_subjects`**: Search for subjects (users)
  - Parameters: `searchString`, `pageNumber` (optional), `pageSize` (optional)

### Attribute Operations

- **`find_attribute_def_names`**: Find attribute definition names
  - Parameters: `queryFilter`, `pageNumber` (optional), `pageSize` (optional)

## Example Prompts

Once configured with Claude Desktop, you can use natural language prompts like:

- "Search for groups containing 'engineering' in their name"
- "Add user john.doe to the group institution:departments:engineering:staff"
- "List all members of the group institution:admin:superusers"
- "Create a new group called institution:projects:newproject with description 'New project team'"
- "What privileges does user jane.smith have on the group institution:finance:team?"
- "Find subjects matching 'smith'"
- "Show me all groups that john.doe is a member of with 'authorized' in the name"
- "Get all memberships for jane.smith filtered by 'admin'"
- "Is user bob.jones a member of the IT:staff group?"

## Testing

Run the test suite:
```bash
npm test
```

Test authentication with your Grouper instance:
```bash
node test-auth.js
```

## Security Notes

- Credentials are stored in the `.env` file or passed via environment variables
- Basic authentication is used to connect to Grouper Web Services
- Ensure your `.env` file is added to `.gitignore` and never committed to version control
- Use appropriate file permissions to protect your credentials

## API Version

This server uses Grouper Web Services REST API version 4.0.x endpoints.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
