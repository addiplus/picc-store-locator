/**
 * Analyze Notion database to understand data distribution
 */

const NOTION_API_TOKEN = process.env.NOTION_API_TOKEN;
const NOTION_DATABASE_ID = '267a86d999988078adcac47c306ab8ba';

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
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ start_cursor: nextCursor, page_size: 100 })
      }
    );
    const data = await response.json();
    pages.push(...data.results);
    hasMore = data.has_more;
    nextCursor = data.next_cursor;
  }
  return pages;
}

async function main() {
  console.log('Fetching all pages...\n');
  const pages = await fetchAllPages();
  console.log(`Total records: ${pages.length}\n`);

  // Analyze Account Status distribution
  const statuses = {};
  let withCoords = 0;
  let withOrders = 0;
  let customerWithCoords = 0;
  const recentCustomers = [];

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  for (const page of pages) {
    const props = page.properties;

    // Count by status
    const status = props['Account Status']?.status?.name || 'Unknown';
    statuses[status] = (statuses[status] || 0) + 1;

    // Check for coordinates
    const mapLoc = props['Map Location']?.place;
    const hasCoords = mapLoc && typeof mapLoc.lat === 'number';
    if (hasCoords) withCoords++;

    // Check for orders
    const lastOrder = props['Last Order Date']?.rollup?.date?.start;
    const lastDelivery = props['Last Delivery Date']?.rollup?.date?.start;
    const hasOrder = lastOrder || lastDelivery;
    if (hasOrder) withOrders++;

    // Check if it's a customer with coords and recent order
    if (status === 'Customer' && hasCoords) {
      customerWithCoords++;
      const orderDate = lastDelivery || lastOrder;
      if (orderDate && new Date(orderDate) >= sixtyDaysAgo) {
        const name = props['Dispensary Name']?.title?.[0]?.plain_text || 'Unknown';
        recentCustomers.push({ name, lastOrder: orderDate, lat: mapLoc.lat, lng: mapLoc.lon });
      }
    }
  }

  console.log('=== Account Status Distribution ===');
  Object.entries(statuses)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => console.log(`  ${status}: ${count}`));

  console.log(`\n=== Data Completeness ===`);
  console.log(`  Records with coordinates: ${withCoords}`);
  console.log(`  Records with orders: ${withOrders}`);
  console.log(`  Customers with coordinates: ${customerWithCoords}`);

  console.log(`\n=== Recent Customers (60 days) with Coords ===`);
  console.log(`  Count: ${recentCustomers.length}`);
  if (recentCustomers.length > 0) {
    console.log('\n  Sample records:');
    recentCustomers.slice(0, 5).forEach(c =>
      console.log(`    - ${c.name} (${c.lat}, ${c.lng}) - Last order: ${c.lastOrder}`)
    );
  }
}

main();
