# Netlify Deployment Guide

## Build Settings

The `netlify.toml` file is already configured with the correct settings. In the Netlify dashboard:

- **Build command**: `npm run build` (set automatically from netlify.toml)
- **Publish directory**: Leave this EMPTY or unset - the `@netlify/plugin-nextjs` plugin handles it automatically
- **Node version**: `20` (automatically set by netlify.toml)

⚠️ **IMPORTANT**: Do NOT set a publish directory in the Netlify dashboard. The Next.js plugin manages this automatically. If you see a publish directory setting, clear it or leave it blank.

## Required Environment Variables

You need to set these environment variables in your Netlify dashboard:

### 1. Go to Netlify Dashboard
- Navigate to your site
- Go to **Site configuration** → **Environment variables**

### 2. Add these variables:

#### Required for the app to work:
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
  - Example: `https://keqfynzhyyenbadmndps.supabase.co`

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase anonymous/public key
  - This is safe to expose in the browser

#### Required for the delete-auth-user API route:
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key
  - ⚠️ **IMPORTANT**: This is a secret key - never expose it in the browser
  - Only used server-side for admin operations

## How to Find Your Supabase Keys

1. Go to your Supabase project dashboard
2. Click on **Settings** (gear icon)
3. Go to **API** section
4. You'll find:
   - **Project URL** → Use for `NEXT_PUBLIC_SUPABASE_URL`
   - **anon/public key** → Use for `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → Use for `SUPABASE_SERVICE_ROLE_KEY` (keep this secret!)

## Deployment Steps

1. **Connect your repository** to Netlify (if not already connected)
   - Go to Netlify dashboard → Add new site → Import from Git
   - Connect your GitHub/GitLab/Bitbucket repository

2. **Set environment variables** (see above)

3. **Deploy**
   - Netlify will automatically detect the `netlify.toml` file
   - The build will run automatically on push to your main branch
   - Or trigger a manual deploy from the dashboard

4. **Verify deployment**
   - Check the build logs for any errors
   - Visit your site URL to test

## Important Notes

- The `@netlify/plugin-nextjs` plugin is required and will be automatically installed during build
- Make sure your Supabase project allows requests from your Netlify domain
- If you have CORS issues, check your Supabase project settings
- The service role key should only be used server-side (which is already the case in your API route)

## Troubleshooting

### Build fails
- Check that all environment variables are set correctly
- Verify Node version is 20 (set in netlify.toml)
- Check build logs for specific errors

### API routes not working
- Ensure `SUPABASE_SERVICE_ROLE_KEY` is set if using the delete-auth-user endpoint
- Check Netlify function logs in the dashboard

### Environment variables not working
- Make sure variable names match exactly (case-sensitive)
- Redeploy after adding new environment variables
- Variables starting with `NEXT_PUBLIC_` are available in the browser

