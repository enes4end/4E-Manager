require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Parse Shopify shops from .env (should be a JSON array)
let SHOPIFY_SHOPS = [];
try {
  SHOPIFY_SHOPS = JSON.parse(process.env.SHOPIFY_SHOPS);
  console.log('SHOPIFY_SHOPS loaded successfully.');
} catch (error) {
  console.error('Error parsing SHOPIFY_SHOPS from .env:', error);
  console.error('SHOPIFY_SHOPS value:', process.env.SHOPIFY_SHOPS);
  process.exit(1);
}

// Find the representative shop (for fetching) using the identifier from the .env file
const REPRESENTATIVE_SHOP = SHOPIFY_SHOPS.find(
  (shop) => shop.name === process.env.REPRESENTATIVE_SHOP
);
if (!REPRESENTATIVE_SHOP) {
  console.error('Representative shop not found in SHOPIFY_SHOPS!');
  process.exit(1);
} else {
  console.log(`Representative shop set to: ${REPRESENTATIVE_SHOP.name}`);
}

// In-memory snapshot to store fetched variant data by SKU
let memorySnapshot = {};

/**
 * GET /fetch?sku=SKU123
 * Uses Shopify's GraphQL API of the representative shop to fetch variant details by SKU.
 */
app.get('/fetch', async (req, res) => {
  try {
    const sku = req.query.sku;
    if (!sku) {
      return res.status(400).json({ error: "Missing 'sku' query parameter." });
    }
    
    const graphqlUrl = `https://${REPRESENTATIVE_SHOP.domain}/admin/api/2023-04/graphql.json`;
    const query = `
      {
        productVariants(first: 1, query: "sku:${sku}") {
          edges {
            node {
              id
              sku
              price
              inventoryQuantity
              product {
                title
              }
              image {
                src
              }
            }
          }
        }
      }
    `;
    
    const response = await axios.post(
      graphqlUrl,
      { query },
      {
        headers: {
          "X-Shopify-Access-Token": REPRESENTATIVE_SHOP.token,
          "Content-Type": "application/json"
        }
      }
    );
    
    const data = response.data;
    if (data.errors) {
      console.error("GraphQL errors:", data.errors);
      return res.status(500).json({ error: data.errors });
    }
    const edges = data.data.productVariants.edges;
    if (edges.length === 0) {
      return res.status(404).json({ error: "SKU not found" });
    }
    const variant = edges[0].node;
    // Extract numeric variant id from global id (gid://shopify/ProductVariant/1234567890)
    const numericVariantId = variant.id.split('/').pop();
    
    // Save fetched variant in memory snapshot (keyed by SKU)
    memorySnapshot[sku] = { ...variant, numericVariantId };
    
    res.json({ message: 'Fetch completed successfully.', data: { ...variant, numericVariantId } });
  } catch (err) {
    console.error("Error in /fetch:", err);
    res.status(500).json({ error: "Fetch failed", details: err.message });
  }
});

/**
 * POST /update
 * Expects a JSON body:
 * {
 *   "updatedRows": [
 *     { "sku": "SKU123", "changes": { "price": "25.99", "tags": "discount,clearance" }, "rowNumber": 1 }
 *   ],
 *   "selectedShops": ["SI", "HR"]
 * }
 * For each updated row, it retrieves the variant ID from memory and calls the Shopify REST API on each selected shop.
 */
app.post('/update', async (req, res) => {
  try {
    const { updatedRows, selectedShops } = req.body;
    if (!updatedRows || !selectedShops) {
      return res.status(400).json({ error: "Missing 'updatedRows' or 'selectedShops' in request body." });
    }
    const updateResults = [];
    
    for (const row of updatedRows) {
      const { sku, changes, rowNumber } = row;
      const fetched = memorySnapshot[sku];
      if (!fetched) {
        updateResults.push({
          sku,
          rowNumber,
          shops: selectedShops,
          message: 'SKU not found in snapshot, skipping update.'
        });
        continue;
      }
      
      const numericId = fetched.numericVariantId;
      
      // Update variant for each selected shop
      for (const shopName of selectedShops) {
        const shop = SHOPIFY_SHOPS.find(s => s.name === shopName);
        if (!shop) continue;
        
        const shopUrl = `https://${shop.domain}/admin/api/2023-04/variants/${numericId}.json`;
        const payload = { variant: changes };
        
        try {
          const response = await axios.put(shopUrl, payload, {
            headers: {
              'X-Shopify-Access-Token': shop.token,
              'Content-Type': 'application/json'
            }
          });
          updateResults.push({
            sku,
            rowNumber,
            shop: shopName,
            message: 'Update successful'
          });
        } catch (err) {
          updateResults.push({
            sku,
            rowNumber,
            shop: shopName,
            message: `Update failed: ${
              err.response ? JSON.stringify(err.response.data.errors) : err.message
            }`
          });
        }
      }
    }
    
    res.json({ message: 'Update process completed.', results: updateResults });
  } catch (err) {
    console.error("Error in /update:", err);
    res.status(500).json({ error: "Update failed", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
