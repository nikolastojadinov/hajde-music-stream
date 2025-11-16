# 🚨 URGENT: Manual Render Deployment Required

## Problem
Render is **NOT automatically deploying** after Git pushes. The backend on Render is running **old code** that doesn't have the payment.user.uid priority fix.

## Current Status
- ✅ **Code is FIXED** in GitHub (commits e423444, 3dc830f, 8aef0a3)
- ✅ **Code compiles successfully** locally
- ✅ **Logic is correct** - prioritizes `payment.user.uid` over `metadata.user_uid`
- ❌ **Render is NOT deploying** - still running old version

## Verification
Check current Render version:
```bash
curl https://hajde-music-stream.onrender.com/health
```

**Old version** (currently deployed):
```json
{
  "status": "ok",
  "time": "...",
  "supabase": { ... }
  // NO "version" or "git_commit" fields
}
```

**New version** (after successful deploy):
```json
{
  "status": "ok",
  "version": "2025-11-16-payment-fix-v2",
  "git_commit": "3dc830f",
  "time": "...",
  "supabase": { ... }
}
```

## IMMEDIATE SOLUTION: Manual Deploy

### Option 1: Render Dashboard (RECOMMENDED)
1. Go to: https://dashboard.render.com/
2. Login with your Render account
3. Find service: **purple-music-backend**
4. Click "Manual Deploy" → "Deploy latest commit"
5. Wait 2-3 minutes for build to complete
6. Verify deployment:
   ```bash
   curl https://hajde-music-stream.onrender.com/health
   ```
   Should show: `"version": "2025-11-16-payment-fix-v2"`

### Option 2: Trigger Deploy via Settings
1. In Render Dashboard → **purple-music-backend**
2. Go to "Settings" tab
3. Scroll to "Build & Deploy"
4. Verify:
   - Auto-Deploy: **Yes** (should be enabled)
   - Branch: **main**
5. If Auto-Deploy is OFF, turn it ON
6. Click "Manual Deploy" to trigger immediate deployment

### Option 3: Re-link GitHub Repository
If Auto-Deploy doesn't work:
1. Render Dashboard → **purple-music-backend** → Settings
2. Find "GitHub Repository" section
3. Click "Disconnect" then "Reconnect"
4. Re-authorize Render to access nikolastojadinov/hajde-music-stream
5. Enable "Auto-Deploy for main branch"

## What Got Fixed in the Code

### Before (BROKEN):
```typescript
// Wrong priority - metadata.user_uid is NOT returned by Pi Platform API
let piUid = payment?.metadata?.user_uid ?? null;
if (!piUid && payment?.user?.uid) {
  piUid = payment.user.uid;
}
```

### After (FIXED):
```typescript
// Correct priority - payment.user.uid is ALWAYS available
let piUid = payment?.user?.uid ?? null;  // PRIMARY SOURCE
if (!piUid && payment?.metadata?.user_uid) {  // FALLBACK
  piUid = payment.metadata.user_uid;
}
```

## Expected Behavior After Deploy

### Pi Browser Console (Before Fix):
```
[LOG] [Pi] Payment ready for approval: ...
[LOG] [Pi] Approval response: { "success": false, "error": "Missing Pi UID" }
[ERROR] [Pi] Approval failed: Missing Pi UID
```

### Pi Browser Console (After Fix):
```
[LOG] [Pi] Payment ready for approval: ...
[LOG] [Pi] Approval response: { "success": true, "elapsed_ms": 850 }
[LOG] [Pi] Payment ready for completion: ...
[LOG] [Pi] Completion response: { "success": true, "premium_until": "..." }
```

### Backend Logs (After Fix):
```
[2025-11-16T...] [Payment] resolvePaymentContext START
[2025-11-16T...] [Payment] Pi Platform API response (FULL PAYMENT OBJECT): {
  payment_user: { uid: "b52f05ba-..." }
}
[2025-11-16T...] [Payment] resolvePaymentContext RESULT {
  resolved_piUid: "b52f05ba-a4af-4a8c-989d-7daa25ef7566",
  source: "payment.user.uid"  ← THIS IS KEY!
}
[2025-11-16T...] [Payment] === APPROVE SUCCESS ===
```

## Testing After Deploy
1. Open app in Pi Browser: https://pmtestnet.netlify.app
2. Login with Pi Network
3. Click "Premium" → Select plan → Pay
4. Watch console for success messages
5. Check backend logs on Render for detailed flow

## Files Modified
- `backend/src/routes/payment.ts` - Fixed piUid resolution priority
- `backend/src/handlers/health.ts` - Added version tracking
- `render.yaml` - Fixed build configuration (rootDir, buildCommand)

## Git Commits
- **e423444** - Fix: Prioritize payment.user.uid
- **3dc830f** - Fix: Configure Render build
- **8aef0a3** - Feat: Add version to health endpoint

---

**STATUS**: Waiting for manual Render deployment
**URGENCY**: HIGH - Payment flow completely broken until deployed
**ETA**: 2-3 minutes after triggering manual deploy
