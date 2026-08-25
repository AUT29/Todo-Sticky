# Todo Sticky Supabase setup

1. Create a Supabase project.
2. In SQL Editor, run `supabase/schema.sql`.
3. In Supabase Auth, enable Email/Password sign-in. Email confirmation can stay enabled; after registration, users confirm the email link, then return to the app and log in again.
4. For local development, copy the project URL and anon public key into `src/cloud-config.js`, or inject them only at build time with environment variables:

```js
export const BUILTIN_SUPABASE_URL = "https://your-project.supabase.co";
export const BUILTIN_SUPABASE_ANON_KEY = "your-anon-public-key";
```

5. Build the Windows installer. To make the installer hide developer config fields for normal users, inject the Supabase config while building:

```powershell
$env:TODO_STICKY_SUPABASE_URL="https://your-project.supabase.co"
$env:TODO_STICKY_SUPABASE_ANON_KEY="your-anon-public-key"
pnpm run build:installer:cloud
```

Use `pnpm run build:installer` only for local developer builds that show Supabase config fields in the app. Use `pnpm run build:installer:cloud` for a login-ready installer; it fails fast if the cloud config is missing, the URL is not shaped like `https://your-project.supabase.co`, or the anon key is still the placeholder.

The app stores each account state in `public.app_states` and attachment files in the private `todo-attachments` Storage bucket. Existing local data remains in AppData and is uploaded to the account after login.
## Release checklist

- Run `supabase/schema.sql` in the production Supabase project before building the public installer.
- Run `pnpm run check:desktop` before publishing; it checks domain logic, Supabase schema, NSIS installer shape, cloud config embedding, and the local AppData state file.
- Use `pnpm run build:installer:cloud` for the installer you give to normal users. This embeds the Supabase URL and anon public key, so users only enter their email and password.
- Do not distribute `pnpm run build:installer` builds to normal users; those are local developer builds and show Supabase config fields.
- Existing local AppData data is kept on the device and uploaded to the account on first login when the cloud account is empty.
