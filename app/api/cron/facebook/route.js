// /app/api/cron/facebook/route.js
// Vercel Cron - auto posts a Challenge-Me link to the Facebook Page.
//
// Schedule (vercel.json): "30 23,3,8 * * *" UTC
//   23:30 UTC = 09:30 Adelaide (ACST)
//   03:30 UTC = 13:30 Adelaide (ACST)
//   08:30 UTC = 18:30 Adelaide (ACST)
// Vercel cron runs in UTC; Australia/Adelaide is UTC+9:30 (standard) / UTC+10:30 (DST).

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// 9-image rotation: duck, iron man, tradie - repeated 3x so the rotation
// keeps hitting every theme without repeats on consecutive posts.
const ROTATION = [
  { theme: 'duck', zone: 120, speed: 3, outline: '#00FF88' },
  { theme: 'ironman', zone: 80, speed: 4, outline: '#00C8FF' },
  { theme: 'tradie', zone: 90, speed: 4, outline: '#FFB800' },
  { theme: 'duck', zone: 100, speed: 3, outline: '#00FF88' },
  { theme: 'ironman', zone: 70, speed: 5, outline: '#00C8FF' },
  { theme: 'tradie', zone: 80, speed: 4, outline: '#FFB800' },
  { theme: 'duck', zone: 110, speed: 3, outline: '#00FF88' },
  { theme: 'ironman', zone: 60, speed: 5, outline: '#00C8FF' },
  { theme: 'tradie', zone: 85, speed: 4, outline: '#FFB800' },
];

// ?image=duck|ironman|tradie -> concrete asset. ?slot=N -> explicit rotation slot.
function buildUrl(baseUrl, slot) {
  const item = ROTATION[slot % ROTATION.length];
  const params = new URLSearchParams({
    image: item.theme,
    zone: String(item.zone),
    speed: String(item.speed),
    outline: item.outline,
    bg: '#0a0a0a',
    accent: '#00FF88',
  });
  return `${baseUrl}/?${params.toString()}`;
}

// Deterministic rotation from the UTC date + slot so a given cron window always
// maps to the same post, while still advancing day to day.
function rotationSlot(now) {
  const daysSinceEpoch = Math.floor(now.getTime() / 86400000);
  const utcHour = now.getUTCHours();
  const slotOfDay = utcHour < 12 ? 0 : utcHour < 18 ? 1 : 2;
  return (daysSinceEpoch * 3 + slotOfDay) % ROTATION.length;
}

export async function GET(req) {
  const FB_PAGE_ID = process.env.FB_PAGE_ID;
  const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
  const url = new URL(req.url);

  // Prefer the configured canonical domain, fall back to the incoming origin so
  // preview/local runs post a working link.
  const BASE_URL = (
    process.env.NEXT_PUBLIC_BASE_URL || url.origin
  ).replace(/\/+$/, '');

  const requestedSlot = url.searchParams.get('slot');
  const slot =
    requestedSlot !== null && requestedSlot !== ''
      ? Math.max(0, parseInt(requestedSlot, 10) || 0)
      : rotationSlot(new Date());

  const challengeUrl = buildUrl(BASE_URL, slot);
  const dryRun = url.searchParams.get('dryRun') === '1';

  if (!FB_PAGE_ID || !FB_PAGE_TOKEN) {
    // Answer 200 so the cron shows up healthy, but make the misconfiguration
    // loud in the response body and in the function logs.
    console.error(
      '[cron/facebook] FB_PAGE_ID / FB_PAGE_TOKEN not configured - nothing posted',
      { slot, challengeUrl }
    );
    return NextResponse.json({
      success: false,
      posted: false,
      error: 'FB_PAGE_ID / FB_PAGE_TOKEN not configured',
      slot,
      theme: ROTATION[slot % ROTATION.length].theme,
      challengeUrl,
      message: `Can you stop it in the zone? TAP TO STOP! ${challengeUrl}`,
    });
  }

  if (dryRun) {
    return NextResponse.json({
      success: true,
      posted: false,
      dryRun: true,
      slot,
      theme: ROTATION[slot % ROTATION.length].theme,
      challengeUrl,
      message: `Can you stop it in the zone? TAP TO STOP! ${challengeUrl}`,
    });
  }

  const message = `Can you stop it in the zone? TAP TO STOP! ${challengeUrl}`;

  try {
    const fbRes = await fetch(`https://graph.facebook.com/${FB_PAGE_ID}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        link: challengeUrl,
        access_token: FB_PAGE_TOKEN,
      }),
      cache: 'no-store',
    });

    const fbText = await fbRes.text();
    let fbData;
    try {
      fbData = JSON.parse(fbText);
    } catch {
      fbData = { raw: fbText };
    }

    if (!fbRes.ok || fbData.error) {
      const detail = fbData.error ? JSON.stringify(fbData.error) : fbText.slice(0, 500);
      console.error('facebook post failed', { status: fbRes.status, detail });
      return NextResponse.json(
        { success: false, error: detail, fb_status: fbRes.status, slot, challengeUrl },
        { status: 502 }
      );
    }

    console.log('facebook post ok', { id: fbData.id, slot, challengeUrl });
    return NextResponse.json({
      success: true,
      slot,
      theme: ROTATION[slot % ROTATION.length].theme,
      challengeUrl,
      fb_post_id: fbData.id,
      next_slot: (slot + 1) % ROTATION.length,
    });
  } catch (e) {
    console.error('facebook post threw', e);
    return NextResponse.json(
      { success: false, error: e?.message || String(e), slot, challengeUrl },
      { status: 500 }
    );
  }
}