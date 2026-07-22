# Burger Brothers Showcase – Cloudinary

Showcase video and image uploads are stored in Cloudinary. GitHub, Vercel deployment files and Supabase Storage do not contain the uploaded media.

## Required Vercel environment variables

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

`CLOUDINARY_API_SECRET` must be marked Sensitive and must never be committed to GitHub.

## Optional variables

- `CLOUDINARY_MAX_UPLOAD_MB` – default and maximum value: `95`
- `CLOUDINARY_SHOWCASE_FOLDER` – default: `burger-brothers/showcase`

The admin uses a short-lived server-generated signature. The browser uploads directly to Cloudinary, then the server verifies Cloudinary's response signature before registering the media in Showcase.

Cloudinary delivery URLs contain an asset version. Showcase keeps unchanged URLs stable, preloads the next scene, and stores completed Cloudinary media in the browser Cache Storage when supported. Old media cache entries are removed when they are no longer part of the published scene list.
