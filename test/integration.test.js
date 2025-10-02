import { jest } from '@jest/globals'; // Import jest

// Define the mock for node-fetch before importing it
const mockFetch = jest.fn();
jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch,
}));

// Set test environment before importing modules
process.env.NODE_ENV = 'test';

// Now dynamically import the modules
const {
  grouperRequest,
  handleFindGroups,
  handleGetGroupMembers,
  handleGetSubjectMemberships
} = await import('../index.js');

describe('Grouper MCP Server Integration Tests', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    mockFetch.mockClear();
  });

  it('should successfully call find_groups and return groups', async () => {
    // Mock a successful response from the Grouper API
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        WsFindGroupsResults: {
          groupResults: [
            { name: 'test:group1', displayName: 'Test Group 1', description: 'A test group' },
            { name: 'test:group2', displayName: 'Test Group 2', description: 'Another test group' },
          ],
        },
      })),
    });

    const args = { queryFilter: 'test' };

    const response = await handleFindGroups(args);

    expect(response).toBeDefined();
    expect(response.isError).toBeUndefined();
    expect(response.content).toBeDefined();
    expect(response.content[0].type).toBe('text');

    const responseData = JSON.parse(response.content[0].text);
    expect(responseData.groups).toBeInstanceOf(Array);
    expect(responseData.groups.length).toBe(2);
    expect(responseData.groups[0].name).toBe('test:group1');
    expect(responseData.groups[1].name).toBe('test:group2');

    // Verify that grouperRequest was called with the correct arguments
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCallArgs = mockFetch.mock.calls[0];
    expect(fetchCallArgs[0]).toContain('/web/servicesRest/v4_0_040/groups');
    const fetchOptions = fetchCallArgs[1];
    expect(fetchOptions.method).toBe('POST');
    const requestBody = JSON.parse(fetchOptions.body);
    expect(requestBody.WsRestFindGroupsRequest.wsQueryFilter.groupName).toBe('test');
  });

  it('should return an error if find_groups fails', async () => {
    // Mock an error response from the Grouper API
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve(JSON.stringify({ errors: ['Internal Server Error'] })),
    });

    const args = { queryFilter: 'error_test' };

    const response = await handleFindGroups(args);

    expect(response).toBeDefined();
    expect(response.isError).toBe(true);
    expect(response.content).toBeDefined();
    expect(response.content[0].text).toContain('Grouper API error');
  });

  it('should successfully call get_group_members and return members', async () => {
    // Mock a successful response from the Grouper API
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        WsGetMembersResults: {
          results: [{
            wsGroup: { name: 'test:testgroup' },
            wsSubjects: [
              { id: 'user1', name: 'User One', description: 'Desc 1', sourceId: 'ldap' },
              { id: 'user2', name: 'User Two', description: 'Desc 2', sourceId: 'ldap' },
            ],
          }],
        },
      })),
    });

    const args = { groupName: 'test:testgroup' };

    const response = await handleGetGroupMembers(args);

    expect(response).toBeDefined();
    expect(response.isError).toBeUndefined();
    expect(response.content).toBeDefined();
    expect(response.content[0].type).toBe('text');

    const responseData = JSON.parse(response.content[0].text);
    expect(responseData.group).toBe('test:testgroup');
    expect(responseData.memberCount).toBe(2);
    expect(responseData.members).toBeInstanceOf(Array);
    expect(responseData.members.length).toBe(2);
    expect(responseData.members[0].id).toBe('user1');
    expect(responseData.members[1].id).toBe('user2');

    // Verify that grouperRequest was called with the correct arguments
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCallArgs = mockFetch.mock.calls[0];
    expect(fetchCallArgs[0]).toContain('/web/servicesRest/v4_0_030/groups');
    const fetchOptions = fetchCallArgs[1];
    expect(fetchOptions.method).toBe('POST');
    const requestBody = JSON.parse(fetchOptions.body);
    expect(requestBody.WsRestGetMembersRequest.wsGroupLookups[0].groupName).toBe('test:testgroup');
  });

  it('should return an error if get_group_members fails', async () => {
    // Mock an error response from the Grouper API
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve(JSON.stringify({ errors: ['Group not found'] })),
    });

    const args = { groupName: 'nonexistent:group' };

    const response = await handleGetGroupMembers(args);

    expect(response).toBeDefined();
    expect(response.isError).toBe(true);
    expect(response.content).toBeDefined();
    expect(response.content[0].text).toContain('Grouper API error');
  });

  it('should successfully call get_subject_memberships and return memberships', async () => {
    // Mock a successful response from the Grouper API
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        WsGetMembershipsResults: {
          wsMemberships: [
            { groupName: 'group1', groupDisplayName: 'Group One', membershipType: 'immediate' },
            { groupName: 'group2', groupDisplayName: 'Group Two', membershipType: 'effective' },
          ],
        },
      })),
    });

    const args = { subjectId: 'testuser' };

    const response = await handleGetSubjectMemberships(args);

    expect(response).toBeDefined();
    expect(response.isError).toBeUndefined();
    expect(response.content).toBeDefined();
    expect(response.content[0].type).toBe('text');

    const responseData = JSON.parse(response.content[0].text);
    expect(responseData.memberships).toBeInstanceOf(Array);
    expect(responseData.memberships.length).toBe(2);
    expect(responseData.memberships[0].groupName).toBe('group1');
    expect(responseData.memberships[1].groupName).toBe('group2');

    // Verify that grouperRequest was called with the correct arguments
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCallArgs = mockFetch.mock.calls[0];
    expect(fetchCallArgs[0]).toContain('/web/servicesRest/v4_0_120/memberships');
    const fetchOptions = fetchCallArgs[1];
    expect(fetchOptions.method).toBe('POST');
    const requestBody = JSON.parse(fetchOptions.body);
    expect(requestBody.WsRestGetMembershipsRequest.wsSubjectLookups[0].subjectId).toBe('testuser');
    // Should not include subjectSourceId if not provided
    expect(requestBody.WsRestGetMembershipsRequest.wsSubjectLookups[0].subjectSourceId).toBeUndefined();
  });

  it('should include subjectSourceId when explicitly provided', async () => {
    // Mock a successful response from the Grouper API
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        WsGetMembershipsResults: {
          wsMemberships: [
            { groupName: 'group1', groupDisplayName: 'Group One', membershipType: 'immediate' },
          ],
        },
      })),
    });

    const args = { subjectId: 'testuser', subjectSourceId: 'ucmcdb' };

    const response = await handleGetSubjectMemberships(args);

    expect(response).toBeDefined();
    expect(response.isError).toBeUndefined();

    // Verify that subjectSourceId was included in the request
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCallArgs = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCallArgs[1].body);
    expect(requestBody.WsRestGetMembershipsRequest.wsSubjectLookups[0].subjectId).toBe('testuser');
    expect(requestBody.WsRestGetMembershipsRequest.wsSubjectLookups[0].subjectSourceId).toBe('ucmcdb');
  });

  it('should return an error if get_subject_memberships fails', async () => {
    // Mock an error response from the Grouper API
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve(JSON.stringify({ errors: ['Internal Server Error'] })),
    });

    const args = { subjectId: 'erroruser' };

    const response = await handleGetSubjectMemberships(args);

    expect(response).toBeDefined();
    expect(response.isError).toBe(true);
    expect(response.content).toBeDefined();
    expect(response.content[0].text).toContain('Grouper API error');
  });

  it('should filter memberships by groupNameFilter', async () => {
    // Mock a successful response from the Grouper API with multiple groups
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        WsGetMembershipsResults: {
          wsMemberships: [
            { groupName: 'app:authorized:users', groupDisplayName: 'Authorized Users', membershipType: 'immediate' },
            { groupName: 'system:authorized:admins', groupDisplayName: 'Authorized Admins', membershipType: 'immediate' },
            { groupName: 'test:regular:users', groupDisplayName: 'Regular Users', membershipType: 'immediate' },
            { groupName: 'app:standard:members', groupDisplayName: 'Standard Members', membershipType: 'effective' },
          ],
        },
      })),
    });

    const args = { subjectId: 'testuser', groupNameFilter: 'authorized' };

    const response = await handleGetSubjectMemberships(args);

    expect(response).toBeDefined();
    expect(response.isError).toBeUndefined();
    expect(response.content).toBeDefined();

    const responseData = JSON.parse(response.content[0].text);

    // Should only return groups with 'authorized' in the name
    expect(responseData.memberships).toBeInstanceOf(Array);
    expect(responseData.memberships.length).toBe(2);
    expect(responseData.memberships[0].groupName).toBe('app:authorized:users');
    expect(responseData.memberships[1].groupName).toBe('system:authorized:admins');

    // Check filter metadata
    expect(responseData.filterApplied).toBe('authorized');
    expect(responseData.totalBeforeFilter).toBe(4);
    expect(responseData.filteredOut).toBe(2);
    expect(responseData.totalMemberships).toBe(2);
  });

  it('should filter memberships case-insensitively', async () => {
    // Mock a successful response from the Grouper API
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        WsGetMembershipsResults: {
          wsMemberships: [
            { groupName: 'app:ADMIN:users', groupDisplayName: 'Admin Users', membershipType: 'immediate' },
            { groupName: 'system:admin:power', groupDisplayName: 'Admin Power', membershipType: 'immediate' },
            { groupName: 'test:regular:users', groupDisplayName: 'Regular Users', membershipType: 'immediate' },
          ],
        },
      })),
    });

    const args = { subjectId: 'testuser', groupNameFilter: 'admin' };

    const response = await handleGetSubjectMemberships(args);

    expect(response).toBeDefined();
    expect(response.isError).toBeUndefined();

    const responseData = JSON.parse(response.content[0].text);

    // Should match both 'ADMIN' and 'admin'
    expect(responseData.memberships.length).toBe(2);
    expect(responseData.totalMemberships).toBe(2);
    expect(responseData.filterApplied).toBe('admin');
  });

  it('should suggest using filter when results are large and no filter is applied', async () => {
    // Create a large set of memberships (> 50)
    const largeMemberships = Array.from({ length: 60 }, (_, i) => ({
      groupName: `group${i}`,
      groupDisplayName: `Group ${i}`,
      membershipType: 'immediate',
    }));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        WsGetMembershipsResults: {
          wsMemberships: largeMemberships,
        },
      })),
    });

    const args = { subjectId: 'testuser' };

    const response = await handleGetSubjectMemberships(args);

    expect(response).toBeDefined();
    expect(response.isError).toBeUndefined();

    const responseData = JSON.parse(response.content[0].text);

    // Should include a suggestion to use filter
    expect(responseData.suggestion).toBeDefined();
    expect(responseData.suggestion).toContain('groupNameFilter');
    expect(responseData.totalMemberships).toBe(60);
  });

  it('should not suggest filter when filter is already applied', async () => {
    // Create a large set of memberships (> 50)
    const largeMemberships = Array.from({ length: 60 }, (_, i) => ({
      groupName: `group${i}`,
      groupDisplayName: `Group ${i}`,
      membershipType: 'immediate',
    }));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        WsGetMembershipsResults: {
          wsMemberships: largeMemberships,
        },
      })),
    });

    const args = { subjectId: 'testuser', groupNameFilter: 'group' };

    const response = await handleGetSubjectMemberships(args);

    expect(response).toBeDefined();
    expect(response.isError).toBeUndefined();

    const responseData = JSON.parse(response.content[0].text);

    // Should NOT include a suggestion since filter is already applied
    expect(responseData.suggestion).toBeUndefined();
    expect(responseData.filterApplied).toBe('group');
  });

});