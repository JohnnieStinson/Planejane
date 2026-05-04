// Quick test to diagnose Spotify API issues
require('dotenv').config();

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

async function test() {
  // Step 1: Get token
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const { access_token } = await tokenRes.json();
  console.log('Token:', access_token ? 'OK' : 'FAILED');

  // Step 2: Try search with no limit
  const r1 = await fetch('https://api.spotify.com/v1/search?q=drake&type=album', {
    headers: { Authorization: `Bearer ${access_token}` }
  });
  const b1 = await r1.text();
  console.log('\nSearch (no limit):', r1.status, b1.slice(0, 200));

  // Step 3: Try search with limit=10
  const r2 = await fetch('https://api.spotify.com/v1/search?q=drake&type=album&limit=10', {
    headers: { Authorization: `Bearer ${access_token}` }
  });
  const b2 = await r2.text();
  console.log('\nSearch (limit=10):', r2.status, b2.slice(0, 200));

  // Step 4: Try market=US
  const r3 = await fetch('https://api.spotify.com/v1/search?q=drake&type=album&limit=10&market=US', {
    headers: { Authorization: `Bearer ${access_token}` }
  });
  const b3 = await r3.text();
  console.log('\nSearch (limit=10 + market=US):', r3.status, b3.slice(0, 200));
}

test().catch(console.error);
