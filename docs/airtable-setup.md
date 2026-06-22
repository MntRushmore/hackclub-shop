# Airtable Setup — Staff Visibility Mirror

Redis stays the live source of truth. The app mirrors writes into Airtable
(best-effort) so staff can view shop data in the Airtable UI. This doc lists the
exact PAT scopes, env vars, and table/field definitions the mirror code expects.

> Field names are **case- and space-sensitive** — they must match exactly, or the
> mirror call silently logs an error and skips (it never breaks a purchase).

---

## 1. Personal Access Token (PAT)

Create at <https://airtable.com/create/tokens>.

**Scopes:**
- `data.records:read`
- `data.records:write`
- `schema.bases:read`  *(optional but recommended — lets tools verify field names)*

**Access:** add the specific base you'll use (the same base as the existing
`Projects` table, or a new one).

Copy the token (starts with `pat...`). Copy the **Base ID** (starts with `app...`)
from the base URL: `https://airtable.com/{appXXXX}/...`.

---

## 2. Environment variables

Add to `.env.local` AND to Vercel (Production + Preview):

```
AIRTABLE_API_KEY=pat...           # the PAT
AIRTABLE_BASE_ID=app...           # the base id
AIRTABLE_TABLE_NAME=Projects      # existing projects feature
AIRTABLE_PRODUCTS_TABLE=Products
AIRTABLE_ORDERS_TABLE=Orders
AIRTABLE_USERS_TABLE=Users
AIRTABLE_COUPONS_TABLE=Coupons
```

If `AIRTABLE_API_KEY` or `AIRTABLE_BASE_ID` is missing, the mirror is a no-op
(the app runs fine, just doesn't sync).

---

## 3. Tables and fields

Create these four tables in the base. The **first column** of each is the key the
mirror upserts on, so make it the table's primary field.

### Products
| Field name | Type |
|---|---|
| `Product Id` | Single line text (primary) |
| `Name` | Single line text |
| `Description` | Long text |
| `Category` | Single line text |
| `Image URL` | URL |
| `Thumbnail URL` | URL |
| `Variants JSON` | Long text |
| `Shipping Options JSON` | Long text |
| `Variant Count` | Number (integer) |
| `Updated At` | Date (include time) |

### Orders
| Field name | Type |
|---|---|
| `Order Id` | Single line text (primary) |
| `User Id` | Single line text |
| `Slack Id` | Single line text |
| `Status` | Single select — options: `pending`, `approved`, `fulfilled`, `denied`, `refunded` |
| `Items JSON` | Long text |
| `Item Summary` | Long text |
| `Subtotal` | Number (decimal) |
| `Points Spent` | Number (integer) |
| `Coupon Discount` | Number (decimal) |
| `Shipping Cost` | Number (decimal) |
| `Total Amount` | Number (decimal) |
| `Credits Paid` | Number (decimal) |
| `Shipping Country` | Single line text |
| `Checkout Data JSON` | Long text |
| `Status History JSON` | Long text |
| `Created At` | Date (include time) |

### Users
| Field name | Type |
|---|---|
| `User Id` | Single line text (primary) |
| `Balance` | Number (decimal) |
| `Points Balance` | Number (integer) |
| `Slack Id` | Single line text |
| `Email` | Email |
| `Admin Role` | Single select — options: `manager`, `store_manager`, `reader` |
| `Updated At` | Date (include time) |

### Coupons
| Field name | Type |
|---|---|
| `Coupon Id` | Single line text (primary) |
| `Code` | Single line text |
| `Discount Type` | Single select — options: `percentage`, `fixed` |
| `Discount Value` | Number (decimal) |
| `Usage Type` | Single select — options: `single`, `reusable`, `limited` |
| `Usage Limit` | Number (integer) |
| `Usage Count` | Number (integer) |
| `Active` | Checkbox |
| `Expires At` | Date (include time) |

> The mirror sends `typecast: true`, so single-select option values are created
> automatically if missing — but pre-creating them keeps the schema tidy.

---

## 4. Backfill existing data

Once creds + tables exist, push the current Redis data into Airtable once.
As a logged-in admin:

```
POST /api/admin/airtable-backfill
```

It's idempotent (upsert-by-id), throttled to ~4 req/s, and returns counts:
`{ ok: true, counts: { products, coupons, users, orders } }`.

From there, every new write mirrors automatically.
