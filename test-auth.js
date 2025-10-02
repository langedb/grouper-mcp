#!/usr/bin/env node

import fetch from 'node-fetch';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const GROUPER_BASE_URL = process.env.GROUPER_BASE_URL;
const GROUPER_USERNAME = process.env.GROUPER_USERNAME;
const GROUPER_PASSWORD = process.env.GROUPER_PASSWORD;

console.log('=== Grouper Authentication Test ===\n');
console.log('Base URL:', GROUPER_BASE_URL);
console.log('Username:', GROUPER_USERNAME);
console.log('Password:', GROUPER_PASSWORD ? '***SET*** (length: ' + GROUPER_PASSWORD.length + ')' : '***NOT SET***');
console.log();

if (!GROUPER_USERNAME || !GROUPER_PASSWORD) {
  console.error('ERROR: GROUPER_USERNAME and GROUPER_PASSWORD must be set in .env file');
  process.exit(1);
}

async function testEndpoint(endpoint, body) {
  const url = `${GROUPER_BASE_URL}${endpoint}`;
  const auth = Buffer.from(`${GROUPER_USERNAME}:${GROUPER_PASSWORD}`).toString('base64');

  console.log(`\nTesting: ${url}`);
  console.log('Authorization header:', `Basic ${auth.substring(0, 20)}...`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    console.log('Status:', response.status, response.statusText);

    const responseText = await response.text();

    // Try to parse as JSON
    try {
      const data = JSON.parse(responseText);
      console.log('Response (JSON):');
      console.log(JSON.stringify(data, null, 2));
    } catch (e) {
      console.log('Response (not JSON):');
      console.log(responseText.substring(0, 500));
    }

    return response.ok;
  } catch (error) {
    console.error('Error:', error.message);
    return false;
  }
}

async function main() {
  console.log('=== Test 1: Simple Group Find ===');
  const test1 = await testEndpoint('/web/servicesRest/v4_0_040/groups', {
    WsRestFindGroupsRequest: {
      queryFilterType: 'FIND_BY_GROUP_NAME_APPROXIMATE',
      groupName: 'test',
    },
  });

  console.log('\n=== Test 2: Get Subjects (should work even without groups) ===');
  const test2 = await testEndpoint('/web/servicesRest/v4_0_280/subjects', {
    WsRestGetSubjectsRequest: {
      searchString: GROUPER_USERNAME,
    },
  });

  console.log('\n=== Summary ===');
  console.log('Test 1 (Find Groups):', test1 ? '✓ PASSED' : '✗ FAILED');
  console.log('Test 2 (Get Subjects):', test2 ? '✓ PASSED' : '✗ FAILED');

  if (!test1 && !test2) {
    console.log('\n=== Troubleshooting Tips ===');
    console.log('1. Verify credentials are correct (try logging into Grouper UI)');
    console.log('2. Try different username formats:');
    console.log('   - Just username (e.g., "jdoe")');
    console.log('   - Email format (e.g., "jdoe@uchicago.edu")');
    console.log('   - With LDAP source (e.g., "jdoe@ldap")');
    console.log('3. Check if your account has WS access permissions');
    console.log('4. Verify the GROUPER_BASE_URL is correct');
    console.log('5. Check if SSL/TLS certificates are valid');
  }
}

main();
