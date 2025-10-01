#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

// Configuration from environment variables
const GROUPER_BASE_URL = process.env.GROUPER_BASE_URL || 'https://grouper.institution.edu';
const GROUPER_USERNAME = process.env.GROUPER_USERNAME;
const GROUPER_PASSWORD = process.env.GROUPER_PASSWORD;

if (!GROUPER_USERNAME || !GROUPER_PASSWORD) {
  console.error('ERROR: GROUPER_USERNAME and GROUPER_PASSWORD environment variables are required');
  process.exit(1);
}

// Helper function to make authenticated requests to Grouper
async function grouperRequest(endpoint, method = 'GET', body = null) {
  const url = `${GROUPER_BASE_URL}${endpoint}`;
  const auth = Buffer.from(`${GROUPER_USERNAME}:${GROUPER_PASSWORD}`).toString('base64');

  const options = {
    method,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Grouper API error: ${JSON.stringify(data)}`);
  }

  return data;
}

// Create server instance
const server = new Server(
  {
    name: 'grouper-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'add_group_member',
        description: 'Add a member to a Grouper group',
        inputSchema: {
          type: 'object',
          properties: {
            groupName: {
              type: 'string',
              description: 'The name of the group (e.g., "institution:department:groupname")',
            },
            subjectId: {
              type: 'string',
              description: 'The subject ID to add (e.g., username or ID)',
            },
            subjectSourceId: {
              type: 'string',
              description: 'The source of the subject (e.g., "ldap", "jdbc")',
              default: 'ldap',
            },
          },
          required: ['groupName', 'subjectId'],
        },
      },
      {
        name: 'delete_group_member',
        description: 'Remove a member from a Grouper group',
        inputSchema: {
          type: 'object',
          properties: {
            groupName: {
              type: 'string',
              description: 'The name of the group',
            },
            subjectId: {
              type: 'string',
              description: 'The subject ID to remove',
            },
            subjectSourceId: {
              type: 'string',
              description: 'The source of the subject',
              default: 'ldap',
            },
          },
          required: ['groupName', 'subjectId'],
        },
      },
      {
        name: 'get_group_members',
        description: 'Get all members of a Grouper group',
        inputSchema: {
          type: 'object',
          properties: {
            groupName: {
              type: 'string',
              description: 'The name of the group',
            },
          },
          required: ['groupName'],
        },
      },
      {
        name: 'find_groups',
        description: 'Search for groups by name or stem',
        inputSchema: {
          type: 'object',
          properties: {
            queryFilter: {
              type: 'string',
              description: 'Search query (group name or stem)',
            },
          },
          required: ['queryFilter'],
        },
      },
      {
        name: 'create_group',
        description: 'Create a new Grouper group',
        inputSchema: {
          type: 'object',
          properties: {
            groupName: {
              type: 'string',
              description: 'The full name of the group to create',
            },
            displayExtension: {
              type: 'string',
              description: 'Display name for the group',
            },
            description: {
              type: 'string',
              description: 'Description of the group',
            },
          },
          required: ['groupName'],
        },
      },
      {
        name: 'delete_group',
        description: 'Delete a Grouper group',
        inputSchema: {
          type: 'object',
          properties: {
            groupName: {
              type: 'string',
              description: 'The name of the group to delete',
            },
          },
          required: ['groupName'],
        },
      },
      {
        name: 'assign_privilege',
        description: 'Assign a privilege to a subject on a group',
        inputSchema: {
          type: 'object',
          properties: {
            groupName: {
              type: 'string',
              description: 'The group name',
            },
            subjectId: {
              type: 'string',
              description: 'The subject ID',
            },
            privilegeName: {
              type: 'string',
              description: 'Privilege to assign (e.g., "read", "admin", "update", "view", "optin", "optout")',
            },
            subjectSourceId: {
              type: 'string',
              description: 'The source of the subject',
              default: 'ldap',
            },
          },
          required: ['groupName', 'subjectId', 'privilegeName'],
        },
      },
      {
        name: 'get_group_privileges',
        description: 'Get privileges for a group',
        inputSchema: {
          type: 'object',
          properties: {
            groupName: {
              type: 'string',
              description: 'The group name',
            },
          },
          required: ['groupName'],
        },
      },
      {
        name: 'find_attribute_def_names',
        description: 'Find attribute definition names',
        inputSchema: {
          type: 'object',
          properties: {
            queryFilter: {
              type: 'string',
              description: 'Search query for attribute definition names',
            },
          },
          required: ['queryFilter'],
        },
      },
      {
        name: 'get_subjects',
        description: 'Search for subjects (users) in Grouper',
        inputSchema: {
          type: 'object',
          properties: {
            searchString: {
              type: 'string',
              description: 'Search string for finding subjects',
            },
          },
          required: ['searchString'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'add_group_member': {
        const { groupName, subjectId, subjectSourceId = 'ldap' } = args;
        const result = await grouperRequest(
          '/web/servicesRest/v4_0_020/groups',
          'POST',
          {
            WsRestAddMemberRequest: {
              groupName,
              subjectId,
              subjectSourceId,
            },
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'delete_group_member': {
        const { groupName, subjectId, subjectSourceId = 'ldap' } = args;
        const result = await grouperRequest(
          '/web/servicesRest/v4_0_220/groups',
          'POST',
          {
            WsRestDeleteMemberRequest: {
              groupName,
              subjectId,
              subjectSourceId,
            },
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_group_members': {
        const { groupName } = args;
        const result = await grouperRequest(
          '/web/servicesRest/v4_0_030/groups',
          'POST',
          {
            WsRestGetMembersRequest: {
              groupNames: [groupName],
            },
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'find_groups': {
        const { queryFilter } = args;
        const result = await grouperRequest(
          '/web/servicesRest/v4_0_040/groups',
          'POST',
          {
            WsRestFindGroupsRequest: {
              queryFilterType: 'FIND_BY_GROUP_NAME_APPROXIMATE',
              groupName: queryFilter,
            },
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'create_group': {
        const { groupName, displayExtension, description } = args;
        const result = await grouperRequest(
          '/web/servicesRest/v4_0_050/groups',
          'POST',
          {
            WsRestGroupSaveRequest: {
              wsGroupToSaves: [
                {
                  wsGroup: {
                    name: groupName,
                    displayExtension: displayExtension || groupName.split(':').pop(),
                    description: description || '',
                  },
                },
              ],
            },
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'delete_group': {
        const { groupName } = args;
        const result = await grouperRequest(
          '/web/servicesRest/v4_0_060/groups',
          'POST',
          {
            WsRestGroupDeleteRequest: {
              groupNames: [groupName],
            },
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'assign_privilege': {
        const { groupName, subjectId, privilegeName, subjectSourceId = 'ldap' } = args;
        const result = await grouperRequest(
          '/web/servicesRest/v4_0_100/grouperPrivileges',
          'POST',
          {
            WsRestAssignGrouperPrivilegesRequest: {
              groupName,
              subjectId,
              subjectSourceId,
              privilegeName,
              allowed: 'T',
            },
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_group_privileges': {
        const { groupName } = args;
        const result = await grouperRequest(
          '/web/servicesRest/v4_0_110/grouperPrivileges',
          'POST',
          {
            WsRestGetGrouperPrivilegesRequest: {
              groupName,
            },
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'find_attribute_def_names': {
        const { queryFilter } = args;
        const result = await grouperRequest(
          '/web/servicesRest/v4_0_270/attributeDefNames',
          'POST',
          {
            WsRestFindAttributeDefNamesRequest: {
              queryFilterType: 'FIND_BY_ATTRIBUTE_DEF_NAME_APPROXIMATE',
              attributeDefName: queryFilter,
            },
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_subjects': {
        const { searchString } = args;
        const result = await grouperRequest(
          '/web/servicesRest/v4_0_280/subjects',
          'POST',
          {
            WsRestGetSubjectsRequest: {
              searchString,
            },
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Grouper MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
