# Landing Page & Demo Preview Update

## Implemented

The landing-page hero dashboard card is now straightened; the previous `rotate-1` tilt and entrance rotation were removed so the visual sits level on desktop and mobile.

A fixed WhatsApp contact gadget was added to the landing page. It displays the supplied number `01014996636` and opens the correctly formatted WhatsApp URL `https://wa.me/201014996636` in a new tab.

A public demo-only preview was added at:

```text
/?preview=1
```

The preview uses local sample data only. It does not import Supabase, does not call any real API, does not write to the database, and does not modify real students, groups, attendance, grades, reports, or notifications.

The preview includes interactive tabs for overview, students, lessons, grades, reports, and Student Portal. Demo buttons show an in-page message explaining that the action is only a preview. A small three-step tutorial explains the dashboard, tab navigation, and demo-data safety.

## Windows verification

From the `frontend` folder:

```bat
npm install
npm run build
npm run dev -- --host 0.0.0.0 --port 4174
```

Open:

```text
http://localhost:4174/
```

Then select **شاهد معاينة المنصة**, or open the preview directly:

```text
http://localhost:4174/?preview=1
```

For production deployment:

```bat
npx vercel --prod
```

After deployment, use:

```text
https://YOUR-DOMAIN/?preview=1
```
