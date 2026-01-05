/**
 * PICC Store Locator - Notion to JSON Export
 *
 * Fetches dispensary data from Notion and exports to stores.json
 * Designed to run as a scheduled GitHub Action
 *
 * Required env vars:
 *   NOTION_API_TOKEN - Notion integration token
 *   NOTION_DATABASE_ID - Dispensary Master List database ID
 */

const NOTION_API_TOKEN = process.env.NOTION_API_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '267a86d999988078adcac47c306ab8ba';
const NOTION_VERSION = '2022-06-28';

// Filter configuration
const VALID_ACCOUNT_STATUSES = ['Customer', 'Customer Overdue'];

// Product column mapping (Notion property name -> display name)
const PRODUCT_COLUMNS = {
  'State of Mind 1G Customer': 'State of Mind',
  'O-Yeah 1G Customer': 'O-Yeah',
  'SUSHI Hash 1G Customer': 'Sushi Hash',
  'SMACK 1G': 'SMACK',
  'SMACK .5G': 'SMACK',
  'ICHI- #JUAN 1G Customer': 'ICHI'
};

/**
 * Fetch all pages from Notion database with pagination
 */
async function fetchAllPages() {
  const pages = [];
  let hasMore = true;
  let nextCursor = undefined;

  while (hasMore) {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_API_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          start_cursor: nextCursor,
          page_size: 100
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Notion API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    pages.push(...data.results);
    hasMore = data.has_more;
    nextCursor = data.next_cursor;

    console.log(`Fetched ${pages.length} pages...`);
  }

  return pages;
}

/**
 * Extract plain text from Notion rich_text array
 */
function getPlainText(richTextArray) {
  if (!richTextArray || !Array.isArray(richTextArray)) return null;
  return richTextArray.map(rt => rt.plain_text).join('') || null;
}

/**
 * Get title property value
 */
function getTitle(properties) {
  const titleProp = properties['Dispensary Name'];
  if (!titleProp || titleProp.type !== 'title') return null;
  return getPlainText(titleProp.title);
}

/**
 * Get status property value
 */
function getStatus(properties) {
  const statusProp = properties['Account Status'];
  if (!statusProp || statusProp.type !== 'status') return null;
  return statusProp.status?.name || null;
}

/**
 * Get date from rollup property
 */
function getRollupDate(properties, propName) {
  const prop = properties[propName];
  if (!prop || prop.type !== 'rollup') return null;

  const rollup = prop.rollup;
  if (rollup.type === 'date' && rollup.date) {
    return rollup.date.start || null;
  }
  return null;
}

/**
 * Get place (Map Location) coordinates
 */
function getMapLocation(properties) {
  const placeProp = properties['Map Location'];
  if (!placeProp || placeProp.type !== 'place' || !placeProp.place) return null;

  const { lat, lon } = placeProp.place;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  return { lat, lng: lon };
}

/**
 * Get products the store carries (based on rollup dates being non-null)
 */
function getProducts(properties) {
  const products = new Set();

  for (const [propName, displayName] of Object.entries(PRODUCT_COLUMNS)) {
    const date = getRollupDate(properties, propName);
    if (date) {
      products.add(displayName);
    }
  }

  return Array.from(products);
}

/**
 * Transform Notion page to store location object
 */
function transformPage(page) {
  const props = page.properties;

  const name = getTitle(props);
  const address = getPlainText(props['Address']?.rich_text);
  const city = getPlainText(props['City']?.rich_text);
  const status = getStatus(props);
  const lastOrderDate = getRollupDate(props, 'Last Order Date');
  const lastDeliveryDate = getRollupDate(props, 'Last Delivery Date');
  const location = getMapLocation(props);
  const products = getProducts(props);

  return {
    id: page.id,
    name,
    address: address ? (city ? `${address}, ${city}` : address) : null,
    lat: location?.lat || null,
    lng: location?.lng || null,
    status,
    lastOrderDate,
    lastDeliveryDate,
    products
  };
}

/**
 * Filter stores based on business rules
 */
function filterStores(stores) {
  return stores.filter(store => {
    // Must have required fields
    if (!store.name || !store.lat || !store.lng) {
      return false;
    }

    // Must be a customer (includes Customer and Customer Overdue)
    if (!VALID_ACCOUNT_STATUSES.includes(store.status)) {
      return false;
    }

    return true;
  });
}

/**
 * Main export function
 */
async function exportStores() {
  console.log('Starting Notion export...');
  console.log(`Database ID: ${NOTION_DATABASE_ID}`);
  console.log(`Filter: Account Status in [${VALID_ACCOUNT_STATUSES.join(', ')}]`);
  console.log(`Filter: Must have Map Location coordinates`);
  console.log('');

  // Fetch all pages
  const pages = await fetchAllPages();
  console.log(`\nTotal pages fetched: ${pages.length}`);

  // Transform to store objects
  const allStores = pages.map(transformPage);

  // Apply filters
  const filteredStores = filterStores(allStores);
  console.log(`Stores after filtering: ${filteredStores.length}`);

  // Clean up for output (remove internal fields)
  const outputStores = filteredStores.map(store => ({
    id: store.id,
    name: store.name,
    address: store.address,
    lat: store.lat,
    lng: store.lng,
    products: store.products,
    lastDelivery: store.lastDeliveryDate || store.lastOrderDate
  }));

  // Generate output
  const output = {
    generated: new Date().toISOString(),
    count: outputStores.length,
    stores: outputStores
  };

  return output;
}

/**
 * Write output to file or stdout
 */
async function main() {
  if (!NOTION_API_TOKEN) {
    console.error('Error: NOTION_API_TOKEN environment variable is required');
    process.exit(1);
  }

  try {
    const data = await exportStores();

    // Output to stdout (GitHub Action will redirect to file)
    const jsonOutput = JSON.stringify(data, null, 2);
    console.log('\n--- OUTPUT START ---');
    console.log(jsonOutput);
    console.log('--- OUTPUT END ---');

    // Also write to file if running locally
    const fs = await import('fs');
    const path = await import('path');
    const outputPath = path.join(import.meta.dirname, '..', 'stores.json');
    fs.writeFileSync(outputPath, jsonOutput);
    console.log(`\nWritten to: ${outputPath}`);

  } catch (error) {
    console.error('Export failed:', error.message);
    process.exit(1);
  }
}

main();
