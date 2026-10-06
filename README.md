# Cloudy Impact campaign

Static campaign and checkout with Supabase-backed production administration, prepared for Vercel.

## Local development

```bash
npm run dev
```

Open `http://127.0.0.1:8000/`. The admin login is available at `/admin-login.html`, and the read-only dashboard demo is available at `/demo` after deployment (or `/admin.html?demo=1` locally).

## Production build

```bash
npm run build
```

The deployable website is generated in the versioned `public/` directory. The build embeds the campaign data runtime and restored interactions into `public/index.html`, because the original archived page only allows inline scripts. It also validates the required pages and their local asset references. Run the build and commit the refreshed `public/` files after changing the source.

Preview that exact output locally with `npm run preview`.

## Deploy to Vercel

1. Push the repository to GitHub.
2. In Vercel, choose **Add New > Project** and import the GitHub repository.
3. Keep the **Other** framework preset and leave the build/output settings unchanged.
4. Deploy.

`vercel.json` runs `npm run build` for every deployment and serves the generated `public/` directory, so no dashboard overrides or environment variables are required for the current static site.

The local preview server is intentionally named `dev-server.mjs`. Keeping it separate from conventional production entrypoint names prevents Vercel from mistaking the development server for a Node application.

The friendly routes `/admin`, `/dashboard`, `/checkout`, and `/help-single-mom-fight-stage-4-cancer` are configured in `vercel.json`.

## Production data

Campaign content is stored in Supabase with public read access and administrator-only writes enforced by row-level security. Authentication uses Supabase Auth, and campaign media is stored in the public `campaign-media` bucket with administrator-only uploads.

The Vercel build accepts `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Their current public project values are used as build fallbacks because a publishable key is intentionally safe to expose in browser code; RLS remains the security boundary.

Payment processing is not included. Enabling real donations still requires a payment provider and a server-side payment endpoint.
