#!/usr/bin/env node

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

// Load .env from the script's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '.env') });

// Configuration from environment variables
const GROUPER_BASE_URL = process.env.GROUPER_BASE_URL || 'https://grouper.institution.edu';
const GROUPER_USERNAME = process.env.GROUPER_USERNAME;
const GROUPER_PASSWORD = process.env.GROUPER_PASSWORD;

// Check if running in test mode
const isTestMode = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

if (!isTestMode) {
  console.error('[INIT] Starting Grouper MCP Server');
  console.error('[INIT] GROUPER_BASE_URL:', GROUPER_BASE_URL);
  console.error('[INIT] GROUPER_USERNAME:', GROUPER_USERNAME ? '***SET***' : '***NOT SET***');
  console.error('[INIT] GROUPER_PASSWORD:', GROUPER_PASSWORD ? '***SET***' : '***NOT SET***');

  if (!GROUPER_USERNAME || !GROUPER_PASSWORD) {
    console.error('[ERROR] GROUPER_USERNAME and GROUPER_PASSWORD environment variables are required');
    process.exit(1);
  }
}

// Maximum response size in characters (approximately 50KB of JSON)
const MAX_RESPONSE_SIZE = 50000;
const DEFAULT_PAGE_SIZE = 25;

/**
 * Helper function to automatically chunk large result sets
 * @param {Array} items - The full array of items to potentially chunk
 * @param {number|string} pageNumber - Current page number (1-indexed), or undefined for page 1
 * @param {number|string} pageSize - Items per page, or undefined for default
 * @param {string} itemTypeName - Name of the item type for messages (e.g., "members", "groups")
 * @returns {Object} Object with chunked items and pagination metadata
 */
function chunkResults(items, pageNumber, pageSize, itemTypeName = 'items') {
  // Convert to numbers and apply defaults
  const page = pageNumber ? parseInt(pageNumber, 10) : 1;
  const size = pageSize ? parseInt(pageSize, 10) : DEFAULT_PAGE_SIZE;

  // Calculate total size of all items
  const fullJson = JSON.stringify(items);
  const totalSize = fullJson.length;
  const totalItems = items.length;

  // If small enough, return everything
  if (totalSize <= MAX_RESPONSE_SIZE) {
    return {
      items,
      totalItems,
      isComplete: true,
      pageInfo: null,
    };
  }

  // Calculate pagination
  const startIndex = (page - 1) * size;
  const endIndex = startIndex + size;
  const chunkedItems = items.slice(startIndex, endIndex);
  const totalPages = Math.ceil(totalItems / size);

  return {
    items: chunkedItems,
    totalItems,
    isComplete: false,
    pageInfo: {
      message: `Result set is too large (${totalItems} ${itemTypeName}, ~${Math.round(totalSize / 1024)}KB). Showing page ${page} of ${totalPages} (${size} ${itemTypeName} per page).`,
      currentPage: page,
      pageSize: size,
      totalPages,
      totalItems,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      nextPage: page < totalPages ? page + 1 : null,
      previousPage: page > 1 ? page - 1 : null,
      instruction: `To retrieve more results, call this tool again with pageNumber=${page < totalPages ? page + 1 : page} and pageSize=${size}.`,
    },
  };
}

// Helper function to make authenticated requests to Grouper
export async function grouperRequest(endpoint, method = 'GET', body = null) {
  const url = `${GROUPER_BASE_URL}${endpoint}`;
  const auth = Buffer.from(`${GROUPER_USERNAME}:${GROUPER_PASSWORD}`).toString('base64');

  console.error('[API] Making request to:', url);
  console.error('[API] Method:', method);
  console.error('[API] Username being used:', GROUPER_USERNAME);
  console.error('[API] Authorization header present:', auth ? 'YES' : 'NO');
  console.error('[API] Auth string length:', auth.length);
  console.error('[API] First 20 chars of base64:', auth.substring(0, 20) + '...');

  if (body) {
    console.error('[API] Request body:', JSON.stringify(body, null, 2));
  }

  const options = {
    method,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  };

  console.error('[API] All headers being sent:', JSON.stringify(options.headers, (key, value) => {
    if (key === 'Authorization') return 'Basic [REDACTED]';
    return value;
  }, 2));

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    console.error('[API] Response status:', response.status, response.statusText);

    // Get the response text first to check if it's JSON
    const responseText = await response.text();
    console.error('[API] Response body (first 500 chars):', responseText.substring(0, 500));

    // Try to parse as JSON
    let data;
    try {
      data = JSON.parse(responseText);
      console.error('[API] Response data (parsed JSON):', JSON.stringify(data, null, 2));
    } catch (parseError) {
      console.error('[API] Response is not JSON, likely HTML error page');
      if (!response.ok) {
        throw new Error(`Grouper API error (${response.status}): Response is HTML, not JSON. Check credentials and URL. First 200 chars: ${responseText.substring(0, 200)}`);
      }
      throw new Error(`Failed to parse response as JSON: ${parseError.message}`);
    }

    if (!response.ok) {
      console.error('[API] Request failed with status:', response.status);
      throw new Error(`Grouper API error: ${JSON.stringify(data)}`);
    }

    console.error('[API] Request successful');
    return data;
  } catch (error) {
    console.error('[API] Error during request:', error.message);
    throw error;
  }
}

// Exported tool handler functions
export async function handleAddGroupMember(args) {
  const { groupName, subjectId, subjectSourceId } = args;
  const subjectLookup = { subjectId };
  if (subjectSourceId) {
    subjectLookup.subjectSourceId = subjectSourceId;
  }
  await grouperRequest(
    '/web/servicesRest/v4_0_020/groups',
    'POST',
    {
      WsRestAddMemberRequest: {
        wsGroupLookup: { groupName },
        subjectLookups: [subjectLookup],
      },
    }
  );
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'success',
        message: `Added subject '${subjectId}' to group '${groupName}'.`,
      }),
    }],
  };
}

export async function handleDeleteGroupMember(args) {
  const { groupName, subjectId, subjectSourceId } = args;
  const subjectLookup = { subjectId };
  if (subjectSourceId) {
    subjectLookup.subjectSourceId = subjectSourceId;
  }
  await grouperRequest(
    '/web/servicesRest/v4_0_220/groups',
    'POST',
    {
      WsRestDeleteMemberRequest: {
        wsGroupLookup: { groupName },
        subjectLookups: [subjectLookup],
      },
    }
  );
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'success',
        message: `Removed subject '${subjectId}' from group '${groupName}'.`,
      }),
    }],
  };
}

export async function handleGetGroupMembers(args) {
  try {
    const { groupName, pageNumber, pageSize } = args;
    const requestBody = {
      WsRestGetMembersRequest: {
        wsGroupLookups: [{ groupName }],
        includeGroupDetail: 'T',
        includeSubjectDetail: 'T',
        subjectAttributeNames: ['name', 'description', 'loginid', 'email'],
      },
    };

    // Note: Grouper API pagination may not work for all endpoints
    // We'll fetch all results and do client-side chunking
    const result = await grouperRequest('/web/servicesRest/v4_0_030/groups', 'POST', requestBody);

    const wsGetMembersResults = result.WsGetMembersResults;
    const results = wsGetMembersResults.results[0];
    const subjects = results ? results.wsSubjects : [];

    const simplifiedMembers = (subjects || []).map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      sourceId: s.sourceId,
    }));

    // Apply automatic chunking
    const chunked = chunkResults(simplifiedMembers, pageNumber, pageSize, 'members');

    const response = {
      group: results ? results.wsGroup.name : groupName,
      totalMembers: chunked.totalItems,
      memberCount: chunked.items.length,
      members: chunked.items,
    };

    // Add pagination info if results were chunked
    if (chunked.pageInfo) {
      response.pagination = chunked.pageInfo;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`,
      }],
      isError: true,
    };
  }
}

export async function handleGetGroupMemberCount(args) {
  const { groupName } = args;
  const requestBody = {
    WsRestGetMembersRequest: {
      wsGroupLookups: [{ groupName }],
      includeSubjectDetail: 'F',
    },
  };

  const result = await grouperRequest('/web/servicesRest/v4_0_030/groups', 'POST', requestBody);

  const wsGetMembersResults = result.WsGetMembersResults;
  const results = wsGetMembersResults.results[0];
  const subjects = results ? results.wsSubjects : [];
  const subjectCount = subjects ? subjects.length : 0;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        group: results ? results.wsGroup.name : groupName,
        memberCount: subjectCount,
      }),
    }],
  };
}

export async function handleFindGroups(args) {
  try {
    const { queryFilter, pageNumber, pageSize } = args;
    const result = await grouperRequest(
      '/web/servicesRest/v4_0_040/groups',
      'POST',
      {
        WsRestFindGroupsRequest: {
          wsQueryFilter: {
            queryFilterType: 'FIND_BY_GROUP_NAME_APPROXIMATE',
            groupName: queryFilter,
          },
          includeGroupDetail: 'T',
        },
      }
    );
    const groupResults = result.WsFindGroupsResults?.groupResults || [];
    const simplifiedGroups = groupResults.map(g => ({
      name: g.name,
      displayName: g.displayName,
      description: g.description,
    }));

    // Apply automatic chunking
    const chunked = chunkResults(simplifiedGroups, pageNumber, pageSize, 'groups');

    const response = {
      totalGroups: chunked.totalItems,
      groupCount: chunked.items.length,
      groups: chunked.items,
    };

    // Add pagination info if results were chunked
    if (chunked.pageInfo) {
      response.pagination = chunked.pageInfo;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`,
      }],
      isError: true,
    };
  }
}

export async function handleCreateGroup(args) {
  const { groupName, displayExtension, description } = args;
  const result = await grouperRequest(
    '/web/servicesRest/v4_0_050/groups',
    'POST',
    {
      WsRestGroupSaveRequest: {
        wsGroupToSaves: [{
          wsGroup: {
            name: groupName,
            displayExtension: displayExtension || groupName.split(':').pop(),
            description: description || '',
          },
        }],
      },
    }
  );
  const savedGroup = result.WsGroupSaveResults?.results[0]?.wsGroup;
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'success',
        group: {
          name: savedGroup.name,
          displayName: savedGroup.displayName,
          description: savedGroup.description,
        },
      }),
    }],
  };
}

export async function handleDeleteGroup(args) {
  const { groupName } = args;
  await grouperRequest(
    '/web/servicesRest/v4_0_060/groups',
    'POST',
    {
      WsRestGroupDeleteRequest: {
        wsGroupLookups: [{ groupName }],
      },
    }
  );
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'success',
        message: `Group '${groupName}' deleted.`,
      }),
    }],
  };
}

export async function handleAssignPrivilege(args) {
  const { groupName, subjectId, privilegeName, subjectSourceId } = args;
  const requestBody = {
    WsRestAssignGrouperPrivilegesLiteRequest: {
      groupName,
      subjectId,
      privilegeName,
      privilegeType: 'access',
      allowed: 'T',
    },
  };
  if (subjectSourceId) {
    requestBody.WsRestAssignGrouperPrivilegesLiteRequest.subjectSourceId = subjectSourceId;
  }
  await grouperRequest('/web/servicesRest/v4_0_100/grouperPrivileges', 'POST', requestBody);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'success',
        message: `Assigned privilege '${privilegeName}' to subject '${subjectId}' on group '${groupName}'.`,
      }),
    }],
  };
}

export async function handleGetGroupPrivileges(args) {
  const { groupName, pageNumber, pageSize } = args;
  const result = await grouperRequest(
    '/web/servicesRest/v4_0_110/grouperPrivileges',
    'POST',
    {
      WsRestGetGrouperPrivilegesLiteRequest: {
        groupName,
        privilegeType: 'access',
        includeGroupDetail: 'T',
        includeSubjectDetail: 'T',
      },
    }
  );
  const privileges = result.WsGetGrouperPrivilegesLiteResult?.privilegeResults || [];
  const simplifiedPrivileges = privileges.map(p => ({
    subjectId: p.wsSubject.id,
    privilegeName: p.privilegeName,
    isAllowed: p.allowed === 'T',
  }));

  // Apply automatic chunking
  const chunked = chunkResults(simplifiedPrivileges, pageNumber, pageSize, 'privileges');

  const response = {
    group: privileges[0]?.wsGroup?.name || groupName,
    totalPrivileges: chunked.totalItems,
    privilegeCount: chunked.items.length,
    privileges: chunked.items,
  };

  // Add pagination info if results were chunked
  if (chunked.pageInfo) {
    response.pagination = chunked.pageInfo;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response),
    }],
  };
}

export async function handleFindAttributeDefNames(args) {
  const { queryFilter, pageNumber, pageSize } = args;
  const result = await grouperRequest(
    '/web/servicesRest/v4_0_270/attributeDefNames',
    'POST',
    {
      WsRestFindAttributeDefNamesRequest: {
        wsQueryFilter: {
          queryFilterType: 'FIND_BY_ATTRIBUTE_DEF_NAME_APPROXIMATE',
          attributeDefName: queryFilter,
        },
        includeAttributeDefNameDetail: 'T',
      },
    }
  );
  const attributeDefNames = result.WsFindAttributeDefNamesResults?.attributeDefNameResults || [];
  const simplifiedNames = attributeDefNames.map(a => ({
    name: a.name,
    description: a.description,
  }));

  // Apply automatic chunking
  const chunked = chunkResults(simplifiedNames, pageNumber, pageSize, 'attribute definitions');

  const response = {
    totalAttributeDefNames: chunked.totalItems,
    attributeDefNameCount: chunked.items.length,
    attributeDefNames: chunked.items,
  };

  // Add pagination info if results were chunked
  if (chunked.pageInfo) {
    response.pagination = chunked.pageInfo;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response),
    }],
  };
}

export async function handleGetSubjects(args) {
  const { searchString, pageNumber, pageSize, includeSubjectDetail } = args;
  const result = await grouperRequest(
    '/web/servicesRest/v4_0_280/subjects',
    'POST',
    {
      WsRestGetSubjectsRequest: {
        searchString,
        includeSubjectDetail: includeSubjectDetail === false ? 'F' : 'T',
      },
    }
  );
  const subjects = result.WsGetSubjectsResults?.wsSubjects || [];
  const simplifiedSubjects = subjects.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    sourceId: s.sourceId,
  }));

  // Apply automatic chunking
  const chunked = chunkResults(simplifiedSubjects, pageNumber, pageSize, 'subjects');

  const response = {
    totalSubjects: chunked.totalItems,
    subjectCount: chunked.items.length,
    subjects: chunked.items,
  };

  // Add pagination info if results were chunked
  if (chunked.pageInfo) {
    response.pagination = chunked.pageInfo;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response),
    }],
  };
}

export async function handleHasMember(args) {
  const { groupName, subjectId, subjectSourceId } = args;
  const subjectLookup = { subjectId };
  if (subjectSourceId) {
    subjectLookup.subjectSourceId = subjectSourceId;
  }
  const result = await grouperRequest(
    `/web/servicesRest/v4_0_290/groups/${encodeURIComponent(groupName)}/members`,
    'POST',
    {
      WsRestHasMemberRequest: {
        subjectLookups: [subjectLookup],
        includeGroupDetail: 'T',
        includeSubjectDetail: 'T',
      },
    }
  );
  const memberResult = result.WsHasMemberResults?.results?.[0];
  const wsGroup = result.WsHasMemberResults?.wsGroup;
  const wsSubject = memberResult?.wsSubject;
  const isMember = memberResult?.resultMetadata?.resultCode === 'IS_MEMBER';

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        group: wsGroup?.name || groupName,
        subject: wsSubject?.id || subjectId,
        isMember: isMember,
      }),
    }],
  };
}

export async function handleTraceMembership(args) {
  const { groupName, subjectId, subjectSourceId } = args;
  const subjectLookup = { subjectId };
  if (subjectSourceId) {
    subjectLookup.subjectSourceId = subjectSourceId;
  }

  try {
    // Get all memberships for the subject
    const membershipResult = await grouperRequest(
      '/web/servicesRest/v4_0_120/memberships',
      'POST',
      {
        WsRestGetMembershipsRequest: {
          wsSubjectLookups: [subjectLookup],
          wsGroupLookups: [{ groupName }],
          wsMembershipFilter: 'All',
          includeGroupDetail: 'T',
          includeSubjectDetail: 'T',
        },
      }
    );

    const membership = membershipResult.WsGetMembershipsResults?.wsMemberships?.[0];
    const groupDetail = membershipResult.WsGetMembershipsResults?.wsGroups?.[0];
    const subject = membershipResult.WsGetMembershipsResults?.wsSubjects?.[0];

    if (!membership) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            subject: subjectId,
            group: groupName,
            isMember: false,
            message: 'Subject is not a member of this group',
          }),
        }],
      };
    }

    // Build the trace path
    const trace = {
      subject: {
        id: subject?.id || subjectId,
        name: subject?.name || subjectId,
        sourceId: subject?.sourceId || subjectSourceId,
      },
      targetGroup: {
        name: groupName,
        displayName: groupDetail?.displayName || groupName,
        description: groupDetail?.description,
      },
      membershipType: membership.membershipType,
      paths: [],
    };

    // If it's a direct membership
    if (membership.membershipType === 'immediate') {
      trace.paths.push({
        type: 'direct',
        description: `${trace.subject.name} is a direct member of ${trace.targetGroup.displayName}`,
      });
    }
    // If it's a composite membership
    else if (membership.membershipType === 'composite' && groupDetail?.detail?.hasComposite === 'T') {
      const compositeDetail = groupDetail.detail;
      const compositeType = compositeDetail.compositeType;
      const leftGroup = compositeDetail.leftGroup;
      const rightGroup = compositeDetail.rightGroup;

      // Get all subject memberships to determine the path
      const allMemberships = await grouperRequest(
        '/web/servicesRest/v4_0_120/memberships',
        'POST',
        {
          WsRestGetMembershipsRequest: {
            wsSubjectLookups: [subjectLookup],
            wsMembershipFilter: 'All',
            includeGroupDetail: 'F',
            includeSubjectDetail: 'F',
          },
        }
      );

      const allMembershipsList = allMemberships.WsGetMembershipsResults?.wsMemberships || [];
      const isInLeft = allMembershipsList.some(m => m.groupName === leftGroup.name);
      const isInRight = allMembershipsList.some(m => m.groupName === rightGroup.name);

      let pathDescription = [];

      if (compositeType === 'complement') {
        // Left minus right
        pathDescription.push({
          type: 'composite_complement',
          description: `${trace.subject.name} is a member via composite (${leftGroup.displayName} MINUS ${rightGroup.displayName})`,
          inLeftGroup: isInLeft,
          inRightGroup: isInRight,
          leftGroup: {
            name: leftGroup.name,
            displayName: leftGroup.displayName,
            description: leftGroup.description,
          },
          rightGroup: {
            name: rightGroup.name,
            displayName: rightGroup.displayName,
            description: rightGroup.description,
          },
        });

        // Check the membership type in the left group
        if (isInLeft) {
          const leftMembership = allMembershipsList.find(m => m.groupName === leftGroup.name);
          if (leftMembership) {
            // If it's an effective membership, describe it
            if (leftMembership.membershipType === 'effective') {
              // Find groups that contain "affiliations" in their name as likely candidates
              const likelyIntermediateGroups = allMembershipsList
                .filter(m => m.membershipType === 'immediate')
                .filter(m => m.groupName.includes('affiliations') || m.groupName.includes('Reference'))
                .slice(0, 3);

              pathDescription.push({
                type: 'effective',
                description: `${trace.subject.name} is effectively in ${leftGroup.displayName} through group membership`,
                groupName: leftGroup.name,
                membershipType: 'effective',
                note: 'The subject is a member through one or more intermediate groups',
                likelyPaths: likelyIntermediateGroups.length > 0 ?
                  likelyIntermediateGroups.map(m => `${trace.subject.name} is a direct member of ${m.groupName}`) :
                  undefined,
              });
            } else {
              pathDescription.push({
                type: leftMembership.membershipType,
                description: `${trace.subject.name} is a direct member of ${leftGroup.displayName}`,
                groupName: leftGroup.name,
                membershipType: leftMembership.membershipType,
              });
            }
          }
        }
      } else if (compositeType === 'intersection') {
        // Left AND right
        pathDescription.push({
          type: 'composite_intersection',
          description: `${trace.subject.name} is a member via composite (${leftGroup.displayName} AND ${rightGroup.displayName})`,
          inLeftGroup: isInLeft,
          inRightGroup: isInRight,
          leftGroup: {
            name: leftGroup.name,
            displayName: leftGroup.displayName,
          },
          rightGroup: {
            name: rightGroup.name,
            displayName: rightGroup.displayName,
          },
        });
      } else if (compositeType === 'union') {
        // Left OR right
        pathDescription.push({
          type: 'composite_union',
          description: `${trace.subject.name} is a member via composite (${leftGroup.displayName} OR ${rightGroup.displayName})`,
          inLeftGroup: isInLeft,
          inRightGroup: isInRight,
        });
      }

      trace.paths = pathDescription;
    }
    // If it's an effective membership (member of a group that's a member of this group)
    else if (membership.membershipType === 'effective') {
      trace.paths.push({
        type: 'effective',
        description: `${trace.subject.name} is an effective member (member through another group)`,
        note: 'Member through group hierarchy - use get_subject_memberships to find intermediate groups',
      });
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(trace),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error tracing membership: ${error.message}`,
      }],
      isError: true,
    };
  }
}

export async function handleRestartServer(args) {
  console.error('[TOOL] Restarting server...');
  process.exit(0);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ status: 'restarting' }),
    }],
  };
}

export async function handleGetSubjectMemberships(args) {
  try {
    const { subjectId, subjectSourceId, groupNameFilter, pageNumber, pageSize } = args;
    const subjectLookup = { subjectId };
    if (subjectSourceId) {
      subjectLookup.subjectSourceId = subjectSourceId;
    }
    const result = await grouperRequest(
      '/web/servicesRest/v4_0_120/memberships',
      'POST',
      {
        WsRestGetMembershipsRequest: {
          wsSubjectLookups: [subjectLookup],
          wsMembershipFilter: 'All',
          includeGroupDetail: 'T',
          includeSubjectDetail: 'T',
        },
      }
    );

    const memberships = result.WsGetMembershipsResults?.wsMemberships || [];
    let simplifiedMemberships = memberships.map(m => ({
      groupName: m.groupName || m.wsGroup?.name,
      groupDisplayName: m.groupDisplayName || m.wsGroup?.displayName,
      membershipType: m.membershipType,
    }));

    // Apply group name filter if provided
    const totalBeforeFilter = simplifiedMemberships.length;
    if (groupNameFilter) {
      const filterLower = groupNameFilter.toLowerCase();
      simplifiedMemberships = simplifiedMemberships.filter(m =>
        m.groupName?.toLowerCase().includes(filterLower) ||
        m.groupDisplayName?.toLowerCase().includes(filterLower)
      );
    }

    // Apply automatic chunking
    const chunked = chunkResults(simplifiedMemberships, pageNumber, pageSize, 'memberships');

    const response = {
      subject: subjectId,
      totalMemberships: chunked.totalItems,
      membershipCount: chunked.items.length,
      memberships: chunked.items,
    };

    // Add filter info if a filter was applied
    if (groupNameFilter) {
      response.filterApplied = groupNameFilter;
      response.totalBeforeFilter = totalBeforeFilter;
      response.filteredOut = totalBeforeFilter - chunked.totalItems;
    }

    // Add pagination info if results were chunked
    if (chunked.pageInfo) {
      response.pagination = chunked.pageInfo;
    }

    // Suggest using filter if results are large and no filter is applied
    if (!groupNameFilter && chunked.totalItems > 50) {
      response.suggestion = `Large result set (${chunked.totalItems} memberships). Consider using the groupNameFilter parameter to narrow down results by group name substring.`;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`,
      }],
      isError: true,
    };
  }
}

// Create server instance
export const server = new Server(
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
  console.error('[TOOLS] ListTools request received');
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
              description: 'The source of the subject (e.g., "ldap", "jdbc", "ucmcdb"). If not specified, Grouper will use its default subject source.',
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
        description: 'Get members of a Grouper group. For large groups, use pageNumber and pageSize to retrieve members in chunks.',
        inputSchema: {
          type: 'object',
          properties: {
            groupName: {
              type: 'string',
              description: 'The name of the group',
            },
            pageNumber: {
              type: 'string',
              description: 'The page number to retrieve (1-indexed)',
            },
            pageSize: {
              type: 'string',
              description: 'The number of results to return per page',
            },
          },
          required: ['groupName'],
        },
      },
      {
        name: 'get_group_member_count',
        description: 'Get the total number of members in a Grouper group.',
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
        description: 'Search for groups by name or stem. Automatically paginates large result sets.',
        inputSchema: {
          type: 'object',
          properties: {
            queryFilter: {
              type: 'string',
              description: 'Search query (group name or stem)',
            },
            pageNumber: {
              type: 'string',
              description: 'Page number to retrieve (1-indexed). Used for large result sets.',
            },
            pageSize: {
              type: 'string',
              description: 'Number of results per page (default: 50). Used for large result sets.',
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
        description: 'Get privileges for a group. Automatically paginates large result sets.',
        inputSchema: {
          type: 'object',
          properties: {
            groupName: {
              type: 'string',
              description: 'The group name',
            },
            pageNumber: {
              type: 'string',
              description: 'Page number to retrieve (1-indexed). Used for large result sets.',
            },
            pageSize: {
              type: 'string',
              description: 'Number of results per page (default: 50). Used for large result sets.',
            },
          },
          required: ['groupName'],
        },
      },
      {
        name: 'find_attribute_def_names',
        description: 'Find attribute definition names. Automatically paginates large result sets.',
        inputSchema: {
          type: 'object',
          properties: {
            queryFilter: {
              type: 'string',
              description: 'Search query for attribute definition names',
            },
            pageNumber: {
              type: 'string',
              description: 'Page number to retrieve (1-indexed). Used for large result sets.',
            },
            pageSize: {
              type: 'string',
              description: 'Number of results per page (default: 50). Used for large result sets.',
            },
          },
          required: ['queryFilter'],
        },
      },
      {
        name: 'get_subjects',
        description: 'Search for subjects (users) in Grouper. Automatically paginates large result sets.',
        inputSchema: {
          type: 'object',
          properties: {
            searchString: {
              type: 'string',
              description: 'Search string for finding subjects',
            },
            includeSubjectDetail: {
              type: 'boolean',
              description: 'Whether to include detailed subject attributes (name, description, etc.). Set to false for token efficiency when only IDs are needed. Default: true.',
            },
            pageNumber: {
              type: 'string',
              description: 'Page number to retrieve (1-indexed). Used for large result sets.',
            },
            pageSize: {
              type: 'string',
              description: 'Number of results per page (default: 50). Used for large result sets.',
            },
          },
          required: ['searchString'],
        },
      },
      {
        name: 'has_member',
        description: 'Check if a subject is a member of a Grouper group',
        inputSchema: {
          type: 'object',
          properties: {
            groupName: {
              type: 'string',
              description: 'The name of the group',
            },
            subjectId: {
              type: 'string',
              description: 'The subject ID to check',
            },
            subjectSourceId: {
              type: 'string',
              description: 'The source of the subject (e.g., "ldap", "jdbc", "ucmcdb"). If not specified, Grouper will use its default subject source.',
            },
          },
          required: ['groupName', 'subjectId'],
        },
      },
      {
        name: 'trace_membership',
        description: 'Trace how a subject is a member of a group, showing membership type (direct, effective, composite) and the path through intermediate groups or composite operations',
        inputSchema: {
          type: 'object',
          properties: {
            groupName: {
              type: 'string',
              description: 'The name of the group to trace membership to',
            },
            subjectId: {
              type: 'string',
              description: 'The subject ID to trace',
            },
            subjectSourceId: {
              type: 'string',
              description: 'The source of the subject (e.g., "ldap", "jdbc", "ucmcdb"). If not specified, Grouper will use its default subject source.',
            },
          },
          required: ['groupName', 'subjectId'],
        },
      },
      {
        name: 'restart_server',
        description: 'Restart the MCP server process',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_subject_memberships',
        description: 'Get all group memberships for a subject. Automatically paginates large result sets. Can filter results by group name substring.',
        inputSchema: {
          type: 'object',
          properties: {
            subjectId: {
              type: 'string',
              description: 'The subject ID to look up',
            },
            subjectSourceId: {
              type: 'string',
              description: 'The source of the subject (e.g., "ldap", "jdbc", "ucmcdb"). If not specified, Grouper will use its default subject source.',
            },
            groupNameFilter: {
              type: 'string',
              description: 'Optional filter to only return groups whose name or display name contains this substring (case-insensitive). Useful for narrowing large result sets. Example: "authorized" will match "app:authorized:users" and "system:authorized:admins".',
            },
            pageNumber: {
              type: 'string',
              description: 'Page number to retrieve (1-indexed). Used for large result sets.',
            },
            pageSize: {
              type: 'string',
              description: 'Number of results per page (default: 50). Used for large result sets.',
            },
          },
          required: ['subjectId'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  console.error('[TOOL] Tool call received:', name);
  console.error('[TOOL] Arguments:', JSON.stringify(args, null, 2));

  try {
    switch (name) {
      case 'add_group_member':
        return handleAddGroupMember(args);
      case 'delete_group_member':
        return handleDeleteGroupMember(args);
      case 'get_group_members':
        return handleGetGroupMembers(args);
      case 'get_group_member_count':
        return handleGetGroupMemberCount(args);
      case 'find_groups':
        return handleFindGroups(args);
      case 'create_group':
        return handleCreateGroup(args);
      case 'delete_group':
        return handleDeleteGroup(args);
      case 'assign_privilege':
        return handleAssignPrivilege(args);
      case 'get_group_privileges':
        return handleGetGroupPrivileges(args);
      case 'find_attribute_def_names':
        return handleFindAttributeDefNames(args);
      case 'get_subjects':
        return handleGetSubjects(args);
      case 'has_member':
        return handleHasMember(args);
      case 'trace_membership':
        return handleTraceMembership(args);
      case 'restart_server':
        return handleRestartServer(args);
      case 'get_subject_memberships':
        return handleGetSubjectMemberships(args);
      default:
        console.error('[TOOL] Unknown tool requested:', name);
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error('[TOOL] Error executing tool:', name);
    console.error('[TOOL] Error message:', error.message);
    console.error('[TOOL] Error stack:', error.stack);
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
  console.error('[MAIN] Initializing stdio transport');
  const transport = new StdioServerTransport();

  console.error('[MAIN] Connecting server to transport');
  await server.connect(transport);

  console.error('[MAIN] ✓ Grouper MCP server running on stdio');
  console.error('[MAIN] ✓ Server ready to accept requests');
}

// Only run the main function if the script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[FATAL] Fatal error during startup:', error.message);
    console.error('[FATAL] Stack trace:', error.stack);
    process.exit(1);
  });
}
