# Cloudy Impact campaign

Static campaign, checkout and local administration interface prepared for Vercel.

## Local development

```bash
npm run dev
```

Open `http://127.0.0.1:8000/`. The admin login is available at `/admin-login.html`.

## Production build

```bash
npm run build
```

The deployable website is generated in `public/`. The build embeds the campaign data runtime and restored interactions into `public/index.html`, because the original archived page only allows inline scripts.

Preview that exact output locally with `npm run preview`.

## Deploy to Vercel

Import the repository into Vercel with the **Other** framework preset. `vercel.json` already configures `npm run build` and the `dist` output directory, so no dashboard overrides are required.

The friendly routes `/admin`, `/dashboard`, `/checkout`, and `/help-single-mom-fight-stage-4-cancer` are configured in `vercel.json`.

## Administration limitation

The current login and campaign data use browser storage. They work on Vercel over HTTPS, but changes only affect the browser where they were made. Shared production administration requires server-side authentication and a database.
