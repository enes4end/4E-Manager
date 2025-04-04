require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Parse Shopify shops from .env
let SHOPIFY_SHOPS = [];
try {
  SHOPIFY_SHOPS = JSON.parse(process.env.SHOPIFY_SHOPS);
  console.log('SHOPIFY_SHOPS loaded successfully.');
} catch (error) {
  console.error('Error parsing SHOPIFY_SHOPS from .env:', error);
  console.error('SHOPIFY_SHOPS value:', process.env.SHOPIFY_SHOPS);
  process.exit(1);
}

// Find the representative shop using the identifier from the .env file
const REPRESENTATIVE_SHOP = SHOPIFY_SHOPS.find(
  (shop) => shop.name === process.env.REPRESENTATIVE_SHOP
);
if (!REPRESENTATIVE_SHOP) {
  console.error('Representative shop not found in SHOPIFY_SHOPS!');
  process.exit(1);
} else {
  console.log(`Representative shop set to: ${REPRESENTATIVE_SHOP.name}`);
}

// In-memory snapshot for change detection
let memorySnapshot = {};

// --- /fetch Endpoint ---
app.get('/fetch', async (req, res) => {
  try {
    // Simulate fetching product variant data from Shopify via the representative shop
    const sampleData = [
      {
        sku: 'SKU123',
        title: 'Sample Product',
        status: 'active',
        description: 'A sample product description',
        images: 'http://example.com/image1.jpg,http://example.com/image2.jpg',
        price: '29.99',
        type: 'T-Shirt',
        vendor: 'VendorName',
        collections: 'Summer,Sale',
        tags: 'new,hot',
      },
      // ... additional rows can be added here.
    ];

    // Update memory snapshot with fetched data (using SKU as key)
    memorySnapshot = {};
    sampleData.forEach((row) => {
      memorySnapshot[row.sku] = row;
    });

    console.log('Fetched sample data and updated memory snapshot.');
    // (Google Sheets API integration to update your sheet would be added here)
    res.json({ message: 'Fetch completed successfully.', data: sampleData });
  } catch (error) {
    console.error('Error in /fetch:', error);
    res.status(500).json({ error: 'Fetch failed.' });
  }
});

// --- /update Endpoint ---
app.post('/update', async (req, res) => {
  try {
    // Expected payload example:
    // { updatedRows: [ { sku: 'SKU123', changes: { price: '25.99', tags: 'discount,clearance' }, rowNumber: 2 } ],
    //   selectedShops: ['SI', 'HR'] }
    const { updatedRows, selectedShops } = req.body;
    const updateResults = [];

    for (const row of updatedRows) {
      const { sku, changes, rowNumber } = row;
      const original = memorySnapshot[sku];
      if (!original) {
        updateResults.push({
          sku,
          rowNumber,
          shops: selectedShops,
          message: 'SKU not found in snapshot, skipping update.',
        });
        continue;
      }

      // Update the variant for each selected shop
      for (const shopName of selectedShops) {
        const shop = SHOPIFY_SHOPS.find((s) => s.name === shopName);
        if (!shop) continue;

        // Note: Shopify expects a variant ID, not SKU. This URL is a placeholder.
        const shopUrl = `https://${shop.domain}/admin/api/2023-04/variants/${sku}.json`;
        const payload = { variant: changes };

        try {
          const response = await axios.put(shopUrl, payload, {
            headers: {
              'X-Shopify-Access-Token': shop.token,
              'Content-Type': 'application/json',
            },
          });
          updateResults.push({
            sku,
            rowNumber,
            shop: shopName,
            message: 'Update successful',
          });
        } catch (err) {
          updateResults.push({
            sku,
            rowNumber,
            shop: shopName,
            message: `Update failed: ${
              err.response
                ? JSON.stringify(err.response.data.errors)
                : err.message
            }`,
          });
        }
      }
    }

    console.log('Update process completed.');
    // (Google Sheets API integration to update your Logs sheet would be added here)
    res.json({ message: 'Update process completed.', results: updateResults });
  } catch (error) {
    console.error('Error in /update:', error);
    res.status(500).json({ error: 'Update failed.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
