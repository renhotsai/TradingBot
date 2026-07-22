import { NextRequest, NextResponse } from "next/server";
import { AlpacaBroker } from "@/bot/broker";
import { instrumentBySymbol } from "@/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Temporary diagnostic: round-trips a minimal market buy + sell through the
 * exact same AlpacaBroker.submitMarketOrder() path the live engine uses, to
 * confirm the configured Alpaca API keys can actually place orders (not just
 * read account/market data). Protected by the same CRON_SECRET as the other
 * admin/cron routes. Remove after verifying.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret === "change_me") return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("token") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (req.nextUrl.searchParams.get("action") === "positions") {
    const baseUrl = (process.env.APCA_API_BASE_URL ?? "https://paper-api.alpaca.markets").replace(/\/+$/, "").replace(/\/v2$/, "");
    const res = await fetch(`${baseUrl}/v2/positions`, {
      headers: {
        "APCA-API-KEY-ID": process.env.APCA_API_KEY_ID ?? "",
        "APCA-API-SECRET-KEY": process.env.APCA_API_SECRET_KEY ?? "",
      },
    });
    const body = await res.json();
    return NextResponse.json({ status: res.status, body });
  }

  const symbol = req.nextUrl.searchParams.get("symbol") ?? "BTC/USD";
  const instrument = instrumentBySymbol(symbol);
  if (!instrument) {
    return NextResponse.json({ error: `unknown symbol ${symbol}` }, { status: 400 });
  }

  const qty = instrument.assetClass === "crypto" ? 0.0002 : 1;
  const broker = new AlpacaBroker();

  try {
    const account = await broker.getAccount();
    const marketOpen = await broker.isMarketOpen();
    if (instrument.assetClass === "equity" && !marketOpen) {
      return NextResponse.json(
        { error: `${symbol} market is closed, retry with a crypto symbol e.g. ?symbol=BTC/USD` },
        { status: 409 },
      );
    }

    const buy = await broker.submitMarketOrder(instrument, "buy", qty);
    const sell = await broker.submitMarketOrder(instrument, "sell", qty);

    return NextResponse.json({
      ok: true,
      symbol,
      qty,
      accountEquityBefore: account.equity,
      buy,
      sell,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
