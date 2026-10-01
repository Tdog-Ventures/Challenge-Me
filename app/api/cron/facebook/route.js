// /app/api/cron/facebook/route.js
// Vercel Cron - auto posts to Facebook Page without interaction
// Add to vercel.json: { "crons": [{ "path": "/api/cron/facebook", "schedule": "0 9,13,18 * * *" }] }

import { NextResponse } from 'next/server';

export async function GET(req) {
  const FB_PAGE_ID = process.env.FB_PAGE_ID;
  const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://stop-me-challenge.vercel.app';
  
  // Content queue - first 9 posts (your first week)
  const queue = [
    { image: 'https://i.imgur.com/duck1.png', message: 'QUACKED IT! 🦆 Can you stop it?', zone: 120, speed: 3 },
    { image: 'https://i.imgur.com/ironman.png', message: 'TOO COOL FOR SCHOOL', zone: 80, speed: 4 },
    { image: 'https://i.imgur.com/hardhat.png', message: 'NAILED IT! 🔨', zone: 80, speed: 4 },
    { image: 'https://i.imgur.com/duck2.png', message: 'WADDLE YOU DO?', zone: 100, speed: 4 },
    { image: 'https://i.imgur.com/spiderman.png', message: 'YOU GOT IT!', zone: 60, speed: 5 },
    { image: 'https://i.imgur.com/plumber.png', message: 'LEAK STOPPED! 💧', zone: 80, speed: 4 },
    { image: 'https://i.imgur.com/duck3.png', message: 'DUCK YEAH!', zone: 110, speed: 3 },
    { image: 'https://i.imgur.com/hulk.png', message: 'SMASHED IT!', zone: 70, speed: 5 },
    { image: 'https://i.imgur.com/sparky.png', message: 'ELECTRIFYING!', zone: 80, speed: 4 },
  ];

  // Pick next based on day + hour to avoid repeats
  const now = new Date();
  const index = (now.getDate() * 3 + (now.getHours() >= 13 ? 1 : 0) + (now.getHours() >= 18 ? 1 : 0)) % queue.length;
  const item = queue[index];
  
  const challengeUrl = `${BASE_URL}/?image=${encodeURIComponent(item.image)}&message=${encodeURIComponent(item.message)}&zone=${item.zone}&speed=${item.speed}&bg=%231a1a2e&accent=%23FF0000`;
  
  const fbMessage = `${item.message}\n\nCan you stop it right in the zone? 👇 TAP TO STOP 👇\n\n${challengeUrl}\n\n#StopMeChallenge #ViralGame #${item.message.replace(/\s+/g,'')}`;

  // Post to Facebook
  try {
    const fbRes = await fetch(`https://graph.facebook.com/v20.0/${FB_PAGE_ID}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: fbMessage,
        link: challengeUrl,
        access_token: FB_PAGE_TOKEN
      })
    });
    
    const fbData = await fbRes.json();
    
    if (!fbRes.ok) throw new Error(JSON.stringify(fbData));
    
    return NextResponse.json({ 
      success: true, 
      posted: challengeUrl,
      fb_post_id: fbData.id,
      next: queue[(index+1) % queue.length]
    });
    
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message, challengeUrl }, { status: 500 });
  }
}
