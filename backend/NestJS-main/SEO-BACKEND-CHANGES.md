# Phanoos SEO backend changes

## Public visibility contract

- `GET /products?page=1&limit=10` returns only records where `isActive = true`.
- `GET /products/:id` returns `404` for missing or inactive products.
- `GET /products/seo-index` returns the active product records' `id`, `updatedAt`, `title`, `seoTitle`, and `seoDescription` for sitemap generation.
- `GET /categories` and `GET /categories/:id` remain public and now include optional SEO fields.
- Admin product listing, including inactive records, is available at `GET /products/admin/all?page=1&limit=10` and requires the existing ADMIN authentication guard.
- Admin update/delete still work for inactive products. Order stock updates also continue to find inactive products.

The existing `/products` response remains an array to avoid breaking the current frontend's React Query contract.

## SEO fields

Products and categories now support nullable `seoTitle` (max 70 characters) and `seoDescription` (max 170 characters). When omitted, the frontend should fall back to the product/category title and description.

## Database migration

A TypeORM migration was added at `src/db/migrations/1794830400000-AddSeoMetadata.ts`.

Run it in the backend project after configuring database environment variables:

```bash
npm run migration:run
```

## Database credentials

The hard-coded database password fallback was removed from both runtime and CLI TypeORM configuration. Configure `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, and `DB_NAME` in the deployment environment or local `.env` file. If a previously committed credential was used in a real environment, rotate it.

## Notes

- Product `stock = 0` does not hide the product. Only `isActive = false` removes it from public product APIs and the sitemap feed.
- The `seo-index` feed is intentionally small and contains no user relation or internal product fields.
- After product create/update/deactivate/delete and stock changes, the API can call the frontend revalidation route when `FRONTEND_REVALIDATE_URL` and `FRONTEND_REVALIDATE_SECRET` are configured. The call is best-effort and does not fail a product operation if the frontend is unavailable.
- Existing product URLs are unchanged; the frontend remains responsible for rendering a real HTTP 404 when the public product endpoint returns 404.

Set `FRONTEND_REVALIDATE_URL=https://fanoselectric.ir/api/revalidate` and `FRONTEND_REVALIDATE_SECRET` to the same random secret configured as `REVALIDATE_SECRET` on the frontend.
