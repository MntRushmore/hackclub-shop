# Sourcing — Setup Checklist

Everything the Admin OS sourcing program (vendors, quotes, POs, assets, command
center) needs to run. **Short version: there are no new environment variables.** The
only real task is creating four Airtable tables — and even that is optional.

---

## 1. Environment variables — nothing to do ✅

The sourcing tools reuse credentials you already have set:

| Used for | Var | Status |
|---|---|---|
| Source of truth (all sourcing data) | `UPSTASH_REDIS_REST_URL` / `_TOKEN` | already set |
| Airtable mirror | `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID` | already set |
| Asset file uploads | `BLOB_READ_WRITE_TOKEN` | already set |

The new table-name overrides all have defaults, so you only set them if you want
different Airtable table names than the defaults:

```
AIRTABLE_VENDORS_TABLE   (default: "Vendors")
AIRTABLE_QUOTES_TABLE    (default: "Quotes")
AIRTABLE_POS_TABLE       (default: "Purchase Orders")
AIRTABLE_ASSETS_TABLE    (default: "Assets")
```

Leave them unset and just name the Airtable tables exactly as the defaults below.

---

## 2. Airtable tables — create 4 tables (optional but recommended)

Redis is the source of truth; Airtable is a **write-only mirror** so non-engineers can
browse sourcing data in the spreadsheet UI. **If you skip this, everything still works**
— the mirror just no-ops (failures are swallowed by design). The mirror also self-heals:
if a column is missing it drops that field and writes the rest, so you can add columns
later without breaking anything.

In the base pointed to by `AIRTABLE_BASE_ID`, create these tables. The **first column
(the key) must match exactly**; the rest can be added in any order, and missing ones are
fine.

### Table: `Vendors`  (key column: `Vendor Id`, type *Single line text*)
`Name`, `Website`, `Contact Name`, `Contact Email`, `Tags`, `Notes`,
`Created At`, `Updated At`

### Table: `Quotes`  (key column: `Quote Id`)
`Vendor Id`, `Item Name`, `Product Id`, `Variant Hint`, `Price Breaks JSON`,
`Lowest Unit Cost` (Number), `MOQ` (Number), `Lead Time Days` (Number),
`Setup Fee` (Number), `Shipping Estimate` (Number), `Currency`, `Valid Until`,
`Status`, `Notes`, `Created At`, `Updated At`

### Table: `Purchase Orders`  (key column: `PO Id`)
`Vendor Id`, `Quote Id`, `Status`, `Lines JSON`, `Line Summary`,
`Units Total` (Number), `Setup Fee` (Number), `Shipping Cost` (Number),
`Total Cost` (Number), `Expected Date`, `Received Receipt Ids`, `Issued By`,
`Created At`, `Updated At`

### Table: `Assets`  (key column: `Asset Id`)
`Filename`, `Label`, `Kind`, `Version` (Number), `Group Id`, `Mime Type`, `URL`,
`Product Id`, `Variant Id`, `Quote Id`, `PO Id`, `Uploaded By`, `Created At`

> Tip: make every non-key field **Single line text** (or Number where noted). The mirror
> sends strings/numbers and uses `typecast`, so you don't need exact field types — text
> is the safe default. `*_JSON` fields hold raw JSON; keep them as long text.

---

## 3. That's it for setup. Then, to use it:

1. **/admin → Sourcing → Vendors** — add a supplier.
2. **Quotes** — log a quote with quantity price-breaks; use the "Compare at quantity"
   box to see the cheapest landed cost across vendors.
3. **Accept & create product** on a quote → makes a **draft** product (hidden from the
   shop) seeded with the quoted cost.
4. **Publish the draft** in **/admin → Products** (set cash/points prices; the product
   stays a draft until it has a price and you save it).
5. **Start PO →** from the accepted quote, fill the variant id (shown in Products),
   **Issue**, then **Receive** — receiving posts stock + weighted-average cost into the
   finance ledger automatically. *(Receiving requires the finance permission.)*
6. **Set a `Reorder point`** on variants (Products editor) so the **command center** on
   `/admin` flags them when stock runs low — with a one-click link to the cheapest open
   quote.
7. **Assets** — on any quote or PO, click **Assets** to upload mockups/proofs/print
   files (PNG/JPG/PDF/AI/SVG/ZIP). Upload a newer file as a **New version** to keep
   history.

## Permissions recap

- `manager` and `store_manager` can do all sourcing (vendors, quotes, POs, assets).
- **Receiving a PO** additionally requires **finance** permission (`manager` only, by
  default) since it moves cost basis and inventory valuation.
- `reader` sees none of the sourcing tools.

Full technical model: `docs/SOURCING.md`. Build spec: `ADMIN_OS_PROMPT.md`.
