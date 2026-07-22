import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Read-only diagnostic: lists open (unfilled/working) orders and current
 * positions directly from Alpaca, to check for state left over from earlier
 * testing. No orders are submitted. Protected by CRON_SECRET like the other
 * admin routes. Remove after verifying.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret === "change_me") return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("token") === secret;
}

function alpacaHeaders(): Record<string, string> {
  return {
    "APCA-API-KEY-ID": process.env.APCA_API_KEY_ID ?? "",
    "APCA-API-SECRET-KEY": process.env.APCA_API_SECRET_KEY ?? "",
  };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const baseUrl = (process.env.APCA_API_BASE_URL ?? "https://paper-api.alpaca.markets")
    .replace(/\/+$/, "")
    .replace(/\/v2$/, "");

  const [positionsRes, openOrdersRes, allOrdersRes] = await Promise.all([
    fetch(`${baseUrl}/v2/positions`, { headers: alpacaHeaders() }),
    fetch(`${baseUrl}/v2/orders?status=open`, { headers: alpacaHeaders() }),
    fetch(`${baseUrl}/v2/orders?status=all&symbols=BTC%2FUSD&limit=10&direction=desc`, {
      headers: alpacaHeaders(),
    }),
  ]);

  return NextResponse.json({
    positions: await positionsRes.json(),
    openOrders: await openOrdersRes.json(),
    recentBtcOrders: await allOrdersRes.json(),
  });
}
