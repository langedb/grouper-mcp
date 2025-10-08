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

/**
 * Recursively trace membership chain from subject to target group
 * @param {string} subjectId - The subject ID to trace
 * @param {string} targetGroupName - The target group name
 * @param {Object} subjectLookup - The subject lookup object
 * @param {Set} visited - Set of visited groups to prevent cycles
 * @param {number} depth - Current recursion depth
 * @returns {Object|null} - The traced path or null if not a member
 */
async function traceMembershipRecursive(subjectId, targetGroupName, subjectLookup, visited = new Set(), depth = 0) {
  // Prevent infinite loops and limit recursion depth
  // Reduced from 10 to 5 to prevent timeout issues
  const MAX_DEPTH = 5;
  if (depth > MAX_DEPTH) {
    return {
      type: 'max_depth_reached',
      description: `Maximum trace depth (${MAX_DEPTH}) reached - stopping trace to prevent timeout`,
      targetGroup: targetGroupName,
    };
  }

  if (visited.has(targetGroupName)) {
    return {
      type: 'cycle_detected',
      description: `Cycle detected at ${targetGroupName}`,
      targetGroup: targetGroupName,
    };
  }

  visited.add(targetGroupName);

  // Get membership information for this group
  const membershipResult = await grouperRequest(
    '/web/servicesRest/v4_0_120/memberships',
    'POST',
    {
      WsRestGetMembershipsRequest: {
        wsSubjectLookups: [subjectLookup],
        wsGroupLookups: [{ groupName: targetGroupName }],
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
    return null; // Not a member of this group
  }

  // Base case: immediate (direct) membership
  if (membership.membershipType === 'immediate') {
    return {
      type: 'immediate',
      groupName: targetGroupName,
      groupDisplayName: groupDetail?.displayName || targetGroupName,
      description: `${subject?.name || subjectId} is a direct member of ${groupDetail?.displayName || targetGroupName}`,
    };
  }

  // Effective membership: find the intermediate group(s)
  if (membership.membershipType === 'effective') {
    console.error(`[TRACE] Depth ${depth}: Tracing effective membership for ${subjectId} in ${targetGroupName}`);

    // Strategy: Find the intersection of (1) groups the subject is immediately in, and (2) groups that are immediately in the target
    // This requires only 2 API calls instead of N+1 where N is the number of groups the subject is in

    // Call 1: Get immediate memberships for the subject
    console.error(`[TRACE] Depth ${depth}: Getting immediate memberships for ${subjectId}`);
    const subjectMembershipsResult = await grouperRequest(
      '/web/servicesRest/v4_0_120/memberships',
      'POST',
      {
        WsRestGetMembershipsRequest: {
          wsSubjectLookups: [subjectLookup],
          wsMembershipFilter: 'Immediate',
          includeGroupDetail: 'T',
          includeSubjectDetail: 'F',
        },
      }
    );

    const subjectMemberships = subjectMembershipsResult.WsGetMembershipsResults?.wsMemberships || [];
    const subjectGroupNames = new Set(subjectMemberships.map(m => m.groupName));
    console.error(`[TRACE] Depth ${depth}: ${subjectId} is immediately in ${subjectGroupNames.size} groups`);

    // Call 2: Get immediate GROUP members of the target (only groups, not users)
    console.error(`[TRACE] Depth ${depth}: Getting group members of ${targetGroupName}`);
    const targetMembersResult = await grouperRequest(
      '/web/servicesRest/v4_0_030/groups',
      'POST',
      {
        WsRestGetMembersRequest: {
          wsGroupLookups: [{ groupName: targetGroupName }],
          includeGroupDetail: 'F',
          includeSubjectDetail: 'T',
        },
      }
    );

    const targetMembers = targetMembersResult.WsGetMembersResults?.results?.[0]?.wsSubjects || [];

    // Filter to only group members (sourceId = 'g:gsa')
    const targetGroupMembers = targetMembers.filter(m => m.sourceId === 'g:gsa');
    console.error(`[TRACE] Depth ${depth}: ${targetGroupName} has ${targetGroupMembers.length} immediate group members (out of ${targetMembers.length} total members)`);

    // Find the intersection: which group is the subject in AND is also in the target?
    const intermediateGroups = [];
    for (const targetGroupMember of targetGroupMembers) {
      if (subjectGroupNames.has(targetGroupMember.name)) {
        const groupInfo = subjectMembershipsResult.WsGetMembershipsResults?.wsGroups?.find(g => g.name === targetGroupMember.name);
        intermediateGroups.push({
          name: targetGroupMember.name,
          displayName: groupInfo?.displayName || targetGroupMember.name,
        });
        console.error(`[TRACE] Depth ${depth}: Found intermediate group: ${targetGroupMember.name}`);
        // Only trace the first one to keep things efficient
        break;
      }
    }

    if (intermediateGroups.length === 0) {
      console.error(`[TRACE] Depth ${depth}: No immediate intermediate groups found for ${subjectId} -> ${targetGroupName}`);
      console.error(`[TRACE] Depth ${depth}: Subject is in: ${Array.from(subjectGroupNames).slice(0, 5).join(', ')}...`);
      console.error(`[TRACE] Depth ${depth}: Target has group members: ${targetGroupMembers.slice(0, 5).map(m => m.id).join(', ')}...`);
      return {
        type: 'effective',
        groupName: targetGroupName,
        groupDisplayName: groupDetail?.displayName || targetGroupName,
        description: `${subject?.name || subjectId} is an effective member of ${groupDetail?.displayName || targetGroupName}`,
        note: 'Could not determine intermediate group path - membership may be through nested groups beyond immediate level',
        subjectImmediateGroupCount: subjectGroupNames.size,
        targetImmediateGroupMemberCount: targetGroupMembers.length,
      };
    }

    console.error(`[TRACE] Depth ${depth}: Recursing into intermediate group: ${intermediateGroups[0].name}`);
    // Recursively trace through the intermediate group
    const intermediatePath = await traceMembershipRecursive(
      subjectId,
      intermediateGroups[0].name,
      subjectLookup,
      new Set(visited),
      depth + 1
    );

    return {
      type: 'effective',
      groupName: targetGroupName,
      groupDisplayName: groupDetail?.displayName || targetGroupName,
      description: `${subject?.name || subjectId} is an effective member of ${groupDetail?.displayName || targetGroupName} via ${intermediateGroups[0].displayName}`,
      intermediateGroup: intermediateGroups[0],
      chain: intermediatePath,
    };
  }

  // Composite membership
  if (membership.membershipType === 'composite' && groupDetail?.detail?.hasComposite === 'T') {
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

    const result = {
      type: 'composite',
      groupName: targetGroupName,
      groupDisplayName: groupDetail?.displayName || targetGroupName,
      compositeType: compositeType,
      leftGroup: {
        name: leftGroup.name,
        displayName: leftGroup.displayName,
        isMember: isInLeft,
      },
      rightGroup: {
        name: rightGroup.name,
        displayName: rightGroup.displayName,
        isMember: isInRight,
      },
    };

    // Recursively trace the left group if the subject is a member
    if (isInLeft) {
      result.leftGroup.chain = await traceMembershipRecursive(
        subjectId,
        leftGroup.name,
        subjectLookup,
        new Set(visited),
        depth + 1
      );
    }

    // For intersection, also trace the right group
    if (compositeType === 'intersection' && isInRight) {
      result.rightGroup.chain = await traceMembershipRecursive(
        subjectId,
        rightGroup.name,
        subjectLookup,
        new Set(visited),
        depth + 1
      );
    }

    return result;
  }

  return {
    type: membership.membershipType,
    groupName: targetGroupName,
    groupDisplayName: groupDetail?.displayName || targetGroupName,
    description: `${subject?.name || subjectId} has membership type '${membership.membershipType}' in ${groupDetail?.displayName || targetGroupName}`,
  };
}

/**
 * Convert recursive trace structure into a flat path array
 * @param {Object} traceNode - The recursive trace node
 * @returns {Array} - Array of groups in the membership path
 */
function flattenTracePath(traceNode) {
  if (!traceNode) {
    return [];
  }

  const path = [];

  // Handle immediate membership
  if (traceNode.type === 'immediate') {
    path.push({
      groupName: traceNode.groupName,
      groupDisplayName: traceNode.groupDisplayName,
      membershipType: 'immediate',
      description: traceNode.description,
    });
    return path;
  }

  // Handle effective membership - follow the chain
  if (traceNode.type === 'effective' && traceNode.chain) {
    // Recursively flatten the chain
    const chainPath = flattenTracePath(traceNode.chain);
    // Add all intermediate groups to the path
    path.push(...chainPath);
    // Add the current group
    path.push({
      groupName: traceNode.groupName,
      groupDisplayName: traceNode.groupDisplayName,
      membershipType: 'effective',
      description: traceNode.description,
      viaGroup: traceNode.intermediateGroup?.name,
    });
    return path;
  }

  // Handle composite membership
  if (traceNode.type === 'composite') {
    const compositeInfo = {
      groupName: traceNode.groupName,
      groupDisplayName: traceNode.groupDisplayName,
      membershipType: 'composite',
      compositeType: traceNode.compositeType,
      leftGroup: traceNode.leftGroup.name,
      rightGroup: traceNode.rightGroup.name,
    };

    // If there's a chain through the left group, add it
    if (traceNode.leftGroup.chain) {
      const leftPath = flattenTracePath(traceNode.leftGroup.chain);
      path.push(...leftPath);
      compositeInfo.pathThroughLeftGroup = true;
    }

    // If there's a chain through the right group (for intersections), add it
    if (traceNode.rightGroup.chain) {
      const rightPath = flattenTracePath(traceNode.rightGroup.chain);
      path.push(...rightPath);
      compositeInfo.pathThroughRightGroup = true;
    }

    path.push(compositeInfo);
    return path;
  }

  // Handle other cases (max depth, cycle, etc.)
  path.push({
    groupName: traceNode.groupName || traceNode.targetGroup,
    type: traceNode.type,
    description: traceNode.description,
  });

  return path;
}

export async function handleTraceMembership(args) {
  const { groupName, subjectId, subjectSourceId } = args;
  const subjectLookup = { subjectId };
  if (subjectSourceId) {
    subjectLookup.subjectSourceId = subjectSourceId;
  }

  try {
    // Get basic membership information
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

    // Build the recursive trace
    const recursiveTrace = await traceMembershipRecursive(subjectId, groupName, subjectLookup);

    // Flatten the trace into a path array
    const membershipPath = flattenTracePath(recursiveTrace);

    const result = {
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
      membershipPath: membershipPath,
      pathSummary: membershipPath.length > 0
        ? `${subject?.name || subjectId} → ${membershipPath.map(p => p.groupDisplayName || p.groupName).join(' → ')}`
        : 'No path available',
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result),
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
      case 'get_group_members':
        return handleGetGroupMembers(args);
      case 'get_group_member_count':
        return handleGetGroupMemberCount(args);
      case 'find_groups':
        return handleFindGroups(args);
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
