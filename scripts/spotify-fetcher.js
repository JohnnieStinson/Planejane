/**
 * spotify-fetcher.js
 *
 * Fetches new hip-hop releases from Spotify and writes them to
 * ../data/releases.json for the PlaneJane frontend to consume.
 *
 * Setup:
 *   1. Copy .env.example to .env and fill in your credentials
 *   2. npm install
 *   3. node spotify-fetcher.js
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const OUTPUT_FILE   = path.join(__dirname, '..', 'data', 'releases.json');

const HIP_HOP_GENRES = [
  'hip hop', 'hip-hop', 'rap', 'trap', 'drill', 'r&b', 'southern hip hop',
  'east coast hip hop', 'west coast hip hop', 'underground hip hop',
  'alternative hip hop', 'conscious hip hop', 'hardcore hip hop'
];

// ─── Auth ──────────────────────────────────────────────────────────────────

async function getAccessToken() {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token request failed: ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

// ─── Spotify helpers ────────────────────────────────────────────────────────

async function spotifyGet(token, url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Spotify request failed: ${url} → ${res.status}`);
  return res.json();
}

// ─── Fetch new releases ─────────────────────────────────────────────────────

async function fetchNewReleases(token) {
  console.log('Fetching new releases...');
  const data = await spotifyGet(
    token,
    'https://api.spotify.com/v1/browse/new-releases?limit=50&country=US'
  );
  return data.albums.items;
}

// ─── Search for hip-hop new releases ───────────────────────────────────────

async function searchHipHopAlbums(token) {
  console.log('Searching hip-hop albums...');
  const query = encodeURIComponent('hip hop');
  const data  = await spotifyGet(
    token,
    `https://api.spotify.com/v1/search?q=${query}&type=album&market=US&limit=50`
  );
  return data.albums.items;
}

// ─── Get artist genres for an artist ID ─────────────────────────────────────

async function getArtistGenres(token, artistId) {
  try {
    const artist = await spotifyGet(token, `https://api.spotify.com/v1/artists/${artistId}`);
    return artist.genres || [];
  } catch {
    return [];
  }
}

// ─── Check if an album belongs to hip-hop ───────────────────────────────────

function isHipHop(genres) {
  const lower = genres.map(g => g.toLowerCase());
  return HIP_HOP_GENRES.some(hg => lower.some(g => g.includes(hg)));
}

// ─── Format album into our schema ───────────────────────────────────────────

function formatAlbum(album, genres) {
  const releaseDate = album.release_date;
  const today       = new Date();
  const release     = new Date(releaseDate);
  const status      = release > today ? 'upcoming' : 'released';

  // Spotify provides cover art at multiple sizes — prefer 640px
  const cover =
    album.images.find(img => img.width >= 600)?.url ||
    album.images[0]?.url ||
    null;

  return {
    id:          album.id,
    title:       album.name,
    artist:      album.artists.map(a => a.name).join(', '),
    cover,
    release_date: releaseDate,
    status,
    type:        album.album_type,   // "album", "single", "compilation"
    total_tracks: album.total_tracks,
    spotify_url: album.external_urls.spotify,
    genres
  };
}

// ─── Deduplicate by Spotify album ID ────────────────────────────────────────

function dedupe(albums) {
  const seen = new Set();
  return albums.filter(a => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env');
    process.exit(1);
  }

  const token = await getAccessToken();
  console.log('Access token obtained.');

  // Pull from both endpoints and merge
  const [newReleases, searchResults] = await Promise.all([
    fetchNewReleases(token),
    searchHipHopAlbums(token)
  ]);

  const combined = dedupe([...newReleases, ...searchResults]);
  console.log(`Combined pool: ${combined.length} albums. Checking genres...`);

  // Fetch artist genres and filter for hip-hop (batch with small delay to avoid rate limits)
  const hiphopAlbums = [];
  for (const album of combined) {
    const artistId = album.artists[0]?.id;
    const genres   = artistId ? await getArtistGenres(token, artistId) : [];

    // Include if search surfaced it as hip-hop OR artist genres match
    const fromSearch = searchResults.some(s => s.id === album.id);
    if (fromSearch || isHipHop(genres)) {
      hiphopAlbums.push(formatAlbum(album, genres));
    }

    // Small delay to be polite to the API
    await new Promise(r => setTimeout(r, 50));
  }

  // Sort: upcoming first, then by release date descending
  hiphopAlbums.sort((a, b) => {
    if (a.status === 'upcoming' && b.status !== 'upcoming') return -1;
    if (b.status === 'upcoming' && a.status !== 'upcoming') return 1;
    return new Date(b.release_date) - new Date(a.release_date);
  });

  console.log(`Found ${hiphopAlbums.length} hip-hop albums.`);

  // Write output
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const output = {
    updated_at: new Date().toISOString(),
    count:      hiphopAlbums.length,
    albums:     hiphopAlbums
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Written to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
